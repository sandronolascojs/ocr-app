import { z } from "zod";
import { createTRPCRouter, baseProcedure } from "@/trpc/init";
import { db } from "@/db";
import { ocrJobs } from "@/db/schema";
import { inngest } from "@/inngest/client";
import {
  createSignedDownloadUrl,
  createSignedUploadUrl,
  ensureObjectExists,
  getJobZipKey,
} from "@/lib/storage";
import { InngestEvents, JobsStatus, JobStep } from "@/types";
import { createId } from "@paralleldrive/cuid2";
import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";

export const ocrRouter = createTRPCRouter({
  uploadZip: baseProcedure
    .input(
      z.object({
        fileType: z.string().min(1).max(128).optional(),
        filename: z.string(),
        fileSize: z.number().int().positive(),
      })
    )
    .mutation(async ({ input }) => {
      const jobId = createId();
      const zipKey = getJobZipKey(jobId);

      const signedUpload = await createSignedUploadUrl({
        key: zipKey,
        contentType: input.fileType ?? "application/zip",
      });

      return {
        jobId,
        upload: signedUpload,
      };
    }),

  confirmUpload: baseProcedure
    .input(
      z.object({
        jobId: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const { jobId } = input;

      // Generate the zipKey from the jobId to verify the file exists
      const zipKey = getJobZipKey(jobId);

      // Verify that the file actually exists in R2 before creating the job
      const exists = await ensureObjectExists(zipKey);
      if (!exists) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "ZIP not uploaded to storage yet",
        });
      }

      // Check if job already exists (in case of duplicate confirmations)
      const [existingJob] = await db
        .select()
        .from(ocrJobs)
        .where(eq(ocrJobs.jobId, jobId))
        .limit(1);

      if (existingJob) {
        // Job already exists, just verify it's in the correct state
        if (existingJob.status !== JobsStatus.PENDING) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Job already confirmed",
          });
        }
        // Job exists and is pending, trigger Inngest event
        await inngest.send({
          name: InngestEvents.ZIP_UPLOADED,
          data: { jobId, zipKey: existingJob.zipPath },
        });
        return { jobId };
      }

      // Create the job only after confirming the file exists in R2
      await db.insert(ocrJobs).values({
        jobId,
        zipPath: zipKey,
        status: JobsStatus.PENDING,
        step: JobStep.PREPROCESSING,
      });

      // Trigger Inngest event to start processing
      await inngest.send({
        name: InngestEvents.ZIP_UPLOADED,
        data: { jobId, zipKey },
      });

      return { jobId };
    }),

  getJob: baseProcedure
    .input(
      z.object({
        jobId: z.string(),
      })
    )
    .query(async ({ input }) => {
      const [job] = await db
        .select()
        .from(ocrJobs)
        .where(eq(ocrJobs.jobId, input.jobId))
        .limit(1);

      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }

      return {
        jobId: job.jobId,
        status: job.status,
        step: job.step,
        error: job.error,
        totalImages: job.totalImages,
        processedImages: job.processedImages,
        hasResults: Boolean(job.txtPath && job.docxPath),
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      };
    }),

  listJobs: baseProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(100).default(25),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const limit = input?.limit ?? 25;

      const jobs = await db
        .select()
        .from(ocrJobs)
        .orderBy(desc(ocrJobs.createdAt))
        .limit(limit);

      return jobs.map((job) => ({
        jobId: job.jobId,
        status: job.status,
        step: job.step,
        error: job.error,
        totalImages: job.totalImages,
        processedImages: job.processedImages,
        hasResults: Boolean(job.txtPath && job.docxPath),
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      }));
    }),

  retryJob: baseProcedure
    .input(
      z.object({
        jobId: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const { jobId } = input;

      const [job] = await db
        .select()
        .from(ocrJobs)
        .where(eq(ocrJobs.jobId, jobId))
        .limit(1);

      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      }

      // If you want to restrict, you can allow retry only if the job is in ERROR state
      // if (job.status !== JobsStatus.ERROR) throw new TRPCError({ code: "BAD_REQUEST", message: "Job is not in ERROR state" });

      // We ensure that the zip is still there
      if (!job.zipPath) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Zip path not found for this job",
        });
      }

      const zipExists = await ensureObjectExists(job.zipPath);
      if (!zipExists) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Zip file not found in storage for this job",
        });
      }

      // Set the status to PROCESSING, keep the step the same
      await db
        .update(ocrJobs)
        .set({
          status: JobsStatus.PROCESSING,
          error: null,
        })
        .where(eq(ocrJobs.jobId, jobId));

      // Re-dispatch the Inngest event
      await inngest.send({
        name: InngestEvents.ZIP_UPLOADED,
        data: {
          jobId,
          zipKey: job.zipPath,
        },
      });

      return { jobId, step: job.step, status: JobsStatus.PROCESSING };
    }),

  getResult: baseProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ input }) => {
      const [job] = await db
        .select()
        .from(ocrJobs)
        .where(eq(ocrJobs.jobId, input.jobId))
        .limit(1);

      if (!job || !job.txtPath || !job.docxPath) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Result not ready" });
      }

      const [txtUrl, docxUrl, rawZipUrl] = await Promise.all([
        createSignedDownloadUrl({
          key: job.txtPath,
          responseContentType: "text/plain",
          downloadFilename: `${job.jobId}.txt`,
        }),
        createSignedDownloadUrl({
          key: job.docxPath,
          responseContentType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          downloadFilename: `${job.jobId}.docx`,
        }),
        job.rawZipPath
          ? createSignedDownloadUrl({
              key: job.rawZipPath,
              responseContentType: "application/zip",
              downloadFilename: `${job.jobId}-raw.zip`,
            })
          : Promise.resolve(null),
      ]);

      return {
        txt: txtUrl,
        docx: docxUrl,
        rawZip: rawZipUrl,
      };
    }),
});

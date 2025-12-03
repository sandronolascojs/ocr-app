import { z } from "zod";
import { createTRPCRouter, baseProcedure } from "@/trpc/init";
import { db } from "@/db";
import { ocrJobs } from "@/db/schema";
import { inngest } from "@/inngest/client";
import * as fs from "node:fs/promises";
import {
  VOLUME_DIRS,
  getJobRawArchivePath,
  getJobRootDir,
  getJobZipPath,
} from "@/lib/paths";
import { InngestEvents, JobsStatus, JobStep } from "@/types";
import { createId } from "@paralleldrive/cuid2";
import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";

export const ocrRouter = createTRPCRouter({
  uploadZip: baseProcedure
    .input(
      z.object({
        fileBase64: z.string(), // data:...;base64,xxx
        filename: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const { fileBase64 } = input;

      // Clean up the "data:...;base64," header
      const base64Data = fileBase64.replace(/^data:.*;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");

      const jobId = createId();

      // 1) Ensure base directories in /mnt
      await fs.mkdir(VOLUME_DIRS.imagesBase, { recursive: true });
      await fs.mkdir(VOLUME_DIRS.txtBase, { recursive: true });
      await fs.mkdir(VOLUME_DIRS.wordBase, { recursive: true });

      // 2) Create the job folder for images
      const jobRootDir = getJobRootDir(jobId);
      await fs.mkdir(jobRootDir, { recursive: true });

      // 3) Save zip in /mnt/image-files/{jobId}/input.zip
      const zipPath = getJobZipPath(jobId);
      await fs.writeFile(zipPath, buffer);

      // 4) Insert the job in the DB
      await db.insert(ocrJobs).values({
        jobId,
        zipPath,
        status: JobsStatus.PENDING,
        step: JobStep.PREPROCESSING,
      });

      // 5) Dispatch the Inngest event to process the zip
      await inngest.send({
        name: InngestEvents.ZIP_UPLOADED,
        data: { jobId, zipPath },
      });

      // 6) Return jobId to the client
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
          zipPath: job.zipPath,
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

      const txtBuffer = await fs.readFile(job.txtPath);
      const docxBuffer = await fs.readFile(job.docxPath);
      let rawZipBase64: string | null = null;

      try {
        const rawArchivePath = getJobRawArchivePath(job.jobId);
        const rawZipBuffer = await fs.readFile(rawArchivePath);
        rawZipBase64 = rawZipBuffer.toString("base64");
      } catch {
        rawZipBase64 = null;
      }

      return {
        txtBase64: txtBuffer.toString("base64"),
        docxBase64: docxBuffer.toString("base64"),
        rawZipBase64,
      };
    }),
});

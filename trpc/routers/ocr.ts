import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "@/trpc/init";
import { ocrJobs, apiKeys } from "@/db/schema";
import { inngest } from "@/inngest/client";
import {
  createSignedDownloadUrl,
  createSignedThumbnailUrl,
  createSignedUploadUrl,
  deleteObjectIfExists,
  ensureObjectExists,
  getJobZipKey,
  type SignedDownloadUrl,
} from "@/lib/storage";
import { InngestEvents, JobsStatus, JobStep, ApiKeyProvider } from "@/types";
import { createId } from "@paralleldrive/cuid2";
import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, isNotNull, or } from "drizzle-orm";

export const ocrRouter = createTRPCRouter({
  uploadZip: protectedProcedure
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

  confirmUpload: protectedProcedure
    .input(
      z.object({
        jobId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { jobId } = input;

      // Validate that user has an active OpenAI API key
      const [activeApiKey] = await ctx.db
        .select()
        .from(apiKeys)
        .where(
          and(
            eq(apiKeys.userId, ctx.userId),
            eq(apiKeys.provider, ApiKeyProvider.OPENAI),
            eq(apiKeys.isActive, true)
          )
        )
        .limit(1);

      if (!activeApiKey) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "You must add an OpenAI API key in Settings before creating jobs.",
        });
      }

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

      // Atomically insert or get existing job using upsert with conflict handling
      // This prevents race conditions where concurrent calls both try to insert
      const [insertedJob] = await ctx.db
        .insert(ocrJobs)
        .values({
          jobId,
          userId: ctx.userId,
          zipPath: zipKey,
          status: JobsStatus.PENDING,
          step: JobStep.PREPROCESSING,
        })
        .onConflictDoNothing({
          target: ocrJobs.jobId,
        })
        .returning();

      // If insert returned nothing, the job already exists (conflict occurred)
      // Query for the existing job (must belong to the current user)
      const job = insertedJob
        ? insertedJob
        : await ctx.db
            .select()
            .from(ocrJobs)
            .where(and(eq(ocrJobs.jobId, jobId), eq(ocrJobs.userId, ctx.userId)))
            .limit(1)
            .then((rows) => rows[0]);

      if (!job) {
        // This should never happen, but handle it defensively
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create or retrieve job",
        });
      }

      // Verify the job is in the correct state
      if (job.status !== JobsStatus.PENDING) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Job already confirmed",
          });
        }

      // Trigger Inngest event to start processing
      await inngest.send({
        name: InngestEvents.ZIP_UPLOADED,
        data: { jobId, zipKey: job.zipPath, userId: ctx.userId },
      });

      return { jobId };
    }),

  abortUpload: protectedProcedure
    .input(
      z.object({
        jobId: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const { jobId } = input;
      const zipKey = getJobZipKey(jobId);

      try {
        await deleteObjectIfExists(zipKey);
        return { jobId, deleted: true };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to delete uploaded file: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
      }
    }),

  getJob: protectedProcedure
    .input(
      z.object({
        jobId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const [job] = await ctx.db
        .select()
        .from(ocrJobs)
        .where(and(eq(ocrJobs.jobId, input.jobId), eq(ocrJobs.userId, ctx.userId)))
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

  listJobs: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(100).default(10),
          offset: z.number().min(0).default(0),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 10;
      const offset = input?.offset ?? 0;

      const whereCondition = eq(ocrJobs.userId, ctx.userId);

      const [jobs, totalResult] = await Promise.all([
        ctx.db
          .select()
          .from(ocrJobs)
          .where(whereCondition)
          .orderBy(desc(ocrJobs.createdAt))
          .limit(limit)
          .offset(offset),
        ctx.db
          .select({ count: count() })
          .from(ocrJobs)
          .where(whereCondition),
      ]);

      const total = totalResult[0]?.count ?? 0;

      return {
        jobs: jobs.map((job) => ({
          jobId: job.jobId,
          status: job.status,
          step: job.step,
          error: job.error,
          totalImages: job.totalImages,
          processedImages: job.processedImages,
          hasResults: Boolean(job.txtPath && job.docxPath),
          txtSizeBytes: job.txtSizeBytes ?? null,
          docxSizeBytes: job.docxSizeBytes ?? null,
          rawZipSizeBytes: job.rawZipSizeBytes ?? null,
          thumbnailKey: job.thumbnailKey ?? null,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
        })),
        total,
        limit,
        offset,
      };
    }),

  retryJob: protectedProcedure
    .input(
      z.object({
        jobId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { jobId } = input;

      const [job] = await ctx.db
        .select()
        .from(ocrJobs)
        .where(and(eq(ocrJobs.jobId, jobId), eq(ocrJobs.userId, ctx.userId)))
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
      await ctx.db
        .update(ocrJobs)
        .set({
          status: JobsStatus.PROCESSING,
          error: null,
        })
        .where(eq(ocrJobs.jobId, jobId));

      // Re-dispatch the Inngest event with userId from context
      await inngest.send({
        name: InngestEvents.ZIP_UPLOADED,
        data: {
          jobId,
          zipKey: job.zipPath,
          userId: ctx.userId,
        },
      });

      return { jobId, step: job.step, status: JobsStatus.PROCESSING };
    }),

  retryFromStep: protectedProcedure
    .input(
      z.object({
        jobId: z.string(),
        step: z.enum(JobStep),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { jobId, step } = input;

      const [job] = await ctx.db
        .select()
        .from(ocrJobs)
        .where(and(eq(ocrJobs.jobId, jobId), eq(ocrJobs.userId, ctx.userId)))
        .limit(1);

      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      }

      // Only allow retry from step if job is in ERROR state
      if (job.status !== JobsStatus.ERROR) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Job is not in ERROR state. Only failed jobs can be retried from a specific step.",
        });
      }

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

      // Set the step to the specified step, status to PROCESSING, and clear error
      await ctx.db
        .update(ocrJobs)
        .set({
          step,
          status: JobsStatus.PROCESSING,
          error: null,
        })
        .where(eq(ocrJobs.jobId, jobId));

      // Re-dispatch the Inngest event with userId from context
      await inngest.send({
        name: InngestEvents.ZIP_UPLOADED,
        data: {
          jobId,
          zipKey: job.zipPath,
          userId: ctx.userId,
        },
      });

      return { jobId, step, status: JobsStatus.PROCESSING };
    }),

  getResult: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ ctx, input }) => {
      const [job] = await ctx.db
        .select()
        .from(ocrJobs)
        .where(and(eq(ocrJobs.jobId, input.jobId), eq(ocrJobs.userId, ctx.userId)))
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

  getAllDocuments: protectedProcedure.query(async ({ ctx }) => {
    const jobs = await ctx.db
      .select()
      .from(ocrJobs)
      .where(
        and(
          eq(ocrJobs.userId, ctx.userId),
          or(isNotNull(ocrJobs.txtPath), isNotNull(ocrJobs.docxPath))
        )
      )
      .orderBy(desc(ocrJobs.createdAt));

    const documents: Array<{
      jobId: string;
      type: "txt" | "docx";
      sizeBytes: number | null;
      url: SignedDownloadUrl | null;
      filesExist: boolean;
      thumbnailUrl: SignedDownloadUrl | null;
      thumbnailKey: string | null;
      createdAt: Date | null;
      updatedAt: Date | null;
    }> = [];

    for (const job of jobs) {
      // Get thumbnail for this job (shared across both txt and docx documents)
      let thumbnailUrl: SignedDownloadUrl | null = null;
      let thumbnailKey: string | null = job.thumbnailKey ?? null;

      if (job.thumbnailKey) {
        const thumbnailExists = await ensureObjectExists(job.thumbnailKey);
        if (thumbnailExists) {
          thumbnailUrl = await createSignedThumbnailUrl(job.thumbnailKey);
        }
      }

      if (job.txtPath) {
        const exists = await ensureObjectExists(job.txtPath);
        const url = exists
          ? await createSignedDownloadUrl({
              key: job.txtPath,
              responseContentType: "text/plain",
              downloadFilename: `${job.jobId}.txt`,
            })
          : null;

        documents.push({
          jobId: job.jobId,
          type: "txt",
          sizeBytes: job.txtSizeBytes ?? null,
          url,
          filesExist: exists,
          thumbnailUrl,
          thumbnailKey,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
        });
      }

      if (job.docxPath) {
        const exists = await ensureObjectExists(job.docxPath);
        const url = exists
          ? await createSignedDownloadUrl({
              key: job.docxPath,
              responseContentType:
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              downloadFilename: `${job.jobId}.docx`,
            })
          : null;

        documents.push({
          jobId: job.jobId,
          type: "docx",
          sizeBytes: job.docxSizeBytes ?? null,
          url,
          filesExist: exists,
          thumbnailUrl,
          thumbnailKey,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
        });
      }
    }

    return documents;
  }),

  getAllImages: protectedProcedure.query(async ({ ctx }) => {
    const jobs = await ctx.db
      .select()
      .from(ocrJobs)
      .where(and(eq(ocrJobs.userId, ctx.userId), isNotNull(ocrJobs.rawZipPath)))
      .orderBy(desc(ocrJobs.createdAt));

    const images: Array<{
      jobId: string;
      thumbnailUrl: SignedDownloadUrl | null;
      thumbnailKey: string | null;
      zipUrl: SignedDownloadUrl | null;
      sizeBytes: number | null;
      filesExist: {
        thumbnail: boolean;
        zip: boolean;
      };
      createdAt: Date | null;
      updatedAt: Date | null;
    }> = [];

    for (const job of jobs) {
      if (!job.rawZipPath) continue;

      const zipExists = await ensureObjectExists(job.rawZipPath);
      const zipUrl = zipExists
        ? await createSignedDownloadUrl({
            key: job.rawZipPath,
            responseContentType: "application/zip",
            downloadFilename: `${job.jobId}-raw.zip`,
          })
        : null;

      let thumbnailUrl: SignedDownloadUrl | null = null;
      let thumbnailExists = false;

      if (job.thumbnailKey) {
        thumbnailExists = await ensureObjectExists(job.thumbnailKey);
        if (thumbnailExists) {
          thumbnailUrl = await createSignedThumbnailUrl(job.thumbnailKey);
        }
      }

      images.push({
        jobId: job.jobId,
        thumbnailUrl,
        thumbnailKey: job.thumbnailKey ?? null,
        zipUrl,
        sizeBytes: job.rawZipSizeBytes ?? null,
        filesExist: {
          thumbnail: thumbnailExists,
          zip: zipExists,
        },
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      });
    }

    return images;
  }),

  getStorageStats: protectedProcedure.query(async ({ ctx }) => {
    const jobs = await ctx.db
      .select()
      .from(ocrJobs)
      .where(eq(ocrJobs.userId, ctx.userId));

    let totalTxtBytes = 0;
    let totalDocxBytes = 0;
    let totalZipBytes = 0;

    for (const job of jobs) {
      if (job.txtSizeBytes) {
        totalTxtBytes += job.txtSizeBytes;
      }
      if (job.docxSizeBytes) {
        totalDocxBytes += job.docxSizeBytes;
      }
      if (job.rawZipSizeBytes) {
        totalZipBytes += job.rawZipSizeBytes;
      }
    }

    const totalBytes = totalTxtBytes + totalDocxBytes + totalZipBytes;

    return {
      totalBytes,
      breakdown: {
        txtBytes: totalTxtBytes,
        docxBytes: totalDocxBytes,
        zipBytes: totalZipBytes,
      },
    };
  }),

  getDashboardMetrics: protectedProcedure.query(async ({ ctx }) => {
    // Get all jobs for statistics (filtered by userId)
    const allJobs = await ctx.db
      .select()
      .from(ocrJobs)
      .where(eq(ocrJobs.userId, ctx.userId));

    // Calculate job statistics
    const totalJobs = allJobs.length;
    const completedJobs = allJobs.filter((job) => job.status === JobsStatus.DONE).length;
    const failedJobs = allJobs.filter((job) => job.status === JobsStatus.ERROR).length;
    const processingJobs = allJobs.filter(
      (job) => job.status === JobsStatus.PROCESSING || job.status === JobsStatus.PENDING
    ).length;

    // Get documents count (filtered by userId)
    const jobsWithDocuments = await ctx.db
      .select()
      .from(ocrJobs)
      .where(
        and(
          eq(ocrJobs.userId, ctx.userId),
          or(isNotNull(ocrJobs.txtPath), isNotNull(ocrJobs.docxPath))
        )
      );

    let totalDocuments = 0;
    let txtCount = 0;
    let docxCount = 0;

    for (const job of jobsWithDocuments) {
      if (job.txtPath) {
        totalDocuments++;
        txtCount++;
      }
      if (job.docxPath) {
        totalDocuments++;
        docxCount++;
      }
    }

    // Get images count (filtered by userId)
    const jobsWithImages = await ctx.db
      .select()
      .from(ocrJobs)
      .where(and(eq(ocrJobs.userId, ctx.userId), isNotNull(ocrJobs.rawZipPath)));

    const totalImages = jobsWithImages.length;
    const imagesWithThumbnails = jobsWithImages.filter(
      (job) => job.thumbnailKey !== null
    ).length;

    // Calculate storage stats
    let totalTxtBytes = 0;
    let totalDocxBytes = 0;
    let totalZipBytes = 0;

    for (const job of allJobs) {
      if (job.txtSizeBytes) {
        totalTxtBytes += job.txtSizeBytes;
      }
      if (job.docxSizeBytes) {
        totalDocxBytes += job.docxSizeBytes;
      }
      if (job.rawZipSizeBytes) {
        totalZipBytes += job.rawZipSizeBytes;
      }
    }

    const totalStorage = totalTxtBytes + totalDocxBytes + totalZipBytes;

    return {
      jobs: {
        total: totalJobs,
        completed: completedJobs,
        failed: failedJobs,
        processing: processingJobs,
      },
      documents: {
        total: totalDocuments,
        txt: txtCount,
        docx: docxCount,
      },
      images: {
        total: totalImages,
        withThumbnails: imagesWithThumbnails,
      },
      storage: {
        totalBytes: totalStorage,
        breakdown: {
          txtBytes: totalTxtBytes,
          docxBytes: totalDocxBytes,
          zipBytes: totalZipBytes,
        },
      },
    };
  }),

  deleteAllUserStorage: protectedProcedure.mutation(async ({ ctx }) => {
    const jobs = await ctx.db
      .select()
      .from(ocrJobs)
      .where(eq(ocrJobs.userId, ctx.userId));

    const keysToDelete: string[] = [];

    for (const job of jobs) {
      if (job.txtPath) keysToDelete.push(job.txtPath);
      if (job.docxPath) keysToDelete.push(job.docxPath);
      if (job.rawZipPath) keysToDelete.push(job.rawZipPath);
      if (job.thumbnailKey) keysToDelete.push(job.thumbnailKey);
      if (job.zipPath) keysToDelete.push(job.zipPath);
    }

    // Delete all objects
    let deletedCount = 0;
    const batchSize = 1000;
    for (let i = 0; i < keysToDelete.length; i += batchSize) {
      const batch = keysToDelete.slice(i, i + batchSize);
      for (const key of batch) {
        try {
          await deleteObjectIfExists(key);
          deletedCount++;
        } catch {
          // Ignore errors
        }
      }
    }

    // Update all jobs to clear paths
    await ctx.db
      .update(ocrJobs)
      .set({
        txtPath: null,
        docxPath: null,
        rawZipPath: null,
        thumbnailKey: null,
        txtSizeBytes: null,
        docxSizeBytes: null,
        rawZipSizeBytes: null,
      });

    return {
      deletedCount,
      jobsUpdated: jobs.length,
      };
    }),
});

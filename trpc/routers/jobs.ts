import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "@/trpc/init";
import { ocrJobs, ocrJobItems, apiKeys } from "@/db/schema";
import {
  createSignedDownloadUrl,
  deleteObjectsByPrefix,
  ensureObjectExists,
  getJobRootKey,
  getJobZipKey,
} from "@/lib/storage";
import { inngest } from "@/inngest/client";
import { JobsStatus, JobStep, JobType, ApiKeyProvider, InngestEvents } from "@/types";
import { JobItemType } from "@/types/enums/jobs/jobItemType.enum";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { QUERY_CONFIG } from "@/constants/query.constants";

export const jobsRouter = createTRPCRouter({
  confirmUpload: protectedProcedure
    .input(
      z.object({
        jobId: z.string(),
        jobType: z.enum([JobType.OCR, JobType.SUBTITLE_REMOVAL]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { jobId, jobType } = input;

      // Only validate API key for OCR jobs
      if (jobType === JobType.OCR) {
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
              "You must add an OpenAI API key in Settings before creating OCR jobs.",
          });
        }
      }

      // Generate the zipKey from the jobId to verify the file exists
      const zipKey = getJobZipKey(ctx.userId, jobId);

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
          jobType,
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

      // Create ORIGINAL_ZIP item
      await ctx.db.insert(ocrJobItems).values({
        jobId,
        itemType: JobItemType.ORIGINAL_ZIP,
        storageKey: zipKey,
        contentType: "application/zip",
        sizeBytes: null, // Can be updated later if we have metadata
      }).onConflictDoNothing();

      // Trigger Inngest event based on job type
      if (jobType === JobType.SUBTITLE_REMOVAL) {
        await inngest.send({
          name: InngestEvents.REMOVE_SUBTITLES,
          data: {
            jobId,
            parentJobId: null,
            zipKey,
            userId: ctx.userId,
          },
        });
      } 
      if (jobType === JobType.OCR) {
        await inngest.send({
          name: InngestEvents.ZIP_UPLOADED,
          data: { jobId, zipKey, userId: ctx.userId },
        });
      }

      return { jobId };
    }),

  listJobs: protectedProcedure
    .input(
      z
        .object({
          limit: z
            .number()
            .min(QUERY_CONFIG.PAGINATION.MIN_LIMIT)
            .max(QUERY_CONFIG.PAGINATION.MAX_LIMIT)
            .default(QUERY_CONFIG.PAGINATION.DEFAULT_LIMIT),
          offset: z
            .number()
            .min(QUERY_CONFIG.PAGINATION.MIN_OFFSET)
            .default(QUERY_CONFIG.PAGINATION.DEFAULT_OFFSET),
          type: z
            .enum([JobType.OCR, JobType.SUBTITLE_REMOVAL, "all"])
            .optional()
            .default(QUERY_CONFIG.JOBS.DEFAULT_TYPE),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      try {
      const limit = input?.limit ?? QUERY_CONFIG.PAGINATION.DEFAULT_LIMIT;
      const offset = input?.offset ?? QUERY_CONFIG.PAGINATION.DEFAULT_OFFSET;
      const jobTypeFilter = input?.type ?? QUERY_CONFIG.JOBS.DEFAULT_TYPE;

      const baseConditions = [eq(ocrJobs.userId, ctx.userId)];
      
      // Add job type filter if not "all"
      if (jobTypeFilter !== "all") {
        baseConditions.push(eq(ocrJobs.jobType, jobTypeFilter));
      }

      const whereCondition = and(...baseConditions);

      const [{ count: total }] = await ctx.db
        .select({ count: sql<number>`count(*)`.as("count") })
        .from(ocrJobs)
        .where(whereCondition);

      // Get paginated jobs with items using LEFT JOIN
      const jobsWithItems = await ctx.db
        .select({
          // Job fields
          ocrJobId: ocrJobs.ocrJobId,
          jobId: ocrJobs.jobId,
          userId: ocrJobs.userId,
          jobType: ocrJobs.jobType,
          parentJobId: ocrJobs.parentJobId,
          status: ocrJobs.status,
          step: ocrJobs.step,
          error: ocrJobs.error,
          totalBatches: ocrJobs.totalBatches,
          batchesCompleted: ocrJobs.batchesCompleted,
          submittedImages: ocrJobs.submittedImages,
          totalImages: ocrJobs.totalImages,
          processedImages: ocrJobs.processedImages,
          createdAt: ocrJobs.createdAt,
          updatedAt: ocrJobs.updatedAt,
          // Item fields (nullable)
          itemType: ocrJobItems.itemType,
        })
        .from(ocrJobs)
        .leftJoin(
          ocrJobItems,
          and(
            eq(ocrJobItems.jobId, ocrJobs.jobId),
            or(
              eq(ocrJobItems.itemType, JobItemType.TXT_DOCUMENT),
              eq(ocrJobItems.itemType, JobItemType.DOCX_DOCUMENT),
              eq(ocrJobItems.itemType, JobItemType.RAW_ZIP),
              eq(ocrJobItems.itemType, JobItemType.CROPPED_ZIP)
            )
          )
        )
        .where(whereCondition)
        .orderBy(desc(ocrJobs.createdAt))
        .limit(limit)
        .offset(offset);

      // Group items by jobId
      const jobsMap = new Map<string, typeof jobsWithItems[0] & { items: Set<JobItemType> }>();
      
      for (const row of jobsWithItems) {
        const jobId = row.jobId;
        if (!jobsMap.has(jobId)) {
          jobsMap.set(jobId, {
            ...row,
            items: new Set<JobItemType>(),
          });
        }
        const job = jobsMap.get(jobId)!;
        if (row.itemType) {
          job.items.add(row.itemType);
        }
      }

      // Get storage keys for items
      const uniqueJobIds = Array.from(jobsMap.keys());
      const allItems = uniqueJobIds.length > 0
        ? await ctx.db
            .select()
            .from(ocrJobItems)
            .where(
              and(
                or(...uniqueJobIds.map((id) => eq(ocrJobItems.jobId, id))),
                or(
                  eq(ocrJobItems.itemType, JobItemType.TXT_DOCUMENT),
                  eq(ocrJobItems.itemType, JobItemType.DOCX_DOCUMENT),
                  eq(ocrJobItems.itemType, JobItemType.RAW_ZIP),
                  eq(ocrJobItems.itemType, JobItemType.CROPPED_ZIP)
                )
              )
            )
        : [];

      // Map items by jobId and type
      const itemsByJob = new Map<string, Map<JobItemType, typeof allItems[0]>>();
      for (const item of allItems) {
        if (!itemsByJob.has(item.jobId)) {
          itemsByJob.set(item.jobId, new Map());
        }
        itemsByJob.get(item.jobId)!.set(item.itemType, item);
      }

      // Generate signed URLs for all items
      const jobsWithUrls = await Promise.all(
        Array.from(jobsMap.values()).map(async (job) => {
          const jobItems = itemsByJob.get(job.jobId);
          const txtItem = jobItems?.get(JobItemType.TXT_DOCUMENT);
          const docxItem = jobItems?.get(JobItemType.DOCX_DOCUMENT);
          const rawZipItem = jobItems?.get(JobItemType.RAW_ZIP);
          const croppedZipItem = jobItems?.get(JobItemType.CROPPED_ZIP);

          const [txtUrl, docxUrl, rawZipUrl, croppedZipUrl] = await Promise.all([
            txtItem?.storageKey
              ? createSignedDownloadUrl({
                  key: txtItem.storageKey,
                  responseContentType: "text/plain",
                  downloadFilename: `${job.jobId}.txt`,
                })
              : Promise.resolve(null),
            docxItem?.storageKey
              ? createSignedDownloadUrl({
                  key: docxItem.storageKey,
                  responseContentType:
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                  downloadFilename: `${job.jobId}.docx`,
                })
              : Promise.resolve(null),
            rawZipItem?.storageKey
              ? createSignedDownloadUrl({
                  key: rawZipItem.storageKey,
                  responseContentType: "application/zip",
                  downloadFilename: `${job.jobId}-raw.zip`,
                })
              : Promise.resolve(null),
            croppedZipItem?.storageKey
              ? createSignedDownloadUrl({
                  key: croppedZipItem.storageKey,
                  responseContentType: "application/zip",
                  downloadFilename: `${job.jobId}-cropped.zip`,
                })
              : Promise.resolve(null),
          ]);

          return {
            ...job,
            hasResults: job.items.has(JobItemType.TXT_DOCUMENT) && job.items.has(JobItemType.DOCX_DOCUMENT),
            hasCroppedZip: job.items.has(JobItemType.CROPPED_ZIP),
            txtUrl,
            docxUrl,
            rawZipUrl,
            croppedZipUrl,
          };
        })
      );

      const jobs = jobsWithUrls.map(({ itemType: _, items: __, ...job }) => job);

      return {
        jobs: jobs.map((job) => ({
          jobId: job.jobId,
          jobType: job.jobType,
          parentJobId: job.parentJobId,
          status: job.status,
          step: job.step,
          error: job.error,
          totalImages: job.totalImages,
          processedImages: job.processedImages,
          totalBatches: job.totalBatches,
          batchesCompleted: job.batchesCompleted,
          submittedImages: job.submittedImages,
          hasResults: job.hasResults,
          hasCroppedZip: job.hasCroppedZip,
          txtUrl: job.txtUrl,
          docxUrl: job.docxUrl,
          rawZipUrl: job.rawZipUrl,
          croppedZipUrl: job.croppedZipUrl,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
          progressPct: (() => {
            if (job.status === JobsStatus.DONE) {
              return 100;
            }

            // Different progress calculation based on job type
            if (job.jobType === JobType.SUBTITLE_REMOVAL) {
              // SUBTITLE_REMOVAL only has PREPROCESSING (0-50%) and DONE (100%)
              if (job.step === JobStep.PREPROCESSING) {
                if (job.totalImages > 0) {
                  const progressWithinStep = Math.min(
                    1,
                    Math.max(0, (job.processedImages ?? 0) / job.totalImages)
                  );
                  // PREPROCESSING represents 0-50% for SUBTITLE_REMOVAL
                  return Math.round(progressWithinStep * 50);
                }
                return 0;
              }
              // Other steps should not occur, but return 0 as fallback
              return 0;
            }

            // OCR jobs: Step order and their base progress ranges
            const stepOrder: JobStep[] = [
              JobStep.PREPROCESSING,      // 0-25%
              JobStep.BATCH_SUBMITTED,    // 25-50%
              JobStep.RESULTS_SAVED,     // 50-75%
              JobStep.DOCS_BUILT,         // 75-100%
            ];

            const stepIndex = stepOrder.findIndex((s) => s === job.step);
            if (stepIndex < 0) {
              return 0;
            }

            // Each step represents 25% of total progress
            const stepBaseProgress = stepIndex / stepOrder.length; // 0, 0.25, 0.5, 0.75
            const stepRange = 1 / stepOrder.length; // 0.25 (25% per step)

            let progressWithinStep = 0;

            switch (job.step) {
              case JobStep.PREPROCESSING:
                // Progress within preprocessing based on images processed
                if (job.totalImages > 0) {
                  progressWithinStep = Math.min(
                    1,
                    Math.max(0, (job.processedImages ?? 0) / job.totalImages)
                  );
                }
                break;

              case JobStep.BATCH_SUBMITTED:
                // Progress within batch submission based on batches completed
                if (job.totalBatches > 0) {
                  progressWithinStep = Math.min(
                    1,
                    Math.max(0, (job.batchesCompleted ?? 0) / job.totalBatches)
                  );
                }
                break;

              case JobStep.RESULTS_SAVED:
                // Results saved is usually quick, assume 50% progress within step
                progressWithinStep = 0.5;
                break;

              case JobStep.DOCS_BUILT:
                // Documents built is usually quick, assume 75% progress within step
                progressWithinStep = 0.75;
                break;
            }

            // Calculate overall progress: base step progress + progress within step
            const overall = stepBaseProgress + progressWithinStep * stepRange;

            return Math.round(Math.min(100, Math.max(0, overall * 100)));
          })(),
        })),
        total,
        limit,
        offset,
      };

    } catch (error) {
      console.error(error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to list jobs",
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

      // Get all relevant items for this job
      const items = await ctx.db
        .select()
        .from(ocrJobItems)
        .where(
          and(
            eq(ocrJobItems.jobId, input.jobId),
            or(
              eq(ocrJobItems.itemType, JobItemType.TXT_DOCUMENT),
              eq(ocrJobItems.itemType, JobItemType.DOCX_DOCUMENT),
              eq(ocrJobItems.itemType, JobItemType.RAW_ZIP),
              eq(ocrJobItems.itemType, JobItemType.CROPPED_ZIP)
            )
          )
        );

      // Extract items by type
      const txtItem = items.find((item) => item.itemType === JobItemType.TXT_DOCUMENT);
      const docxItem = items.find((item) => item.itemType === JobItemType.DOCX_DOCUMENT);
      const rawZipItem = items.find((item) => item.itemType === JobItemType.RAW_ZIP);
      const croppedZipItem = items.find((item) => item.itemType === JobItemType.CROPPED_ZIP);

      // Check if job has results (only for OCR jobs)
      const hasTxt = !!txtItem;
      const hasDocx = !!docxItem;
      const hasCroppedZip = !!croppedZipItem;

      // Generate signed URLs for all items
      const [txtUrl, docxUrl, rawZipUrl, croppedZipUrl] = await Promise.all([
        txtItem?.storageKey
          ? createSignedDownloadUrl({
              key: txtItem.storageKey,
              responseContentType: "text/plain",
              downloadFilename: `${job.jobId}.txt`,
            })
          : Promise.resolve(null),
        docxItem?.storageKey
          ? createSignedDownloadUrl({
              key: docxItem.storageKey,
              responseContentType:
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              downloadFilename: `${job.jobId}.docx`,
            })
          : Promise.resolve(null),
        rawZipItem?.storageKey
          ? createSignedDownloadUrl({
              key: rawZipItem.storageKey,
              responseContentType: "application/zip",
              downloadFilename: `${job.jobId}-raw.zip`,
            })
          : Promise.resolve(null),
        croppedZipItem?.storageKey
          ? createSignedDownloadUrl({
              key: croppedZipItem.storageKey,
              responseContentType: "application/zip",
              downloadFilename: `${job.jobId}-cropped.zip`,
            })
          : Promise.resolve(null),
      ]);

      // Calculate progress percentage (same logic as listJobs)
      const progressPct = (() => {
        if (job.status === JobsStatus.DONE) {
          return 100;
        }

        // Different progress calculation based on job type
        if (job.jobType === JobType.SUBTITLE_REMOVAL) {
          // SUBTITLE_REMOVAL only has PREPROCESSING (0-50%) and DONE (100%)
          if (job.step === JobStep.PREPROCESSING) {
            if (job.totalImages > 0) {
              const progressWithinStep = Math.min(
                1,
                Math.max(0, (job.processedImages ?? 0) / job.totalImages)
              );
              // PREPROCESSING represents 0-50% for SUBTITLE_REMOVAL
              return Math.round(progressWithinStep * 50);
            }
            return 0;
          }
          // Other steps should not occur, but return 0 as fallback
          return 0;
        }

        // OCR jobs: Step order and their base progress ranges
        const stepOrder: JobStep[] = [
          JobStep.PREPROCESSING,      // 0-25%
          JobStep.BATCH_SUBMITTED,    // 25-50%
          JobStep.RESULTS_SAVED,     // 50-75%
          JobStep.DOCS_BUILT,         // 75-100%
        ];

        const stepIndex = stepOrder.findIndex((s) => s === job.step);
        if (stepIndex < 0) {
          return 0;
        }

        // Each step represents 25% of total progress
        const stepBaseProgress = stepIndex / stepOrder.length; // 0, 0.25, 0.5, 0.75
        const stepRange = 1 / stepOrder.length; // 0.25 (25% per step)

        let progressWithinStep = 0;

        switch (job.step) {
          case JobStep.PREPROCESSING:
            // Progress within preprocessing based on images processed
            if (job.totalImages > 0) {
              progressWithinStep = Math.min(
                1,
                Math.max(0, (job.processedImages ?? 0) / job.totalImages)
              );
            }
            break;

          case JobStep.BATCH_SUBMITTED:
            // Progress within batch submission based on batches completed
            if (job.totalBatches > 0) {
              progressWithinStep = Math.min(
                1,
                Math.max(0, (job.batchesCompleted ?? 0) / job.totalBatches)
              );
            }
            break;

          case JobStep.RESULTS_SAVED:
            // Results saved is usually quick, assume 50% progress within step
            progressWithinStep = 0.5;
            break;

          case JobStep.DOCS_BUILT:
            // Documents built is usually quick, assume 75% progress within step
            progressWithinStep = 0.75;
            break;
        }

        // Calculate overall progress: base step progress + progress within step
        const overall = stepBaseProgress + progressWithinStep * stepRange;

        return Math.round(Math.min(100, Math.max(0, overall * 100)));
      })();

      return {
        jobId: job.jobId,
        jobType: job.jobType,
        parentJobId: job.parentJobId,
        status: job.status,
        step: job.step,
        error: job.error,
        totalImages: job.totalImages,
        processedImages: job.processedImages,
        totalBatches: job.totalBatches,
        batchesCompleted: job.batchesCompleted,
        submittedImages: job.submittedImages,
        hasResults: hasTxt && hasDocx,
        hasCroppedZip,
        txtUrl,
        docxUrl,
        rawZipUrl,
        croppedZipUrl,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        progressPct,
      };
    }),

  getJobItems: protectedProcedure
    .input(
      z.object({
        jobId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      // Verify job ownership
      const [job] = await ctx.db
        .select()
        .from(ocrJobs)
        .where(
          and(eq(ocrJobs.jobId, input.jobId), eq(ocrJobs.userId, ctx.userId))
        )
        .limit(1);

      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }

      const items = await ctx.db
        .select()
        .from(ocrJobItems)
        .where(eq(ocrJobItems.jobId, input.jobId))
        .orderBy(ocrJobItems.createdAt);

      return items;
    }),

  getJobStorageStats: protectedProcedure
    .input(
      z.object({
        jobId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { jobId } = input;

      // Verify job exists and belongs to user
      const [job] = await ctx.db
        .select({ jobId: ocrJobs.jobId })
        .from(ocrJobs)
        .where(and(eq(ocrJobs.jobId, jobId), eq(ocrJobs.userId, ctx.userId)))
        .limit(1);

      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }

      // Get all items for this job
      const items = await ctx.db
        .select()
        .from(ocrJobItems)
        .where(
          and(
            eq(ocrJobItems.jobId, jobId),
            or(
              eq(ocrJobItems.itemType, JobItemType.TXT_DOCUMENT),
              eq(ocrJobItems.itemType, JobItemType.DOCX_DOCUMENT),
              eq(ocrJobItems.itemType, JobItemType.RAW_ZIP),
              eq(ocrJobItems.itemType, JobItemType.ORIGINAL_ZIP),
              eq(ocrJobItems.itemType, JobItemType.CROPPED_ZIP)
            )
          )
        );

      let totalTxtBytes = 0;
      let totalDocxBytes = 0;
      let totalZipBytes = 0;
      let originalZipBytes = 0;
      let croppedZipBytes = 0;

      for (const item of items) {
        const size = item.sizeBytes ?? 0;
        if (item.itemType === JobItemType.TXT_DOCUMENT) {
          totalTxtBytes += size;
        }
        if (item.itemType === JobItemType.DOCX_DOCUMENT) {
          totalDocxBytes += size;
        }
        if (item.itemType === JobItemType.RAW_ZIP) {
          totalZipBytes += size;
        }
        if (item.itemType === JobItemType.ORIGINAL_ZIP) {
          originalZipBytes += size;
        }
        if (item.itemType === JobItemType.CROPPED_ZIP) {
          croppedZipBytes += size;
        }
      }

      const totalBytes = totalTxtBytes + totalDocxBytes + totalZipBytes + originalZipBytes + croppedZipBytes;

      return {
        jobId,
        totalBytes,
        breakdown: {
          txtBytes: totalTxtBytes,
          docxBytes: totalDocxBytes,
          rawZipBytes: totalZipBytes,
          originalZipBytes,
          croppedZipBytes,
        },
      };
    }),

  deleteJob: protectedProcedure
    .input(
      z.object({
        jobId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { jobId } = input;

      // Load job metadata by jobId
      const [job] = await ctx.db
        .select()
        .from(ocrJobs)
        .where(eq(ocrJobs.jobId, jobId))
        .limit(1);

      // Handle missing job
      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }

      // Verify ownership
      if (job.userId !== ctx.userId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to delete this job",
        });
      }

      const errors: string[] = [];

      try {
        // Delete all files under the job's root prefix (includes zip, crops, thumbnail, normalized images, etc.)
        const jobRootPrefix = getJobRootKey(ctx.userId, jobId);
        try {
          await deleteObjectsByPrefix(jobRootPrefix);
        } catch (error) {
          errors.push(
            `Failed to delete files under job root: ${error instanceof Error ? error.message : "Unknown error"}`
          );
        }

        // Delete the job from database (frames will be deleted automatically via cascade)
        await ctx.db.delete(ocrJobs).where(eq(ocrJobs.jobId, jobId));

        // If there were errors but we still deleted the job, log them but don't fail
        if (errors.length > 0) {
          console.warn(
            `Job ${jobId} deleted from database, but some files failed to delete:`,
            errors
          );
        }

        return {
          jobId,
          deleted: true,
          errors: errors.length > 0 ? errors : undefined,
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to delete job: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
      }
    }),
});


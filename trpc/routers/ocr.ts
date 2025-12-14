import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "@/trpc/init";
import { ocrJobs, ocrJobItems } from "@/db/schema";
import { inngest } from "@/inngest/client";
import {
  createSignedDownloadUrl,
  createSignedThumbnailUrl,
  createSignedUploadUrl,
  deleteObjectIfExists,
  deleteObjectsByPrefix,
  ensureObjectExists,
  getJobZipKey,
  getUserRootKey,
  type SignedDownloadUrl,
} from "@/lib/storage";
import { InngestEvents, JobsStatus, JobStep, JobType, ApiKeyProvider, Document } from "@/types";
import { JobItemType } from "@/types/enums/jobs/jobItemType.enum";
import { createId } from "@paralleldrive/cuid2";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { QUERY_CONFIG } from "@/constants/query.constants";

export const ocrRouter = createTRPCRouter({
  uploadZip: protectedProcedure
    .input(
      z.object({
        fileType: z.string().min(1).max(128).optional(),
        filename: z.string(),
        fileSize: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const jobId = createId();
      const zipKey = getJobZipKey(ctx.userId, jobId);

      const signedUpload = await createSignedUploadUrl({
        key: zipKey,
        contentType: input.fileType ?? "application/zip",
      });

      return {
        jobId,
        upload: signedUpload,
      };
    }),

  abortUpload: protectedProcedure
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

      // Delete the uploaded file
      const zipKey = getJobZipKey(ctx.userId, jobId);
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

      // Get ORIGINAL_ZIP item
      const [originalZipItem] = await ctx.db
        .select()
        .from(ocrJobItems)
        .where(
          and(
            eq(ocrJobItems.jobId, jobId),
            eq(ocrJobItems.itemType, JobItemType.ORIGINAL_ZIP)
          )
        )
        .limit(1);

      if (!originalZipItem) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Original ZIP not found for this job",
        });
      }

      const zipExists = await ensureObjectExists(originalZipItem.storageKey);
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
          zipKey: originalZipItem.storageKey,
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

      // Get ORIGINAL_ZIP item
      const [originalZipItem] = await ctx.db
        .select()
        .from(ocrJobItems)
        .where(
          and(
            eq(ocrJobItems.jobId, jobId),
            eq(ocrJobItems.itemType, JobItemType.ORIGINAL_ZIP)
          )
        )
        .limit(1);

      if (!originalZipItem) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Original ZIP not found for this job",
        });
      }

      const zipExists = await ensureObjectExists(originalZipItem.storageKey);
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
          zipKey: originalZipItem.storageKey,
          userId: ctx.userId,
        },
      });

      return { jobId, step, status: JobsStatus.PROCESSING };
    }),

  getResult: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Verify job ownership
      const [job] = await ctx.db
        .select()
        .from(ocrJobs)
        .where(and(eq(ocrJobs.jobId, input.jobId), eq(ocrJobs.userId, ctx.userId)))
        .limit(1);

      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      }

      // Get all items by type in a single query
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

      // Get keys from items
      const txtKey = txtItem?.storageKey ?? null;
      const docxKey = docxItem?.storageKey ?? null;
      const rawZipKey = rawZipItem?.storageKey ?? null;
      const croppedZipKey = croppedZipItem?.storageKey ?? null;

      // For OCR jobs, require TXT and DOCX. For SUBTITLE_REMOVAL jobs, only require cropped ZIP
      if (job.jobType === JobType.OCR) {
        if (!txtKey || !docxKey) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Result not ready" });
        }
      }

      const [txtUrl, docxUrl, rawZipUrl, croppedZipUrl] = await Promise.all([
        txtKey
          ? createSignedDownloadUrl({
              key: txtKey,
              responseContentType: "text/plain",
              downloadFilename: `${job.jobId}.txt`,
            })
          : Promise.resolve(null),
        docxKey
          ? createSignedDownloadUrl({
              key: docxKey,
              responseContentType:
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              downloadFilename: `${job.jobId}.docx`,
            })
          : Promise.resolve(null),
        rawZipKey
          ? createSignedDownloadUrl({
              key: rawZipKey,
              responseContentType: "application/zip",
              downloadFilename: `${job.jobId}-raw.zip`,
            })
          : Promise.resolve(null),
        croppedZipKey
          ? createSignedDownloadUrl({
              key: croppedZipKey,
              responseContentType: "application/zip",
              downloadFilename: `${job.jobId}-cropped.zip`,
            })
          : Promise.resolve(null),
      ]);

      return {
        txt: txtUrl,
        docx: docxUrl,
        rawZip: rawZipUrl,
        croppedZip: croppedZipUrl,
      };
  }),

  listDocuments: protectedProcedure
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
            .enum(["txt", "docx", "all"])
            .optional()
            .default(QUERY_CONFIG.DOCUMENTS.DEFAULT_TYPE),
          jobId: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? QUERY_CONFIG.PAGINATION.DEFAULT_LIMIT;
      const offset = input?.offset ?? QUERY_CONFIG.PAGINATION.DEFAULT_OFFSET;
      const documentType = input?.type ?? QUERY_CONFIG.DOCUMENTS.DEFAULT_TYPE;
      const jobIdFilter = input?.jobId?.trim();

      // Build base conditions
      const baseConditions = [eq(ocrJobs.userId, ctx.userId)];

      // Add jobId filter if provided
      if (jobIdFilter) {
        baseConditions.push(like(ocrJobs.jobId, `%${jobIdFilter}%`));
      }

      // Build document type filter for items
      const documentTypeFilters: JobItemType[] = [];
      if (documentType === "all" || documentType === "txt") {
        documentTypeFilters.push(JobItemType.TXT_DOCUMENT);
      }
      if (documentType === "all" || documentType === "docx") {
        documentTypeFilters.push(JobItemType.DOCX_DOCUMENT);
      }

      // Get total count of unique jobs with documents matching the filter (compatible with Neon HTTP)
      const [{ count: total }] = await ctx.db
        .select({ count: sql<number>`count(distinct ${ocrJobs.jobId})`.as("count") })
        .from(ocrJobs)
        .innerJoin(
          ocrJobItems,
          and(
            eq(ocrJobItems.jobId, ocrJobs.jobId),
            or(...documentTypeFilters.map((type) => eq(ocrJobItems.itemType, type)))
          )
        )
        .where(and(...baseConditions));

      // Get paginated jobs with items
      // Use INNER JOIN to filter only jobs with documents matching the filter
      const jobsWithItems = await ctx.db
        .select({
          jobId: ocrJobs.jobId,
          createdAt: ocrJobs.createdAt,
          updatedAt: ocrJobs.updatedAt,
          itemType: ocrJobItems.itemType,
          storageKey: ocrJobItems.storageKey,
          sizeBytes: ocrJobItems.sizeBytes,
        })
        .from(ocrJobs)
        .innerJoin(
          ocrJobItems,
          and(
            eq(ocrJobItems.jobId, ocrJobs.jobId),
            or(...documentTypeFilters.map((type) => eq(ocrJobItems.itemType, type)))
          )
        )
        .where(and(...baseConditions))
        .groupBy(ocrJobs.jobId, ocrJobs.createdAt, ocrJobs.updatedAt, ocrJobItems.itemType, ocrJobItems.storageKey, ocrJobItems.sizeBytes)
        .orderBy(desc(ocrJobs.createdAt))
        .limit(limit)
        .offset(offset);

      if (jobsWithItems.length === 0) {
        return {
          documents: [],
          total,
          limit,
          offset,
        };
      }

      const paginatedJobIds = Array.from(new Set(jobsWithItems.map((j) => j.jobId)));
      const jobsMap = new Map(
        jobsWithItems.map((j) => [j.jobId, { createdAt: j.createdAt, updatedAt: j.updatedAt }])
      );

      // Get all items (documents + thumbnails) for these paginated jobs in one query
      const allItems = paginatedJobIds.length > 0
        ? await ctx.db
            .select()
            .from(ocrJobItems)
            .where(
              and(
                or(...paginatedJobIds.map((id) => eq(ocrJobItems.jobId, id))),
                or(
                  ...documentTypeFilters.map((type) => eq(ocrJobItems.itemType, type)),
                  eq(ocrJobItems.itemType, JobItemType.THUMBNAIL)
                )
              )
            )
        : [];

      // Group items by jobId
      const itemsByJob = new Map<
        string,
        Map<JobItemType, { storageKey: string; sizeBytes: number | null }>
      >();

      for (const item of allItems) {
        if (!itemsByJob.has(item.jobId)) {
          itemsByJob.set(item.jobId, new Map());
        }
        const jobItems = itemsByJob.get(item.jobId)!;
        if (item.storageKey) {
          jobItems.set(item.itemType, {
            storageKey: item.storageKey,
            sizeBytes: item.sizeBytes,
          });
        }
      }

      // Build documents array with signed URLs
      const documents: Document[] = [];

      for (const jobId of paginatedJobIds) {
        const jobInfo = jobsMap.get(jobId);
        if (!jobInfo) continue;

        const jobItems = itemsByJob.get(jobId);
        if (!jobItems) continue;

        const txtItem = jobItems.get(JobItemType.TXT_DOCUMENT);
        const docxItem = jobItems.get(JobItemType.DOCX_DOCUMENT);
        const thumbnailItem = jobItems.get(JobItemType.THUMBNAIL);

        // Get thumbnail URL if exists
        let thumbnailUrl: SignedDownloadUrl | null = null;
        const thumbnailKey = thumbnailItem?.storageKey ?? null;
        if (thumbnailKey) {
          const thumbnailExists = await ensureObjectExists(thumbnailKey);
          if (thumbnailExists) {
            thumbnailUrl = await createSignedThumbnailUrl(thumbnailKey);
          }
        }

        // Build document files
        let txtFile: Document["txt"] = null;
        let docxFile: Document["docx"] = null;

        // TXT document
        if (txtItem && (documentType === "all" || documentType === "txt")) {
          const exists = await ensureObjectExists(txtItem.storageKey);
          const url = exists
            ? await createSignedDownloadUrl({
                key: txtItem.storageKey,
                responseContentType: "text/plain",
                downloadFilename: `${jobId}.txt`,
              })
            : null;

          txtFile = {
            type: "txt",
            sizeBytes: txtItem.sizeBytes,
            url,
            filesExist: exists,
          };
        }

        // DOCX document
        if (docxItem && (documentType === "all" || documentType === "docx")) {
          const exists = await ensureObjectExists(docxItem.storageKey);
          const url = exists
            ? await createSignedDownloadUrl({
                key: docxItem.storageKey,
                responseContentType:
                  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                downloadFilename: `${jobId}.docx`,
              })
            : null;

          docxFile = {
            type: "docx",
            sizeBytes: docxItem.sizeBytes,
            url,
            filesExist: exists,
          };
        }

        // Only add job if it has at least one document matching the filter
        if (txtFile || docxFile) {
          documents.push({
            jobId,
            txt: txtFile,
            docx: docxFile,
            thumbnailUrl,
            thumbnailKey,
            createdAt: jobInfo.createdAt,
            updatedAt: jobInfo.updatedAt,
          });
        }
      }

      return {
        documents,
        total,
        limit,
        offset,
      };
    }),

  getAllImages: protectedProcedure.query(async ({ ctx }) => {
    const jobs = await ctx.db
      .select()
      .from(ocrJobs)
      .where(eq(ocrJobs.userId, ctx.userId))
      .orderBy(desc(ocrJobs.createdAt));

    const images: Array<{
      jobId: string;
      thumbnailUrl: SignedDownloadUrl | null;
      thumbnailKey: string | null;
      zipUrl: SignedDownloadUrl | null;
      croppedZipUrl: SignedDownloadUrl | null;
      sizeBytes: number | null;
      croppedSizeBytes: number | null;
      filesExist: {
        thumbnail: boolean;
        zip: boolean;
        croppedZip: boolean;
      };
      createdAt: Date | null;
      updatedAt: Date | null;
    }> = [];

    for (const job of jobs) {
      // Get items for this job
      const jobItems = await ctx.db
        .select()
        .from(ocrJobItems)
        .where(eq(ocrJobItems.jobId, job.jobId));

      const rawZipItem = jobItems.find((item) => item.itemType === JobItemType.RAW_ZIP);
      const croppedZipItem = jobItems.find((item) => item.itemType === JobItemType.CROPPED_ZIP);
      const thumbnailItem = jobItems.find((item) => item.itemType === JobItemType.THUMBNAIL);

      const rawZipKey = rawZipItem?.storageKey ?? null;
      if (!rawZipKey) continue;

      const zipExists = await ensureObjectExists(rawZipKey);
      const zipUrl = zipExists
        ? await createSignedDownloadUrl({
            key: rawZipKey,
            responseContentType: "application/zip",
            downloadFilename: `${job.jobId}-raw.zip`,
          })
        : null;

      const croppedZipKey = croppedZipItem?.storageKey ?? null;
      let croppedZipUrl: SignedDownloadUrl | null = null;
      let croppedZipExists = false;
      if (croppedZipKey) {
        croppedZipExists = await ensureObjectExists(croppedZipKey);
        if (croppedZipExists) {
          croppedZipUrl = await createSignedDownloadUrl({
            key: croppedZipKey,
            responseContentType: "application/zip",
            downloadFilename: `${job.jobId}-cropped.zip`,
          });
        }
      }

      let thumbnailUrl: SignedDownloadUrl | null = null;
      let thumbnailExists = false;
      const thumbnailKey = thumbnailItem?.storageKey ?? null;

      if (thumbnailKey) {
        thumbnailExists = await ensureObjectExists(thumbnailKey);
        if (thumbnailExists) {
          thumbnailUrl = await createSignedThumbnailUrl(thumbnailKey);
        }
      }

      images.push({
        jobId: job.jobId,
        thumbnailUrl,
        thumbnailKey,
        zipUrl,
        croppedZipUrl,
        sizeBytes: rawZipItem?.sizeBytes ?? null,
        croppedSizeBytes: croppedZipItem?.sizeBytes ?? null,
        filesExist: {
          thumbnail: thumbnailExists,
          zip: zipExists,
          croppedZip: croppedZipExists,
        },
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      });
    }

    return images;
  }),

  listImages: protectedProcedure
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
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? QUERY_CONFIG.PAGINATION.DEFAULT_LIMIT;
      const offset = input?.offset ?? QUERY_CONFIG.PAGINATION.DEFAULT_OFFSET;

      const jobs = await ctx.db
        .select()
        .from(ocrJobs)
        .where(eq(ocrJobs.userId, ctx.userId))
        .orderBy(desc(ocrJobs.createdAt));

      const images: Array<{
        jobId: string;
        thumbnailUrl: SignedDownloadUrl | null;
        thumbnailKey: string | null;
        zipUrl: SignedDownloadUrl | null;
        croppedZipUrl: SignedDownloadUrl | null;
        sizeBytes: number | null;
        croppedSizeBytes: number | null;
        filesExist: {
          thumbnail: boolean;
          zip: boolean;
          croppedZip: boolean;
        };
        createdAt: Date | null;
        updatedAt: Date | null;
      }> = [];

      for (const job of jobs) {
        // Get items for this job
        const jobItems = await ctx.db
          .select()
          .from(ocrJobItems)
          .where(eq(ocrJobItems.jobId, job.jobId));

        const rawZipItem = jobItems.find((item) => item.itemType === JobItemType.RAW_ZIP);
        const croppedZipItem = jobItems.find((item) => item.itemType === JobItemType.CROPPED_ZIP);
        const thumbnailItem = jobItems.find((item) => item.itemType === JobItemType.THUMBNAIL);

        const rawZipKey = rawZipItem?.storageKey ?? null;
        if (!rawZipKey) continue;

        const zipExists = await ensureObjectExists(rawZipKey);
        const zipUrl = zipExists
          ? await createSignedDownloadUrl({
              key: rawZipKey,
              responseContentType: "application/zip",
              downloadFilename: `${job.jobId}-raw.zip`,
            })
          : null;

        const croppedZipKey = croppedZipItem?.storageKey ?? null;
        let croppedZipUrl: SignedDownloadUrl | null = null;
        let croppedZipExists = false;
        if (croppedZipKey) {
          croppedZipExists = await ensureObjectExists(croppedZipKey);
          if (croppedZipExists) {
            croppedZipUrl = await createSignedDownloadUrl({
              key: croppedZipKey,
              responseContentType: "application/zip",
              downloadFilename: `${job.jobId}-cropped.zip`,
            });
          }
        }

        let thumbnailUrl: SignedDownloadUrl | null = null;
        let thumbnailExists = false;
        const thumbnailKey = thumbnailItem?.storageKey ?? null;

        if (thumbnailKey) {
          thumbnailExists = await ensureObjectExists(thumbnailKey);
          if (thumbnailExists) {
            thumbnailUrl = await createSignedThumbnailUrl(thumbnailKey);
          }
        }

        images.push({
          jobId: job.jobId,
          thumbnailUrl,
          thumbnailKey,
          zipUrl,
          croppedZipUrl,
          sizeBytes: rawZipItem?.sizeBytes ?? null,
          croppedSizeBytes: croppedZipItem?.sizeBytes ?? null,
          filesExist: {
            thumbnail: thumbnailExists,
            zip: zipExists,
            croppedZip: croppedZipExists,
          },
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
        });
      }

      // Apply pagination to the images array
      const total = images.length;
      const paginatedImages = images.slice(offset, offset + limit);

      return {
        images: paginatedImages,
        total,
        limit,
        offset,
      };
    }),

  getStorageStats: protectedProcedure.query(async ({ ctx }) => {
    // Get all jobs for the user
    const jobs = await ctx.db
      .select({ jobId: ocrJobs.jobId })
      .from(ocrJobs)
      .where(eq(ocrJobs.userId, ctx.userId));

    const jobIds = jobs.map((j) => j.jobId);

    if (jobIds.length === 0) {
      return {
        totalBytes: 0,
        breakdown: {
          txtBytes: 0,
          docxBytes: 0,
          rawZipBytes: 0,
          originalZipBytes: 0,
          croppedZipBytes: 0,
        },
      };
    }

    // Get all items for these jobs
    const items = await ctx.db
      .select()
      .from(ocrJobItems)
      .where(
        and(
          or(...jobIds.map((id: string) => eq(ocrJobItems.jobId, id))),
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

  getDashboardMetrics: protectedProcedure.query(async ({ ctx }) => {
    // Get all jobs with their status in one query
    const allJobs = await ctx.db
      .select({ jobId: ocrJobs.jobId, status: ocrJobs.status })
      .from(ocrJobs)
      .where(eq(ocrJobs.userId, ctx.userId));

    // Get all relevant items in one query
    const allItems = await ctx.db
      .select({
        jobId: ocrJobItems.jobId,
        itemType: ocrJobItems.itemType,
        sizeBytes: ocrJobItems.sizeBytes,
      })
      .from(ocrJobItems)
      .innerJoin(ocrJobs, eq(ocrJobItems.jobId, ocrJobs.jobId))
      .where(
        and(
          eq(ocrJobs.userId, ctx.userId),
          or(
            eq(ocrJobItems.itemType, JobItemType.TXT_DOCUMENT),
            eq(ocrJobItems.itemType, JobItemType.DOCX_DOCUMENT),
            eq(ocrJobItems.itemType, JobItemType.RAW_ZIP),
            eq(ocrJobItems.itemType, JobItemType.THUMBNAIL)
          )
        )
      );

    // Process jobs statistics
    const totalJobs = allJobs.length;
    const completedJobs = allJobs.filter((job) => job.status === JobsStatus.DONE).length;
    const failedJobs = allJobs.filter((job) => job.status === JobsStatus.ERROR).length;
    const processingJobs = allJobs.filter(
      (job) => job.status === JobsStatus.PROCESSING || job.status === JobsStatus.PENDING
    ).length;

    // Process items statistics
    const jobsWithTxt = new Set(
      allItems.filter((item) => item.itemType === JobItemType.TXT_DOCUMENT).map((item) => item.jobId)
    );
    const jobsWithDocx = new Set(
      allItems.filter((item) => item.itemType === JobItemType.DOCX_DOCUMENT).map((item) => item.jobId)
    );
    const jobsWithRawZip = new Set(
      allItems.filter((item) => item.itemType === JobItemType.RAW_ZIP).map((item) => item.jobId)
    );
    const jobsWithThumbnail = new Set(
      allItems.filter((item) => item.itemType === JobItemType.THUMBNAIL).map((item) => item.jobId)
    );

    const txtCount = jobsWithTxt.size;
    const docxCount = jobsWithDocx.size;
    const totalDocuments = txtCount + docxCount;
    const totalImages = jobsWithRawZip.size;
    const imagesWithThumbnails = Array.from(jobsWithRawZip).filter((jobId) =>
      jobsWithThumbnail.has(jobId)
    ).length;

    // Calculate storage
    let totalTxtBytes = 0;
    let totalDocxBytes = 0;
    let totalZipBytes = 0;

    for (const item of allItems) {
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
    // Delete all files under the user's root prefix
    const userRootPrefix = getUserRootKey(ctx.userId);
    
    try {
      await deleteObjectsByPrefix(userRootPrefix);
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Failed to delete user storage: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }

    // Get count of jobs for response
    const jobs = await ctx.db
      .select()
      .from(ocrJobs)
      .where(eq(ocrJobs.userId, ctx.userId));

    return {
      deleted: true,
      jobsUpdated: jobs.length,
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

  getJobItemsByType: protectedProcedure
    .input(
      z.object({
        jobId: z.string(),
        itemType: z.nativeEnum(JobItemType),
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
        .where(
          and(
            eq(ocrJobItems.jobId, input.jobId),
            eq(ocrJobItems.itemType, input.itemType)
          )
        )
        .orderBy(ocrJobItems.createdAt);

      return items;
    }),

});

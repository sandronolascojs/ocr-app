import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "@/trpc/init";
import { ocrJobs, ocrJobItems } from "@/db/schema";
import { inngest } from "@/inngest/client";
import {
  ensureObjectExists,
} from "@/lib/storage";
import { InngestEvents, JobsStatus, JobStep, JobType } from "@/types";
import { JobItemType } from "@/types/enums/jobs/jobItemType.enum";
import { createId } from "@paralleldrive/cuid2";
import { TRPCError } from "@trpc/server";
import { and, eq, or } from "drizzle-orm";

export const subtitlesRouter = createTRPCRouter({
  removeSubtitles: protectedProcedure
    .input(
      z.union([
        z.object({ jobId: z.string() }),
        z.object({ zipKey: z.string() }),
      ])
    )
    .mutation(async ({ ctx, input }) => {
      let zipKey: string;
      let parentJobId: string | null = null;

      // Handle two cases: from existing OCR job or from new ZIP
      if ("jobId" in input) {
        const { jobId } = input;

        // Verify job ownership
        const [job] = await ctx.db
          .select()
          .from(ocrJobs)
          .where(
            and(eq(ocrJobs.jobId, jobId), eq(ocrJobs.userId, ctx.userId))
          )
          .limit(1);

        if (!job) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Job not found",
          });
        }

        // Check if job is done
        if (job.status !== JobsStatus.DONE) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Job must be completed before removing subtitles",
          });
        }

        // Check if raw zip exists in items
        const [rawZipItem] = await ctx.db
          .select()
          .from(ocrJobItems)
          .where(
            and(
              eq(ocrJobItems.jobId, jobId),
              eq(ocrJobItems.itemType, JobItemType.RAW_ZIP)
            )
          )
          .limit(1);

        if (!rawZipItem) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Raw ZIP not found. Job must be processed first.",
          });
        }

        zipKey = rawZipItem.storageKey;
        parentJobId = jobId;
      } else {
        // From new ZIP
        const { zipKey: providedZipKey } = input;

        // Verify zip exists in storage
        const exists = await ensureObjectExists(providedZipKey);
        if (!exists) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "ZIP file not found in storage",
          });
        }

        zipKey = providedZipKey;
      }

      // Create new SUBTITLE_REMOVAL job
      const newJobId = createId();
      await ctx.db.insert(ocrJobs).values({
        jobId: newJobId,
        userId: ctx.userId,
        jobType: JobType.SUBTITLE_REMOVAL,
        parentJobId,
        status: JobsStatus.PENDING,
        step: JobStep.PREPROCESSING,
        totalImages: 0,
        processedImages: 0,
      }).returning();

      // Create ORIGINAL_ZIP item for the new job
      await ctx.db.insert(ocrJobItems).values({
        jobId: newJobId,
        itemType: JobItemType.ORIGINAL_ZIP,
        storageKey: zipKey,
        contentType: "application/zip",
      });

      // Send event to Inngest
      await inngest.send({
        name: InngestEvents.REMOVE_SUBTITLES,
        data: {
          jobId: newJobId,
          parentJobId,
          zipKey,
          userId: ctx.userId,
        },
      });

      return {
        jobId: newJobId,
        parentJobId,
        message: "Remove subtitles job started",
      };
    }),
});


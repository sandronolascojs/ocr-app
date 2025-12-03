ALTER TABLE "ocr_job_frames" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ocr_job_frames" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ocr_jobs" ALTER COLUMN "step" SET DEFAULT 'PREPROCESSING';--> statement-breakpoint
ALTER TABLE "ocr_jobs" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ocr_jobs" ALTER COLUMN "updated_at" SET NOT NULL;
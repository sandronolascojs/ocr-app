CREATE TYPE "public"."ocr_job_step" AS ENUM('PREPROCESSING', 'BATCH_SUBMITTED', 'RESULTS_SAVED', 'DOCS_BUILT');--> statement-breakpoint
CREATE TABLE "ocr_job_frames" (
	"ocr_job_frame_id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"filename" text NOT NULL,
	"base_key" text NOT NULL,
	"index" integer NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "ocr_job_frames_ocr_job_frame_id_unique" UNIQUE("ocr_job_frame_id")
);
--> statement-breakpoint
ALTER TABLE "ocr_jobs" ADD COLUMN "step" "ocr_job_step" DEFAULT 'BATCH_SUBMITTED' NOT NULL;--> statement-breakpoint
ALTER TABLE "ocr_jobs" ADD COLUMN "batch_id" text;--> statement-breakpoint
ALTER TABLE "ocr_jobs" ADD COLUMN "batch_input_file_id" text;--> statement-breakpoint
ALTER TABLE "ocr_jobs" ADD COLUMN "batch_output_file_id" text;--> statement-breakpoint
ALTER TABLE "ocr_job_frames" ADD CONSTRAINT "ocr_job_frames_job_id_ocr_jobs_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."ocr_jobs"("job_id") ON DELETE cascade ON UPDATE no action;
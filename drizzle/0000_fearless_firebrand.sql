CREATE TYPE "public"."job_status" AS ENUM('PENDING', 'PROCESSING', 'DONE', 'ERROR');--> statement-breakpoint
CREATE TABLE "ocr_jobs" (
	"ocr_job_id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"status" "job_status" DEFAULT 'PENDING' NOT NULL,
	"error" text,
	"zip_path" text NOT NULL,
	"txt_path" text,
	"docx_path" text,
	"total_images" integer DEFAULT 0 NOT NULL,
	"processed_images" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "ocr_jobs_ocr_job_id_unique" UNIQUE("ocr_job_id"),
	CONSTRAINT "ocr_jobs_job_id_unique" UNIQUE("job_id")
);

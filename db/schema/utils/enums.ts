import { JobsStatus } from "@/types";
import { JobStep } from "@/types/enums/jobs/jobStep.enum";
import { pgEnum } from "drizzle-orm/pg-core";

export const jobStatusEnum = pgEnum("job_status", [
  JobsStatus.PENDING,
  JobsStatus.PROCESSING,
  JobsStatus.DONE,
  JobsStatus.ERROR,
]);

export const jobStepEnum = pgEnum("ocr_job_step", [
  JobStep.PREPROCESSING,
  JobStep.BATCH_SUBMITTED,
  JobStep.RESULTS_SAVED,
  JobStep.DOCS_BUILT,
]);
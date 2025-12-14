"use client"

import { JobsTableView } from "@/views/shared/JobsTableView"
import { JobType } from "@/types"

interface OcrJobsViewProps {}

export const OcrJobsView = ({}: OcrJobsViewProps) => {
  return (
    <JobsTableView
      title="OCR Jobs"
      description="View all your OCR processing jobs"
      defaultJobType={JobType.OCR}
      showJobTypeFilter={false}
    />
  )
}


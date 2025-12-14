"use client"

import { JobsTableView } from "@/views/shared/JobsTableView"
import { JobType } from "@/types"

export const OcrJobsView = () => {
  return (
    <JobsTableView
      title="OCR Jobs"
      description="View all your OCR processing jobs"
      defaultJobType={JobType.OCR}
      showJobTypeFilter={false}
    />
  )
}


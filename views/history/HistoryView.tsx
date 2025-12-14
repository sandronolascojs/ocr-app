"use client"

import { JobsTableView } from "@/views/shared/JobsTableView"

export const HistoryView = () => {
  return (
    <JobsTableView
      title="Job History"
      description="View all your OCR processing jobs and download results"
      defaultJobType="all"
      showJobTypeFilter={true}
    />
  )
}

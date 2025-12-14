"use client"

import { JobsTableView } from "@/views/shared/JobsTableView"

interface HistoryViewProps {}

export const HistoryView = ({}: HistoryViewProps) => {
  return (
    <JobsTableView
      title="Job History"
      description="View all your OCR processing jobs and download results"
      defaultJobType="all"
      showJobTypeFilter={true}
    />
  )
}

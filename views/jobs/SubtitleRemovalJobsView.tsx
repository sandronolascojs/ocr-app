"use client"

import { JobsTableView } from "@/views/shared/JobsTableView"
import { JobType } from "@/types"

interface SubtitleRemovalJobsViewProps {}

export const SubtitleRemovalJobsView = ({}: SubtitleRemovalJobsViewProps) => {
  return (
    <JobsTableView
      title="Subtitle Removal Jobs"
      description="View all your subtitle removal jobs"
      defaultJobType={JobType.SUBTITLE_REMOVAL}
      showJobTypeFilter={false}
    />
  )
}


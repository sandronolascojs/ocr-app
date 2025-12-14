"use client"

import { JobsTableView } from "@/views/shared/JobsTableView"
import { JobType } from "@/types"

export const SubtitleRemovalJobsView = () => {
  return (
    <JobsTableView
      title="Subtitle Removal Jobs"
      description="View all your subtitle removal jobs"
      defaultJobType={JobType.SUBTITLE_REMOVAL}
      showJobTypeFilter={false}
    />
  )
}


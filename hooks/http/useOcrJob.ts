// src/hooks/useOcrJob.ts
import { QUERY_CONFIG } from "@/constants/query.constants";
import { trpc } from "@/trpc/client";
import { JobsStatus } from "@/types";

type UseOcrJobOptions = {
  enabled?: boolean;
  refetchIntervalMs?: number;
};

export const useOcrJob = (jobId: string | null, options?: UseOcrJobOptions) => {
  const {
    enabled = true,
    refetchIntervalMs = QUERY_CONFIG.REFRESH_INTERVAL_MS,
  } = options ?? {};

  const query = trpc.jobs.getJob.useQuery(
    { jobId: jobId ?? "" },
    {
      enabled: Boolean(jobId) && enabled,
      refetchInterval: (queryInstance) => {
        const job = queryInstance.state.data;
        // If there is no job or it is DONE/ERROR, stop the polling
        if (!job?.status) return false;
        if (job.status === JobsStatus.DONE || job.status === JobsStatus.ERROR) return false;
        return refetchIntervalMs;
      },
    }
  );

  return query;
}
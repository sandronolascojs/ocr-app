import { QUERY_CONFIG } from "@/constants/query.constants";
import { trpc } from "@/trpc/client";
import { JobType } from "@/types";

type UseJobsOptions = {
  limit?: number;
  offset?: number;
  type?: JobType | "all";
  enabled?: boolean;
  refetchIntervalMs?: number;
};

export const useJobs = (options?: UseJobsOptions) => {
  const {
    limit = QUERY_CONFIG.DEFAULT_PAGINATION.limit,
    offset = QUERY_CONFIG.DEFAULT_PAGINATION.offset,
    type = QUERY_CONFIG.JOBS.DEFAULT_TYPE,
    enabled = true,
    refetchIntervalMs = QUERY_CONFIG.REFRESH_INTERVAL_MS,
  } = options ?? {};

  const query = trpc.jobs.listJobs.useQuery(
    { limit, offset, type },
    {
      enabled,
      refetchInterval: enabled ? refetchIntervalMs : false,
    }
  );

  return {
    jobs: query.data?.jobs ?? [],
    total: query.data?.total ?? 0,
    limit: query.data?.limit ?? limit,
    offset: query.data?.offset ?? offset,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    isRefetching: query.isRefetching,
    refetch: query.refetch,
  };
};


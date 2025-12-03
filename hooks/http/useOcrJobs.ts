import { QUERY_CONFIG } from "@/constants/query.constants";
import { trpc } from "@/trpc/client";

type UseOcrJobsOptions = {
  limit?: number;
  enabled?: boolean;
  refetchIntervalMs?: number;
};

export const useOcrJobs = (options?: UseOcrJobsOptions) => {
  const {
    limit,
    enabled = true,
    refetchIntervalMs = QUERY_CONFIG.REFRESH_INTERVAL_MS,
  } = options ?? {};

  const query = trpc.ocr.listJobs.useQuery(limit ? { limit } : undefined, {
    enabled,
    refetchInterval: enabled ? refetchIntervalMs : false,
  });

  return {
    jobs: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    isRefetching: query.isRefetching,
    refetch: query.refetch,
  };
};


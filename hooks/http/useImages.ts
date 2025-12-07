import { trpc } from "@/trpc/client";
import { QUERY_CONFIG } from "@/constants/query.constants";

type UseImagesOptions = {
  limit?: number;
  offset?: number;
  enabled?: boolean;
  refetchIntervalMs?: number;
};

export const useImages = (options?: UseImagesOptions) => {
  const {
    limit = QUERY_CONFIG.DEFAULT_PAGINATION.limit,
    offset = QUERY_CONFIG.DEFAULT_PAGINATION.offset,
    enabled = true,
    refetchIntervalMs = QUERY_CONFIG.REFRESH_INTERVAL_MS,
  } = options ?? {};

  const query = trpc.ocr.listImages.useQuery(
    { limit, offset },
    {
      enabled,
      refetchInterval: enabled ? refetchIntervalMs : false,
    }
  );

  return {
    images: query.data?.images ?? [],
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


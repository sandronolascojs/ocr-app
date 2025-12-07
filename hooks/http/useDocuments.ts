import { trpc } from "@/trpc/client";
import { QUERY_CONFIG } from "@/constants/query.constants";

type UseDocumentsOptions = {
  limit?: number;
  offset?: number;
  type?: "txt" | "docx" | "all";
  jobId?: string;
  enabled?: boolean;
  refetchIntervalMs?: number;
};

export const useDocuments = (options?: UseDocumentsOptions) => {
  const {
    limit = QUERY_CONFIG.DEFAULT_PAGINATION.limit,
    offset = QUERY_CONFIG.DEFAULT_PAGINATION.offset,
    type = QUERY_CONFIG.DOCUMENTS.DEFAULT_TYPE,
    jobId,
    enabled = true,
    refetchIntervalMs = QUERY_CONFIG.REFRESH_INTERVAL_MS,
  } = options ?? {};

  const query = trpc.ocr.listDocuments.useQuery(
    { limit, offset, type, jobId },
    {
      enabled,
      refetchInterval: enabled ? refetchIntervalMs : false,
    }
  );

  return {
    documents: query.data?.documents ?? [],
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


import { trpc } from "@/trpc/client";

export const useOcrResult = (jobId: string | null, enabled = true) => {
  const query = trpc.ocr.getResult.useQuery(
    { jobId: jobId ?? "" },
    {
      enabled: Boolean(jobId) && enabled,
    }
  );

  return {
    ocrResult: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    isSuccess: query.isSuccess,
    isPending: query.isPending,
  };
}
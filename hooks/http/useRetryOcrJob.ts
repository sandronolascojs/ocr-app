import { trpc } from "@/trpc/client";

export const useRetryOcrJob = () => {
  const utils = trpc.useUtils();
  const clientMutation = trpc.ocr.retryJob.useMutation({
    onSuccess: (data) => {
      utils.ocr.getJob.invalidate({ jobId: data.jobId });
      utils.ocr.listJobs.invalidate();
    },
  });

  return {
    retryOcrJob: clientMutation.mutateAsync,
    isLoading: clientMutation.isPending,
    isError: clientMutation.isError,
    error: clientMutation.error,
    isSuccess: clientMutation.isSuccess,
    isIdle: clientMutation.isIdle,
  }
}
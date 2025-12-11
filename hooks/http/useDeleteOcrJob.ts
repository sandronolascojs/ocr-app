import { trpc } from "@/trpc/client";
import { toast } from "sonner";

interface UseDeleteOcrJobOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

export const useDeleteOcrJob = (options?: UseDeleteOcrJobOptions) => {
  const utils = trpc.useUtils();

  return trpc.ocr.deleteJob.useMutation({
    onSuccess: (data) => {
      utils.ocr.listJobs.invalidate();
      utils.ocr.getJob.invalidate({ jobId: data.jobId });

      toast.success("Job deleted", {
        description: "The job and all its files have been permanently deleted.",
      });

      options?.onSuccess?.();
    },
    onError: (error) => {
      const errorMessage =
        error instanceof Error ? error.message : error.message || "Unexpected error";
      toast.error("Failed to delete job", {
        description: errorMessage,
      });
      const errorObj = error instanceof Error ? error : new Error(errorMessage);
      options?.onError?.(errorObj);
    },
  });
};


import { trpc } from "@/trpc/client";
import { toast } from "sonner";

interface UseRemoveSubtitlesOptions {
  onError?: (error: Error) => void;
}

export const useRemoveSubtitles = (options?: UseRemoveSubtitlesOptions) => {
  const utils = trpc.useUtils();

  return trpc.subtitles.removeSubtitles.useMutation({
    onSuccess: (data) => {
      utils.ocr.getResult.invalidate({ jobId: data.jobId });
      utils.jobs.getJobItems.invalidate({ jobId: data.jobId });
      utils.jobs.listJobs.invalidate();

      toast.success("Remove subtitles started", {
        description: "The cropped ZIP will be available shortly.",
      });
    },
    onError: (error) => {
      const errorMessage =
        error instanceof Error ? error.message : error.message || "Unexpected error";
      toast.error("Failed to start remove subtitles", {
        description: errorMessage,
      });
      const errorObj = error instanceof Error ? error : new Error(errorMessage);
      options?.onError?.(errorObj);
    },
  });
};


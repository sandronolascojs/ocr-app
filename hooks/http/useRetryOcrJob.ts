import { trpc } from "@/trpc/client"
import { toast } from "sonner"
import { JobStep } from "@/types"

const stepLabel: Record<JobStep, string> = {
  [JobStep.PREPROCESSING]: "1) Preprocessing",
  [JobStep.BATCH_SUBMITTED]: "2) Batch submitted",
  [JobStep.RESULTS_SAVED]: "3) Results saved",
  [JobStep.DOCS_BUILT]: "4) Documents built",
}

interface UseRetryOcrJobOptions {
  currentStep?: JobStep | null
  onSuccess?: () => void
  onError?: (error: Error) => void
}

export const useRetryOcrJob = (options?: UseRetryOcrJobOptions) => {
  const utils = trpc.useUtils()
  
  const clientMutation = trpc.ocr.retryJob.useMutation({
    onSuccess: (data) => {
      utils.ocr.getJob.invalidate({ jobId: data.jobId })
      utils.ocr.listJobs.invalidate()
      
      const stepMessage = options?.currentStep
        ? stepLabel[options.currentStep]
        : "the last step"
      
      toast.success("Job retried", {
        description: `The job will resume from ${stepMessage}.`,
      })
      
      options?.onSuccess?.()
    },
    onError: (error) => {
      const errorMessage = error instanceof Error ? error.message : error.message || "Unexpected error"
      toast.error("Error retrying job", {
        description: errorMessage,
      })
      const errorObj = error instanceof Error ? error : new Error(errorMessage)
      options?.onError?.(errorObj)
    },
  })

  return {
    retryOcrJob: clientMutation.mutateAsync,
    isLoading: clientMutation.isPending,
    isError: clientMutation.isError,
    error: clientMutation.error,
    isSuccess: clientMutation.isSuccess,
    isIdle: clientMutation.isIdle,
  }
}
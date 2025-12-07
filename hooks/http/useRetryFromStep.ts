import { trpc } from "@/trpc/client"
import { toast } from "sonner"
import { JobStep } from "@/types"

const stepLabel: Record<JobStep, string> = {
  [JobStep.PREPROCESSING]: "1) Preprocessing",
  [JobStep.BATCH_SUBMITTED]: "2) Batch submitted",
  [JobStep.RESULTS_SAVED]: "3) Results saved",
  [JobStep.DOCS_BUILT]: "4) Documents built",
}

interface UseRetryFromStepOptions {
  onSuccess?: (data: { jobId: string }) => void
  onError?: (error: Error) => void
}

export const useRetryFromStep = (options?: UseRetryFromStepOptions) => {
  const utils = trpc.useUtils()

  return trpc.ocr.retryFromStep.useMutation({
    onSuccess: (data, variables) => {
      utils.ocr.getJob.invalidate({ jobId: data.jobId })
      utils.ocr.listJobs.invalidate()
      
      const stepMessage = variables.step ? stepLabel[variables.step] : "the specified step"
      
      toast.success("Job retried", {
        description: `The job will resume from ${stepMessage}.`,
      })
      
      options?.onSuccess?.(data)
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
}


import { trpc } from "@/trpc/client"
import { toast } from "sonner"

interface UseDeleteApiKeyOptions {
  onSuccess?: () => void
  onError?: (error: Error) => void
}

export const useDeleteApiKey = (options?: UseDeleteApiKeyOptions) => {
  const utils = trpc.useUtils()

  return trpc.apiKeys.deleteApiKey.useMutation({
    onSuccess: () => {
      utils.apiKeys.getApiKeys.invalidate()
      toast.success("API key deleted", {
        description: "Your API key has been removed.",
      })
      options?.onSuccess?.()
    },
    onError: (error) => {
      const errorMessage = error instanceof Error ? error.message : error.message || "Unexpected error"
      toast.error("Failed to delete API key", {
        description: errorMessage,
      })
      const errorObj = error instanceof Error ? error : new Error(errorMessage)
      options?.onError?.(errorObj)
    },
  })
}


import { trpc } from "@/trpc/client"
import { toast } from "sonner"

interface UseCreateApiKeyOptions {
  onSuccess?: () => void
  onError?: (error: Error) => void
}

export const useCreateApiKey = (options?: UseCreateApiKeyOptions) => {
  const utils = trpc.useUtils()

  return trpc.apiKeys.createApiKey.useMutation({
    onSuccess: () => {
      utils.apiKeys.getApiKeys.invalidate()
      toast.success("API key added", {
        description: "Your OpenAI API key has been securely stored.",
      })
      options?.onSuccess?.()
    },
    onError: (error) => {
      const errorMessage = error instanceof Error ? error.message : error.message || "Unexpected error"
      toast.error("Failed to add API key", {
        description: errorMessage,
      })
      const errorObj = error instanceof Error ? error : new Error(errorMessage)
      options?.onError?.(errorObj)
    },
  })
}


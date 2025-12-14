import { trpc } from "@/trpc/client"
import { toast } from "sonner"

interface UseDeleteAllUserStorageOptions {
  onSuccess?: () => void
  onError?: (error: Error) => void
}

export const useDeleteAllUserStorage = (
  options?: UseDeleteAllUserStorageOptions
) => {
  const utils = trpc.useUtils()

  return trpc.ocr.deleteAllUserStorage.useMutation({
    onSuccess: () => {
      utils.ocr.getStorageStats.invalidate()
      utils.ocr.listDocuments.invalidate()
      utils.ocr.getAllImages.invalidate()
      utils.ocr.listJobs.invalidate()
      toast.success("Storage deleted", {
        description: "All your files have been deleted successfully.",
      })
      options?.onSuccess?.()
    },
    onError: (error) => {
      const errorMessage = error instanceof Error ? error.message : error.message || "Unexpected error"
      toast.error("Failed to delete storage", {
        description: errorMessage,
      })
      const errorObj = error instanceof Error ? error : new Error(errorMessage)
      options?.onError?.(errorObj)
    },
  })
}


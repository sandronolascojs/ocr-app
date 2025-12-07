import { trpc } from "@/trpc/client"

export const useStorageStats = () => {
  return trpc.ocr.getStorageStats.useQuery()
}


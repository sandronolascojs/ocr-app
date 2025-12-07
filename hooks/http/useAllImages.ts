import { trpc } from "@/trpc/client"

export const useAllImages = () => {
  return trpc.ocr.getAllImages.useQuery()
}


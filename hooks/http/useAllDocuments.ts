import { trpc } from "@/trpc/client"

export const useAllDocuments = () => {
  return trpc.ocr.getAllDocuments.useQuery()
}


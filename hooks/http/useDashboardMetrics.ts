import { trpc } from "@/trpc/client"

export const useDashboardMetrics = () => {
  return trpc.ocr.getDashboardMetrics.useQuery()
}


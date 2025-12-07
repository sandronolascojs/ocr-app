import { trpc } from "@/trpc/client"

export const useApiKeys = () => {
  return trpc.apiKeys.getApiKeys.useQuery()
}


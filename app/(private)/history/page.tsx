import { HistoryView } from "@/views/history/HistoryView"
import { trpc, HydrateClient } from "@/trpc/server"
import { paginationSearchParamsCache } from "@/lib/pagination/searchParams"
import type { SearchParams } from "nuqs/server"

interface HistoryPageProps {
  searchParams: Promise<SearchParams>
}

export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  const { pageIndex, pageSize } = await paginationSearchParamsCache.parse(
    searchParams
  )

  const limit = pageSize
  const offset = pageIndex * pageSize

  await trpc.jobs.listJobs.prefetch({ limit, offset })

  return (
    <HydrateClient>
      <HistoryView />
    </HydrateClient>
  )
}


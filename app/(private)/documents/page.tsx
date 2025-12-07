import { DocumentsView } from "@/views/documents/DocumentsView"
import { trpc, HydrateClient } from "@/trpc/server"
import { paginationSearchParamsCache } from "@/lib/pagination/searchParams"
import { QUERY_CONFIG } from "@/constants/query.constants"

interface DocumentsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function DocumentsPage({
  searchParams,
}: DocumentsPageProps) {
  const { pageIndex, pageSize } = await paginationSearchParamsCache.parse(
    searchParams
  )

  const limit = pageSize
  const offset = pageIndex * pageSize

  await trpc.ocr.listDocuments.prefetch({
    limit,
    offset,
    type: QUERY_CONFIG.DOCUMENTS.DEFAULT_TYPE,
  })

  return (
    <HydrateClient>
      <DocumentsView />
    </HydrateClient>
  )
}


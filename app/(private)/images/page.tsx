import { ImagesView } from "@/views/images/ImagesView"
import { trpc, HydrateClient } from "@/trpc/server"
import { paginationSearchParamsCache } from "@/lib/pagination/searchParams"

interface ImagesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function ImagesPage({
  searchParams,
}: ImagesPageProps) {
  const { pageIndex, pageSize } = await paginationSearchParamsCache.parse(
    searchParams
  )

  const limit = pageSize
  const offset = pageIndex * pageSize

  await trpc.ocr.listImages.prefetch({
    limit,
    offset,
  })

  return (
    <HydrateClient>
      <ImagesView />
    </HydrateClient>
  )
}


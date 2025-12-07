import { ImagesView } from "@/views/images/ImagesView"
import { trpc, HydrateClient } from "@/trpc/server"

export default async function ImagesPage() {
  await trpc.ocr.getAllImages.prefetch()

  return (
    <HydrateClient>
      <ImagesView />
    </HydrateClient>
  )
}


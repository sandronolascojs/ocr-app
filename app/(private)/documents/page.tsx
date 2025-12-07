import { DocumentsView } from "@/views/documents/DocumentsView"
import { trpc, HydrateClient } from "@/trpc/server"

export default async function DocumentsPage() {
  await trpc.ocr.getAllDocuments.prefetch()

  return (
    <HydrateClient>
      <DocumentsView />
    </HydrateClient>
  )
}


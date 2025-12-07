import { NewJobView } from "@/views/home/NewJobView"
import { trpc, HydrateClient } from "@/trpc/server"

interface NewJobPageProps {
  searchParams: { jobId?: string }
}

export default async function NewJobPage({ searchParams }: NewJobPageProps) {
  const jobId = searchParams.jobId

  // Always prefetch API keys
  await trpc.apiKeys.getApiKeys.prefetch()

  // Prefetch job if jobId is provided
  if (jobId) {
    await trpc.ocr.getJob.prefetch({ jobId })
  }

  return (
    <HydrateClient>
      <NewJobView />
    </HydrateClient>
  )
}


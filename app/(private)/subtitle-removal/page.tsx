import { SubtitleRemovalView } from "@/views/subtitle-removal/SubtitleRemovalView"
import { trpc, HydrateClient } from "@/trpc/server"

interface SubtitleRemovalPageProps {
  searchParams: Promise<{ jobId?: string }>
}

export default async function SubtitleRemovalPage({ searchParams }: SubtitleRemovalPageProps) {
  const { jobId } = await searchParams

  // Prefetch job if jobId is provided
  if (jobId) {
    await trpc.jobs.getJob.prefetch({ jobId })
    await trpc.jobs.getJobItems.prefetch({ jobId })
  }

  return (
    <HydrateClient>
      <SubtitleRemovalView />
    </HydrateClient>
  )
}


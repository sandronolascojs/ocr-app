import { HomeView } from "@/views/home/HomeView"
import { trpc, HydrateClient } from "@/trpc/server"

export default async function Home() {
  await trpc.ocr.getDashboardMetrics.prefetch()

  return (
    <HydrateClient>
      <HomeView />
    </HydrateClient>
  )
}


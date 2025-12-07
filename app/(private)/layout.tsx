import { AppSidebar } from "@/components/app-sidebar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { PrivateHeader } from "@/components/private-header"
import { SidebarFooterWithUser } from "@/components/sidebar-footer"
import { DialogProvider } from "@/components/dialogs"
import { enforcePrivateUser } from "@/server/auth/enforceRouteAuth"
import { BetaAccessView } from "@/views/demo/BetaAccessView"
import type { ReactNode } from "react"

interface PrivateLayoutProps {
  children: ReactNode
}

export default async function PrivateLayout({ children }: PrivateLayoutProps) {
  const user = await enforcePrivateUser()

  // If user is not enabled, show beta access screen without sidebar or header
  if (!user.isEnabled) {
    return <BetaAccessView />
  }

  return (
    <DialogProvider>
    <SidebarProvider>
      <AppSidebar>
        <SidebarFooterWithUser />
      </AppSidebar>
      <SidebarInset>
        <PrivateHeader />
        <div className="flex h-full flex-1 flex-col gap-4 p-4 pt-0">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
    </DialogProvider>
  )
}


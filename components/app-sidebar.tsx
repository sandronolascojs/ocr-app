"use client"

import {
  FileText,
  History,
  Settings2,
  Image,
  FolderOpen,
  Scan,
  Home,
} from "lucide-react"
import { NavMain } from "@/components/nav-main"
import { NavProjects } from "@/components/nav-projects"
import { TeamSwitcher } from "@/components/team-switcher"
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar"
import type { ReactNode } from "react"

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  footer?: ReactNode
}

const data = {
  teams: [
    {
      name: "OCR App",
      logo: Scan,
      plan: "Pro",
    },
  ],
  navMain: [
    {
      title: "Home",
      url: "/",
      icon: Home,
    },
    {
      title: "OCR Processing",
      url: "/new-job",
      icon: Scan,
      items: [
        {
          title: "New Job",
          url: "/new-job",
        },
        {
          title: "History",
          url: "/history",
        },
      ],
    },
    {
      title: "Documents",
      url: "/documents",
      icon: FileText,
      items: [
        {
          title: "All Documents",
          url: "/documents",
        },
        {
          title: "Recent",
          url: "#",
        },
        {
          title: "Archived",
          url: "#",
        },
      ],
    },
    {
      title: "Images",
      url: "/images",
      icon: Image,
      items: [
        {
          title: "Uploaded",
          url: "#",
        },
        {
          title: "Processed",
          url: "/images",
        },
      ],
    },
    {
      title: "Settings",
      url: "/settings",
      icon: Settings2,
      items: [
        {
          title: "General",
          url: "/settings",
        },
        {
          title: "API Keys",
          url: "/settings/api-keys",
        },
        {
          title: "Storage",
          url: "/settings/storage",
        },
      ],
    },
  ],
}

export const AppSidebar = ({ footer, children, ...props }: AppSidebarProps) => {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <TeamSwitcher teams={data.teams} />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
      </SidebarContent>
      {footer || children}
      <SidebarRail />
    </Sidebar>
  )
}


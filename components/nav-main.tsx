"use client"

import { ChevronRight, type LucideIcon } from "lucide-react"
import { usePathname } from "next/navigation"
import Link from "next/link"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"

interface NavMainProps {
  items: {
    title: string
    url: string
    icon?: LucideIcon
    items?: {
      title: string
      url: string
    }[]
  }[]
}

export const NavMain = ({ items }: NavMainProps) => {
  const pathname = usePathname()
  const currentPath = pathname.split("?")[0]

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Platform</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => {
          const itemPath = item.url.split("?")[0]
          // Check if current path matches the item URL or any of its children
          const groupActive = item.items
            ? item.items.some((s) => {
                const subPath = s.url.split("?")[0]
                // Check if current path starts with subPath (for nested routes like /settings/api-keys)
                return currentPath === subPath || currentPath.startsWith(subPath + "/")
              }) || currentPath.startsWith(itemPath + "/")
            : false

          return item.items && item.items.length > 0 ? (
            <Collapsible
              key={item.url}
              defaultOpen={groupActive}
              className="group/collapsible"
            >
              <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton tooltip={item.title}>
                    {item.icon && <item.icon />}
                    <span>{item.title}</span>
                    <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub className="mr-0 pr-0">
                    {item.items?.map((sub, index) => {
                      const subPath = sub.url.split("?")[0]
                      // Exact match only - don't match parent paths
                      const isActive = subPath === currentPath

                      return (
                        <SidebarMenuSubItem key={sub.url || `sub-item-${index}`}>
                          <SidebarMenuSubButton
                            asChild
                            isActive={isActive}
                            className={
                              isActive ? "border border-border" : undefined
                            }
                          >
                            <Link href={sub.url} className="w-full">
                              <span>{sub.title}</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      )
                    })}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>
          ) : (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                tooltip={item.title}
                asChild
                isActive={item.url === currentPath}
                className={
                  item.url === currentPath ? "border border-border" : undefined
                }
              >
                <Link href={item.url} className="w-full">
                  {item.icon && <item.icon />}
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )
        })}
      </SidebarMenu>
    </SidebarGroup>
  )
}


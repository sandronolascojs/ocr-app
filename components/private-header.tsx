"use client"

import * as React from "react"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { usePathname } from "next/navigation"
import Link from "next/link"

export const PrivateHeader = () => {
  const pathname = usePathname()
  const pathSegments = pathname.split("/").filter(Boolean)

  const getBreadcrumbName = (segment: string) => {
    switch (segment) {
      case "new-job":
        return "New Job"
      case "history":
        return "History"
      case "documents":
        return "All Documents"
      case "images":
        return "Processed Images"
      case "settings":
        return "Settings"
      case "api-keys":
        return "API Keys"
      case "storage":
        return "Storage"
      default:
        return segment.charAt(0).toUpperCase() + segment.slice(1)
    }
  }

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
      <div className="flex items-center gap-2 px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mr-2 data-[orientation=vertical]:h-4"
        />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              {pathname === "/" ? (
                <BreadcrumbPage>Home</BreadcrumbPage>
              ) : (
                <BreadcrumbLink href="/">Home</BreadcrumbLink>
              )}
            </BreadcrumbItem>
            {pathSegments.length > 0 && (
              <>
                <BreadcrumbSeparator />
                {pathSegments.map((segment, index) => {
                  const href = `/${pathSegments.slice(0, index + 1).join("/")}`
                  const isLast = index === pathSegments.length - 1
                  const name = getBreadcrumbName(segment)

                  return (
                    <React.Fragment key={segment}>
                      <BreadcrumbItem>
                        {isLast ? (
                          <BreadcrumbPage>{name}</BreadcrumbPage>
                        ) : (
                          <BreadcrumbLink asChild>
                            <Link href={href}>{name}</Link>
                          </BreadcrumbLink>
                        )}
                      </BreadcrumbItem>
                      {!isLast && <BreadcrumbSeparator />}
                    </React.Fragment>
                  )
                })}
              </>
            )}
          </BreadcrumbList>
        </Breadcrumb>
      </div>
    </header>
  )
}


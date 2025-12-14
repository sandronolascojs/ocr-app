"use client"

import { useSearchParams, useRouter } from "next/navigation"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import { formatBytes } from "@/lib/utils"
import { ApiKeysView } from "./ApiKeysView"
import { useDialogStore } from "@/store/dialogs"
import { useStorageStats } from "@/hooks/http/useStorageStats"

export const SettingsView = () => {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { setDeleteStorageDialogOpen } = useDialogStore()
  const activeTab = searchParams.get("tab") ?? "general"

  const handleTabChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value === "general") {
      params.delete("tab")
    } else {
      params.set("tab", value)
    }
    router.push(`/settings?${params.toString()}`)
  }

  const storageStatsQuery = useStorageStats()

  // Mock user data
  const mockUser = {
    name: "User",
    email: "user@example.com",
    avatar: "/avatars/user.jpg",
  }

  const storageStats = storageStatsQuery.data

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your account and storage settings
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="api-keys">API Keys</TabsTrigger>
          <TabsTrigger value="storage">Storage</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Account Information</CardTitle>
              <CardDescription>
                Your account details (mock data for now)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <Avatar className="h-16 w-16">
                  <AvatarImage src={mockUser.avatar} alt={mockUser.name} />
                  <AvatarFallback className="text-lg">
                    {mockUser.name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="space-y-1">
                  <p className="text-sm font-medium">{mockUser.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {mockUser.email}
                  </p>
                </div>
              </div>
              <Separator />
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Account Status:</span>
                  <span className="font-medium">Active</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Plan:</span>
                  <span className="font-medium">Free</span>
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <p className="text-xs text-muted-foreground">
                User authentication will be integrated in the future
              </p>
            </CardFooter>
          </Card>
        </TabsContent>

        <TabsContent value="api-keys" className="space-y-4">
          <ApiKeysView />
        </TabsContent>

        <TabsContent value="storage" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Storage Usage</CardTitle>
              <CardDescription>
                View and manage your storage usage
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {storageStatsQuery.isLoading && (
                <p className="text-sm text-muted-foreground">
                  Loading storage stats...
                </p>
              )}

              {storageStatsQuery.isError && (
                <p className="text-sm text-destructive">
                  Failed to load storage stats:{" "}
                  {storageStatsQuery.error?.message ?? "Unknown error"}
                </p>
              )}

              {storageStats && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Total Storage:</span>
                      <span className="text-sm font-semibold">
                        {formatBytes(storageStats.totalBytes)}
                      </span>
                    </div>
                    <Separator />
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">
                          Text Files (TXT):
                        </span>
                        <span className="font-medium">
                          {formatBytes(storageStats.breakdown.txtBytes)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">
                          Documents (DOCX):
                        </span>
                        <span className="font-medium">
                          {formatBytes(storageStats.breakdown.docxBytes)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">
                          Raw ZIPs:
                        </span>
                        <span className="font-medium">
                          {formatBytes(storageStats.breakdown.rawZipBytes)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">
                          Original ZIPs:
                        </span>
                        <span className="font-medium">
                          {formatBytes(storageStats.breakdown.originalZipBytes)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">
                          Cropped ZIPs:
                        </span>
                        <span className="font-medium">
                          {formatBytes(storageStats.breakdown.croppedZipBytes)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
            <CardFooter className="flex flex-col gap-4">
              <Separator />
              <div className="w-full space-y-2">
                      <Button
                        variant="destructive"
                  className="w-full"
                  onClick={() => setDeleteStorageDialogOpen(true)}
                      >
                  Delete All Storage
                      </Button>
                <p className="text-xs text-muted-foreground text-center">
                  This will delete all files but keep your job history
                </p>
              </div>
            </CardFooter>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}


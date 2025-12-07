"use client"

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { formatBytes } from "@/lib/utils"
import { useDialogStore } from "@/store/dialogs"
import { useStorageStats } from "@/hooks/http"

interface SettingsStorageViewProps {}

export const SettingsStorageView = ({}: SettingsStorageViewProps) => {
  const { setDeleteStorageDialogOpen } = useDialogStore()
  const storageStatsQuery = useStorageStats()
  const storageStats = storageStatsQuery.data

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Storage</h1>
        <p className="text-sm text-muted-foreground">
          View and manage your storage usage
        </p>
      </div>

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
                      Image ZIPs:
                    </span>
                    <span className="font-medium">
                      {formatBytes(storageStats.breakdown.zipBytes)}
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
    </div>
  )
}


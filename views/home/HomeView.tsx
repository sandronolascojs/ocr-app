"use client"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { formatBytes } from "@/lib/utils"
import Link from "next/link"
import {
  CheckCircle2,
  XCircle,
  Clock,
  FileText,
  Image as ImageIcon,
  HardDrive,
  ArrowRight,
} from "lucide-react"
import { useDashboardMetrics } from "@/hooks/http"

export const HomeView = () => {
  const metricsQuery = useDashboardMetrics()

  const metrics = metricsQuery.data
  const isLoading = metricsQuery.isLoading
  const hasError = metricsQuery.isError

  const totalJobs = metrics?.jobs.total ?? 0
  const completedJobs = metrics?.jobs.completed ?? 0
  const failedJobs = metrics?.jobs.failed ?? 0
  const processingJobs = metrics?.jobs.processing ?? 0

  const totalDocuments = metrics?.documents.total ?? 0
  const txtCount = metrics?.documents.txt ?? 0
  const docxCount = metrics?.documents.docx ?? 0

  const totalImages = metrics?.images.total ?? 0
  const imagesWithThumbnails = metrics?.images.withThumbnails ?? 0

  const totalStorage = metrics?.storage.totalBytes ?? 0
  const txtStorage = metrics?.storage.breakdown.txtBytes ?? 0
  const docxStorage = metrics?.storage.breakdown.docxBytes ?? 0
  const zipStorage = metrics?.storage.breakdown.zipBytes ?? 0

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-full flex-col gap-3 overflow-auto">
        <header className="flex flex-col gap-2 shrink-0">
          <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
            Overview of your OCR processing jobs, documents, and storage usage
        </p>
      </header>

        {hasError && (
          <Card className="shrink-0">
            <CardContent className="py-8">
              <p className="text-sm text-destructive text-center">
                Failed to load metrics: {metricsQuery.error?.message ?? "Unknown error"}
              </p>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4 shrink-0">
          {/* Total Jobs */}
          <Link href="/history">
            <Card className="cursor-pointer transition-colors hover:border-primary/50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Jobs</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
                {isLoading ? (
                  <div className="space-y-1">
                    <Skeleton className="h-8 w-16" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                ) : (
                  <>
                    <div className="text-2xl font-bold">{totalJobs}</div>
                    <p className="text-xs text-muted-foreground">
                      All OCR processing jobs
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          </Link>

          {/* Completed Jobs */}
          <Link href="/history?status=DONE">
            <Card className="cursor-pointer transition-colors hover:border-emerald-500/50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Completed</CardTitle>
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="space-y-1">
                    <Skeleton className="h-8 w-16" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                ) : (
                  <>
                    <div className="text-2xl font-bold text-emerald-600">
                      {completedJobs}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Successfully finished
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          </Link>

          {/* Failed Jobs */}
          <Link href="/history?status=ERROR">
            <Card className="cursor-pointer transition-colors hover:border-destructive/50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Failed</CardTitle>
                <XCircle className="h-4 w-4 text-destructive" />
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="space-y-1">
                    <Skeleton className="h-8 w-16" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                ) : (
                  <>
                    <div className="text-2xl font-bold text-destructive">
                      {failedJobs}
                    </div>
                    <p className="text-xs text-muted-foreground">With errors</p>
                  </>
                )}
              </CardContent>
            </Card>
          </Link>

          {/* Processing Jobs */}
          <Link href="/history?status=PROCESSING">
            <Card className="cursor-pointer transition-colors hover:border-primary/50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Processing</CardTitle>
                <Clock className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="space-y-1">
                    <Skeleton className="h-8 w-16" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                ) : (
                  <>
                    <div className="text-2xl font-bold text-primary">
                      {processingJobs}
                    </div>
                    <p className="text-xs text-muted-foreground">In progress</p>
                  </>
                )}
              </CardContent>
            </Card>
          </Link>
                </div>

        <div className="grid gap-3 md:grid-cols-2">
          {/* Documents Summary */}
          <Link href="/documents" className="flex">
            <Card className="cursor-pointer transition-colors hover:border-primary/50 flex-1 flex flex-col">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                    <CardTitle>Documents</CardTitle>
                  </div>
                  <Button variant="ghost" size="sm" asChild onClick={(e) => e.stopPropagation()}>
                    <span>
                      View all
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </span>
                  </Button>
                </div>
                <CardDescription>
                  Generated text and Word documents
                </CardDescription>
              </CardHeader>
            <CardContent className="space-y-4">
              {isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
              </div>
              ) : (
                    <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      Total Documents:
                              </span>
                    <span className="text-sm font-semibold">{totalDocuments}</span>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      TXT Files:
                    </span>
                  <span className="text-sm font-semibold">
                    {txtCount}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    DOCX Files:
                      </span>
                  <span className="text-sm font-semibold">
                    {docxCount}
                      </span>
                    </div>
                </div>
              )}
            </CardContent>
            </Card>
          </Link>

          {/* Images Summary */}
          <Link href="/images" className="flex">
            <Card className="cursor-pointer transition-colors hover:border-primary/50 flex-1 flex flex-col">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ImageIcon className="h-5 w-5 text-muted-foreground" />
                    <CardTitle>Processed Images</CardTitle>
                  </div>
                  <Button variant="ghost" size="sm" asChild onClick={(e) => e.stopPropagation()}>
                    <span>
                      View all
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </span>
                  </Button>
                </div>
                <CardDescription>
                  Processed image ZIPs with thumbnails
                </CardDescription>
              </CardHeader>
            <CardContent className="space-y-4">
              {isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      Total ZIPs:
                    </span>
                    <span className="text-sm font-semibold">{totalImages}</span>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      With Thumbnails:
                    </span>
                  <span className="text-sm font-semibold">
                    {imagesWithThumbnails}
                  </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
          </Link>
        </div>

        {/* Quick Actions */}
        <Card className="shrink-0">
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
              <CardDescription>
              Common tasks and navigation shortcuts
              </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <Link href="/new-job">Create New Job</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/history">View Job History</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/documents">Browse Documents</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/images">View Images</Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Storage Summary */}
        <Card className="flex-1 flex flex-col min-h-0">
          <CardHeader>
            <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
                <HardDrive className="h-5 w-5 text-muted-foreground" />
                <CardTitle>Storage Usage</CardTitle>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/settings/storage">
                  Manage
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
            <CardDescription>
              Total storage used across all files
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Total Storage:</span>
                    <span className="text-sm font-semibold">
                      {formatBytes(totalStorage)}
                    </span>
                  </div>
                  <Separator />
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">
                        Text Files (TXT):
                      </span>
                      <span className="font-medium">
                        {formatBytes(txtStorage)}
                      </span>
                          </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">
                        Documents (DOCX):
                      </span>
                      <span className="font-medium">
                        {formatBytes(docxStorage)}
                      </span>
                        </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">
                        Image ZIPs:
                      </span>
                      <span className="font-medium">
                        {formatBytes(zipStorage)}
                            </span>
                          </div>
                        </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default HomeView

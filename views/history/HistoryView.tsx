"use client"

import * as React from "react"
import { useMemo } from "react"
import { useRouter } from "next/navigation"
import {
  useReactTable,
  getCoreRowModel,
  type ColumnDef,
} from "@tanstack/react-table"
import { usePagination } from "@/hooks/ui/usePagination"
import { useOcrJobs } from "@/hooks/http/useOcrJobs"
import { useOcrResult } from "@/hooks/http/useOcrResult"
import { useDeleteOcrJob } from "@/hooks/http/useDeleteOcrJob"
import { trpc } from "@/trpc/client"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { JobsStatus, JobStep } from "@/types"
import { cn, downloadSignedUrl } from "@/lib/utils"
import { MoreHorizontal, Download, Eye, FileText, Trash2 } from "lucide-react"
import { toast } from "sonner"

const statusLabel: Record<JobsStatus, string> = {
  [JobsStatus.PENDING]: "Pending",
  [JobsStatus.PROCESSING]: "Processing",
  [JobsStatus.DONE]: "Done",
  [JobsStatus.ERROR]: "Error",
}

const stepLabel: Record<JobStep, string> = {
  [JobStep.PREPROCESSING]: "Preprocessing",
  [JobStep.BATCH_SUBMITTED]: "Batch submitted",
  [JobStep.RESULTS_SAVED]: "Results saved",
  [JobStep.DOCS_BUILT]: "Documents built",
}

const statusVariant: Record<
  JobsStatus,
  React.ComponentProps<typeof Badge>["variant"]
> = {
  PENDING: "secondary",
  PROCESSING: "default",
  DONE: "default",
  ERROR: "destructive",
}

type Job = {
  jobId: string
  status: JobsStatus
  step: JobStep
  error: string | null
  totalImages: number
  processedImages: number
  hasResults: boolean
  createdAt: Date | null
  updatedAt: Date | null
}

interface HistoryViewProps {}

export const HistoryView = ({}: HistoryViewProps) => {
  const router = useRouter()
  const pagination = usePagination()
  const utils = trpc.useUtils()

  const jobsQuery = useOcrJobs({
    limit: pagination.limit,
    offset: pagination.offset,
  })
  const columns = useMemo<ColumnDef<Job>[]>(
    () => [
      {
        accessorKey: "jobId",
        header: "Job ID",
        cell: ({ row }) => (
          <div className="font-mono text-xs">{row.getValue("jobId")}</div>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
          const status = row.getValue("status") as JobsStatus
          return (
            <Badge variant={statusVariant[status]}>
              {statusLabel[status]}
            </Badge>
          )
        },
      },
      {
        accessorKey: "step",
        header: "Step",
        cell: ({ row }) => {
          const step = row.getValue("step") as JobStep
          return <span className="text-sm">{stepLabel[step]}</span>
        },
      },
      {
        accessorKey: "progress",
        header: "Progress",
        cell: ({ row }) => {
          const job = row.original
          const progress =
            job.totalImages > 0
              ? Math.round((job.processedImages / job.totalImages) * 100)
              : 0
          return (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground min-w-12">
                {job.processedImages} / {job.totalImages}
              </span>
              <div className="flex-1 max-w-[100px]">
                <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            </div>
          )
        },
      },
      {
        accessorKey: "updatedAt",
        header: "Last Updated",
        cell: ({ row }) => {
          const date = row.getValue("updatedAt") as Date | null
          return (
            <span className="text-sm text-muted-foreground">
              {date ? new Date(date).toLocaleString() : "Never"}
            </span>
          )
        },
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => {
          const job = row.original
          return <JobActions job={job} />
        },
      },
    ],
    []
  )

  const table = useReactTable({
    data: jobsQuery.jobs,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount: Math.ceil((jobsQuery.total ?? 0) / pagination.pageSize),
    state: {
      pagination: {
        pageIndex: pagination.pageIndex,
        pageSize: pagination.pageSize,
      },
    },
    onPaginationChange: (updater) => {
      if (typeof updater === "function") {
        const newPagination = updater({
          pageIndex: pagination.pageIndex,
          pageSize: pagination.pageSize,
        });
        pagination.setPageIndex(newPagination.pageIndex);
        if (newPagination.pageSize !== pagination.pageSize) {
          pagination.setPageSize(newPagination.pageSize);
        }
      } else {
        pagination.setPageIndex(updater.pageIndex);
        if (updater.pageSize !== pagination.pageSize) {
          pagination.setPageSize(updater.pageSize);
        }
      }
    },
  })

  const totalPages = Math.ceil((jobsQuery.total ?? 0) / pagination.pageSize)
  const currentPage = pagination.pageIndex + 1

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Job History
          </h1>
          <p className="text-sm text-muted-foreground">
            View all your OCR processing jobs and download results
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => utils.ocr.listJobs.invalidate()}
          disabled={jobsQuery.isLoading}
        >
          Refresh
        </Button>
      </div>

      {jobsQuery.isLoading && (
        <div className="rounded-md border p-8">
          <p className="text-sm text-muted-foreground text-center">
            Loading jobs...
          </p>
        </div>
      )}

      {jobsQuery.isError && (
        <div className="rounded-md border border-destructive p-8">
          <p className="text-sm text-destructive text-center">
            Failed to load jobs:{" "}
            {jobsQuery.error?.message ?? "Unknown error"}
          </p>
        </div>
      )}

      {!jobsQuery.isLoading &&
        !jobsQuery.isError &&
        jobsQuery.jobs.length === 0 && (
          <div className="rounded-md border p-8">
            <p className="text-sm text-muted-foreground text-center">
              No jobs found. Upload a ZIP to start processing.
            </p>
          </div>
        )}

      {!jobsQuery.isLoading && !jobsQuery.isError && jobsQuery.jobs.length > 0 && (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id}>
                        {header.isPlaceholder
                          ? null
                          : typeof header.column.columnDef.header === "string"
                            ? header.column.columnDef.header
                            : typeof header.column.columnDef.header === "function"
                              ? header.column.columnDef.header(header.getContext())
                              : null}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows?.length ? (
                  table.getRowModel().rows.map((row) => (
                    <TableRow
                      key={row.id}
                      data-state={row.getIsSelected() && "selected"}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {typeof cell.column.columnDef.cell === "function"
                            ? cell.column.columnDef.cell(cell.getContext())
                            : cell.getValue()}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length}
                      className="h-24 text-center"
                    >
                      No results.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href="#"
                    onClick={(e) => {
                      e.preventDefault()
                      pagination.previousPage()
                    }}
                    className={cn(
                      pagination.pageIndex === 0 && "pointer-events-none opacity-50"
                    )}
                  />
                </PaginationItem>

                {Array.from({ length: totalPages }, (_, i) => i + 1).map(
                  (page) => {
                    if (
                      page === 1 ||
                      page === totalPages ||
                      (page >= currentPage - 1 && page <= currentPage + 1)
                    ) {
                      return (
                        <PaginationItem key={page}>
                          <PaginationLink
                            href="#"
                            onClick={(e) => {
                              e.preventDefault()
                              pagination.goToPage(page - 1)
                            }}
                            isActive={page === currentPage}
                          >
                            {page}
                          </PaginationLink>
                        </PaginationItem>
                      )
                    } else if (page === currentPage - 2 || page === currentPage + 2) {
                      return (
                        <PaginationItem key={page}>
                          <PaginationEllipsis />
                        </PaginationItem>
                      )
                    }
                    return null
                  }
                )}

                <PaginationItem>
                  <PaginationNext
                    href="#"
                    onClick={(e) => {
                      e.preventDefault()
                      pagination.nextPage()
                    }}
                    className={cn(
                      pagination.pageIndex >= totalPages - 1 &&
                        "pointer-events-none opacity-50"
                    )}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}

          <div className="text-sm text-muted-foreground text-center">
            Showing {pagination.offset + 1} to{" "}
            {Math.min(
              pagination.offset + pagination.limit,
              jobsQuery.total ?? 0
            )}{" "}
            of {jobsQuery.total ?? 0} jobs
          </div>
        </>
      )}
    </div>
  )
}

interface JobActionsProps {
  job: Job
}

const JobActions = ({ job }: JobActionsProps) => {
  const router = useRouter()
  const utils = trpc.useUtils()
  const resultQuery = useOcrResult(
    job.hasResults ? job.jobId : null,
    job.status === JobsStatus.DONE && job.hasResults
  )
  const deleteJobMutation = useDeleteOcrJob({
    onSuccess: () => {
      utils.ocr.listJobs.invalidate()
    },
  })

  const handleViewJob = () => {
    router.push(`/new-job?jobId=${job.jobId}`)
  }

  const handleDownloadTxt = () => {
    const url = resultQuery.ocrResult?.txt?.url
    if (!url) return
    downloadSignedUrl(url)
  }

  const handleDownloadDocx = () => {
    const url = resultQuery.ocrResult?.docx?.url
    if (!url) return
    downloadSignedUrl(url)
  }

  const handleDownloadRawZip = () => {
    const url = resultQuery.ocrResult?.rawZip?.url
    if (!url) return
    downloadSignedUrl(url)
  }

  const handleDeleteJob = async () => {
    const confirmed = window.confirm(
      "Are you sure you want to delete this job? This will permanently delete the job and all its files. This action cannot be undone."
    )

    if (!confirmed) return

    try {
      await deleteJobMutation.mutateAsync({ jobId: job.jobId })
    } catch (error) {
      // Error is already handled by the hook's onError
      console.error("Failed to delete job:", error)
    }
  }

  const isProcessing =
    job.status === JobsStatus.PENDING || job.status === JobsStatus.PROCESSING

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-8 w-8 p-0">
          <span className="sr-only">Open menu</span>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Actions</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault()
            handleViewJob()
          }}
        >
          <Eye className="mr-2 h-4 w-4" />
          View Job
        </DropdownMenuItem>
        {isProcessing && (
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault()
              handleViewJob()
            }}
          >
            <FileText className="mr-2 h-4 w-4" />
            View Progress
          </DropdownMenuItem>
        )}
        {job.hasResults && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault()
                handleDownloadTxt()
              }}
              disabled={resultQuery.isLoading || !resultQuery.ocrResult?.txt}
            >
              <Download className="mr-2 h-4 w-4" />
              Download TXT
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault()
                handleDownloadDocx()
              }}
              disabled={resultQuery.isLoading || !resultQuery.ocrResult?.docx}
            >
              <Download className="mr-2 h-4 w-4" />
              Download DOCX
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault()
                handleDownloadRawZip()
              }}
              disabled={resultQuery.isLoading || !resultQuery.ocrResult?.rawZip}
            >
              <Download className="mr-2 h-4 w-4" />
              Download ZIP
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault()
            handleDeleteJob()
          }}
          disabled={deleteJobMutation.isPending}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          {deleteJobMutation.isPending ? "Deleting..." : "Delete Job"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

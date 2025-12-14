"use client"

import { useMemo, useState, useCallback } from "react"
import {
  useReactTable,
  getCoreRowModel,
  type ColumnDef,
} from "@tanstack/react-table"
import { usePagination } from "@/hooks/ui/usePagination"
import { useDocuments } from "@/hooks/http"
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
import { Input } from "@/components/ui/input"
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn, formatBytes, downloadSignedUrl } from "@/lib/utils"
import { Download, Search, X, Image as ImageIcon, MoreHorizontal, Eye } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { QUERY_CONFIG } from "@/constants/query.constants"
import { Document } from "@/types"


export const DocumentsView = () => {
  const pagination = usePagination()
  const utils = trpc.useUtils()

  const [documentType, setDocumentType] = useState<"txt" | "docx" | "all">(
    QUERY_CONFIG.DOCUMENTS.DEFAULT_TYPE
  )
  const [jobIdSearch, setJobIdSearch] = useState<string>("")

  const documentsQuery = useDocuments({
    limit: pagination.limit,
    offset: pagination.offset,
    type: documentType,
    jobId: jobIdSearch.trim() || undefined,
  })

  const handleTypeChange = useCallback((value: string) => {
    setDocumentType(value as "txt" | "docx" | "all")
    pagination.setPageIndex(0)
  }, [pagination])

  const handleSearchChange = useCallback((value: string) => {
    setJobIdSearch(value)
    pagination.setPageIndex(0)
  }, [pagination])

  const handleClearSearch = useCallback(() => {
    setJobIdSearch("")
    pagination.setPageIndex(0)
  }, [pagination])

  const columns = useMemo<ColumnDef<Document>[]>(
    () => [
      {
        accessorKey: "thumbnail",
        header: "",
        cell: ({ row }) => {
          const document = row.original
          if (!document.thumbnailUrl) {
            return (
              <div className="flex items-center justify-center w-10 h-10 rounded border bg-muted/50">
                <ImageIcon className="h-4 w-4 text-muted-foreground" />
              </div>
            )
          }
          return (
            <div className="w-10 h-10 rounded border overflow-hidden">
              <img
                src={document.thumbnailUrl.url}
                alt={`Thumbnail for job ${document.jobId}`}
                className="w-full h-full object-cover"
              />
            </div>
          )
        },
      },
      {
        accessorKey: "jobId",
        header: "Job ID",
        cell: ({ row }) => (
          <div className="font-mono text-xs">{row.getValue("jobId")}</div>
        ),
      },
      {
        accessorKey: "types",
        header: "Types",
        cell: ({ row }) => {
          const document = row.original
          const types: Array<{ type: "txt" | "docx"; available: boolean }> = []
          
          if (document.txt) {
            types.push({ type: "txt", available: document.txt.filesExist })
          }
          if (document.docx) {
            types.push({ type: "docx", available: document.docx.filesExist })
          }

          if (types.length === 0) {
            return (
              <span className="text-sm text-muted-foreground">No documents</span>
            )
          }

          return (
            <div className="flex gap-2">
              {types.map(({ type, available }) => (
                <Badge
                  key={type}
                  variant={available ? "default" : "secondary"}
                  className="uppercase"
                >
              {type}
            </Badge>
              ))}
            </div>
          )
        },
      },
      {
        accessorKey: "totalSize",
        header: "Total Size",
        cell: ({ row }) => {
          const document = row.original
          let totalBytes = 0
          
          if (document.txt?.sizeBytes) {
            totalBytes += document.txt.sizeBytes
          }
          if (document.docx?.sizeBytes) {
            totalBytes += document.docx.sizeBytes
          }

          return (
            <span className="text-sm text-muted-foreground">
              {totalBytes > 0 ? formatBytes(totalBytes) : "N/A"}
            </span>
          )
        },
      },
      {
        accessorKey: "createdAt",
        header: "Created",
        cell: ({ row }) => {
          const date = row.getValue("createdAt") as Date | null
          return (
            <span className="text-sm text-muted-foreground">
              {date ? new Date(date).toLocaleString() : "N/A"}
            </span>
          )
        },
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => {
          const document = row.original
          return <DocumentActions document={document} />
        },
      },
    ],
    []
  )

  const table = useReactTable({
    data: documentsQuery.documents,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount: Math.ceil((documentsQuery.total ?? 0) / pagination.pageSize),
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
            })
            pagination.setPageIndex(newPagination.pageIndex)
            if (newPagination.pageSize !== pagination.pageSize) {
              pagination.setPageSize(newPagination.pageSize)
            }
          } else {
            pagination.setPageIndex(updater.pageIndex)
            if (updater.pageSize !== pagination.pageSize) {
              pagination.setPageSize(updater.pageSize)
            }
          }
        },
  })

  const totalPages = Math.ceil((documentsQuery.total ?? 0) / pagination.pageSize)
  const currentPage = pagination.pageIndex + 1

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Documents
          </h1>
          <p className="text-sm text-muted-foreground">
            All jobs with generated documents (TXT and DOCX)
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => utils.ocr.listDocuments.invalidate()}
          disabled={documentsQuery.isLoading}
        >
          Refresh
        </Button>
      </div>

      {/* Filters and Search */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={documentType} onValueChange={handleTypeChange}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="txt">TXT</TabsTrigger>
            <TabsTrigger value="docx">DOCX</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search by Job ID..."
            value={jobIdSearch}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-9 pr-9"
          />
          {jobIdSearch && (
            <Button
              variant="ghost"
              size="sm"
              className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 p-0"
              onClick={handleClearSearch}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {documentsQuery.isLoading && (
        <div className="rounded-md border p-8">
          <p className="text-sm text-muted-foreground text-center">
            Loading documents...
          </p>
        </div>
      )}

      {documentsQuery.isError && (
        <div className="rounded-md border border-destructive p-8">
          <p className="text-sm text-destructive text-center">
            Failed to load documents:{" "}
            {documentsQuery.error?.message ?? "Unknown error"}
          </p>
        </div>
      )}

      {!documentsQuery.isLoading &&
        !documentsQuery.isError &&
        documentsQuery.documents.length === 0 && (
          <div className="rounded-md border p-8">
            <p className="text-sm text-muted-foreground text-center">
              No jobs with documents found. Complete an OCR job to generate documents.
            </p>
          </div>
        )}

      {!documentsQuery.isLoading &&
        !documentsQuery.isError &&
        documentsQuery.documents.length > 0 && (
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
                              : typeof header.column.columnDef.header ===
                                  "function"
                                ? header.column.columnDef.header(
                                    header.getContext()
                                  )
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
                        pagination.pageIndex === 0 &&
                          "pointer-events-none opacity-50"
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
                      } else if (
                        page === currentPage - 2 ||
                        page === currentPage + 2
                      ) {
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
                documentsQuery.total ?? 0
              )}{" "}
              of {documentsQuery.total ?? 0} jobs
            </div>
          </>
        )}
    </div>
  )
}

interface DocumentActionsProps {
  document: Document
}

const DocumentActions = ({ document }: DocumentActionsProps) => {
  const handleDownloadTxt = () => {
    if (!document.txt?.url) return
    downloadSignedUrl(document.txt.url.url)
  }

  const handleDownloadDocx = () => {
    if (!document.docx?.url) return
    downloadSignedUrl(document.docx.url.url)
  }

  const hasAnyDocument = document.txt?.filesExist || document.docx?.filesExist

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
        {hasAnyDocument && (
          <>
            {document.txt?.filesExist && document.txt?.url && (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault()
                  handleDownloadTxt()
                }}
              >
                <Download className="mr-2 h-4 w-4" />
                Download TXT
              </DropdownMenuItem>
            )}
            {document.docx?.filesExist && document.docx?.url && (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault()
                  handleDownloadDocx()
                }}
              >
                <Download className="mr-2 h-4 w-4" />
                Download DOCX
              </DropdownMenuItem>
            )}
          </>
        )}
        {!hasAnyDocument && (
          <DropdownMenuItem disabled>
            No documents available
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

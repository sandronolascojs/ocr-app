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
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { FileText } from "lucide-react"
import { formatBytes } from "@/lib/utils"
import { useAllDocuments } from "@/hooks/http"

const openSignedUrl = (url: string) => {
  const newWindow = window.open(url, "_blank", "noopener,noreferrer")
  if (!newWindow) {
    window.location.href = url
  }
}

interface DocumentsViewProps {}

export const DocumentsView = ({}: DocumentsViewProps) => {
  const documentsQuery = useAllDocuments()

  const documents = documentsQuery.data ?? []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">
          Documents
        </h1>
        <p className="text-sm text-muted-foreground">
          All generated documents from your OCR jobs
        </p>
      </div>

      {documentsQuery.isLoading && (
        <Card>
          <CardContent className="py-8">
            <p className="text-sm text-muted-foreground text-center">
              Loading documents...
            </p>
          </CardContent>
        </Card>
      )}

      {documentsQuery.isError && (
        <Card>
          <CardContent className="py-8">
            <p className="text-sm text-destructive text-center">
              Failed to load documents:{" "}
              {documentsQuery.error?.message ?? "Unknown error"}
            </p>
          </CardContent>
        </Card>
      )}

      {!documentsQuery.isLoading &&
        !documentsQuery.isError &&
        documents.length === 0 && (
          <Card>
            <CardContent className="py-8">
              <p className="text-sm text-muted-foreground text-center">
                No documents found. Complete an OCR job to generate documents.
              </p>
            </CardContent>
          </Card>
        )}

      {!documentsQuery.isLoading &&
        !documentsQuery.isError &&
        documents.length > 0 && (
          <ScrollArea className="h-[calc(100vh-12rem)]">
            <div className="space-y-4 pr-4">
              {documents.map((doc, index) => (
                <DocumentCard key={`${doc.jobId}-${doc.type}-${index}`} document={doc} />
              ))}
            </div>
          </ScrollArea>
        )}
    </div>
  )
}

interface DocumentCardProps {
  document: {
    jobId: string
    type: "txt" | "docx"
    sizeBytes: number | null
    url: { url: string; expiresAt: string; key: string } | null
    filesExist: boolean
    thumbnailUrl: { url: string; expiresAt: string; key: string } | null
    thumbnailKey: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }
}

const DocumentCard = ({ document }: DocumentCardProps) => {
  const handleDownload = () => {
    if (!document.url) return
    openSignedUrl(document.url.url)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1 flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">
                {document.type.toUpperCase()} Document
              </CardTitle>
            </div>
            <CardDescription className="text-xs font-mono break-all">
              Job: {document.jobId}
            </CardDescription>
          </div>
          <Badge variant={document.filesExist ? "default" : "secondary"}>
            {document.filesExist ? "Available" : "Missing"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {document.thumbnailUrl && (
          <div className="mb-4">
            <img
              src={document.thumbnailUrl.url}
              alt={`Thumbnail for job ${document.jobId}`}
              className="w-full h-auto rounded-md border object-contain max-h-48"
            />
          </div>
        )}
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Size:</span>
            <span className="font-medium">
              {formatBytes(document.sizeBytes)}
            </span>
          </div>
          {document.createdAt && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Created:</span>
              <span className="font-medium">
                {new Date(document.createdAt).toLocaleString()}
              </span>
            </div>
          )}
        </div>
      </CardContent>
      {document.filesExist && (
        <CardFooter>
          <Button
            type="button"
            size="sm"
            onClick={handleDownload}
            disabled={!document.url}
            className="w-full"
          >
            Download {document.type.toUpperCase()}
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}


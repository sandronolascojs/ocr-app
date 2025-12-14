"use client"

import * as React from "react"
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
import { Image as ImageIcon } from "lucide-react"
import { cn, formatBytes, downloadSignedUrl } from "@/lib/utils"
import { useImages } from "@/hooks/http"
import { usePagination } from "@/hooks/ui/usePagination"
import { trpc } from "@/trpc/client"
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"

interface ImagesViewProps {}

export const ImagesView = ({}: ImagesViewProps) => {
  const pagination = usePagination()
  const utils = trpc.useUtils()

  const imagesQuery = useImages({
    limit: pagination.limit,
    offset: pagination.offset,
  })

  const images = imagesQuery.images
  const totalPages = Math.ceil((imagesQuery.total ?? 0) / pagination.pageSize)
  const currentPage = pagination.pageIndex + 1

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Processed Images
          </h1>
          <p className="text-sm text-muted-foreground">
            All processed image ZIPs from your OCR jobs
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => utils.ocr.listImages.invalidate()}
          disabled={imagesQuery.isLoading}
        >
          Refresh
        </Button>
      </div>

      {imagesQuery.isLoading && (
        <Card>
          <CardContent className="py-8">
            <p className="text-sm text-muted-foreground text-center">
              Loading images...
            </p>
          </CardContent>
        </Card>
      )}

      {imagesQuery.isError && (
        <Card>
          <CardContent className="py-8">
            <p className="text-sm text-destructive text-center">
              Failed to load images:{" "}
              {imagesQuery.error?.message ?? "Unknown error"}
            </p>
          </CardContent>
        </Card>
      )}

      {!imagesQuery.isLoading &&
        !imagesQuery.isError &&
        images.length === 0 && (
          <Card>
            <CardContent className="py-8">
              <p className="text-sm text-muted-foreground text-center">
                No processed images found. Complete an OCR job to generate image
                ZIPs.
              </p>
            </CardContent>
          </Card>
        )}

      {!imagesQuery.isLoading &&
        !imagesQuery.isError &&
        images.length > 0 && (
          <>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {images.map((image) => (
                <ImageCard key={image.jobId} image={image} />
              ))}
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
                imagesQuery.total ?? 0
              )}{" "}
              of {imagesQuery.total ?? 0} images
            </div>
          </>
        )}
    </div>
  )
}

interface ImageCardProps {
  image: {
    jobId: string
    thumbnailUrl: { url: string; expiresAt: string; key: string } | null
    thumbnailKey: string | null
    zipUrl: { url: string; expiresAt: string; key: string } | null
    croppedZipUrl: { url: string; expiresAt: string; key: string } | null
    sizeBytes: number | null
    croppedSizeBytes: number | null
    filesExist: {
      thumbnail: boolean
      zip: boolean
      croppedZip: boolean
    }
    createdAt: Date | null
    updatedAt: Date | null
  }
}

const ImageCard = ({ image }: ImageCardProps) => {
  const [imageError, setImageError] = React.useState(false)

  const handleDownload = () => {
    if (!image.zipUrl) return
    downloadSignedUrl(image.zipUrl.url)
  }

  const handleDownloadCroppedZip = () => {
    if (!image.croppedZipUrl) return
    downloadSignedUrl(image.croppedZipUrl.url)
  }

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="space-y-1">
          <CardTitle className="text-sm font-mono break-all">
            {image.jobId}
          </CardTitle>
          <CardDescription className="text-xs">
            {image.createdAt
              ? new Date(image.createdAt).toLocaleString()
              : "Unknown date"}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex-1">
        <div className="aspect-video rounded-lg border bg-muted/50 flex items-center justify-center overflow-hidden mb-4">
          {image.filesExist.thumbnail &&
          image.thumbnailUrl &&
          !imageError ? (
            <img
              src={image.thumbnailUrl.url}
              alt={`Thumbnail for job ${image.jobId}`}
              className="w-full h-full object-cover"
              onError={() => setImageError(true)}
            />
          ) : (
            <div className="flex flex-col items-center justify-center w-full h-full text-muted-foreground">
              <ImageIcon className="h-12 w-12 mb-2" />
              <span className="text-xs">No thumbnail</span>
            </div>
          )}
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Size:</span>
            <span className="font-medium">
              {formatBytes(image.sizeBytes)}
            </span>
          </div>
          {image.filesExist.croppedZip && image.croppedSizeBytes && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Cropped Size:</span>
              <span className="font-medium">
                {formatBytes(image.croppedSizeBytes)}
              </span>
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              variant={image.filesExist.thumbnail ? "default" : "secondary"}
              className="text-xs"
            >
              Thumbnail: {image.filesExist.thumbnail ? "Yes" : "No"}
            </Badge>
            <Badge
              variant={image.filesExist.zip ? "default" : "secondary"}
              className="text-xs"
            >
              ZIP: {image.filesExist.zip ? "Available" : "Missing"}
            </Badge>
            {image.filesExist.croppedZip && (
              <Badge
                variant="default"
                className="text-xs bg-primary text-primary-foreground font-semibold"
              >
                Cropped ZIP
              </Badge>
            )}
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex flex-col gap-2">
      {image.filesExist.zip && (
          <Button
            type="button"
            size="sm"
            onClick={handleDownload}
            disabled={!image.zipUrl}
            className="w-full"
            variant="outline"
          >
            Download RAW ZIP
          </Button>
        )}
        {image.filesExist.croppedZip && (
          <Button
            type="button"
            size="sm"
            onClick={handleDownloadCroppedZip}
            disabled={!image.croppedZipUrl}
            className="w-full"
          >
            Download Cropped ZIP
          </Button>
        )}
        </CardFooter>
    </Card>
  )
}


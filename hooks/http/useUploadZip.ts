import { useMutation } from "@tanstack/react-query";
import { trpc } from "@/trpc/client";
import { useState, useCallback } from "react";

import { JobType } from "@/types";

type UploadArgs = {
  file: File;
  jobType: JobType;
};

type SignedUploadPayload = {
  type?: "single";
  url: string;
  method: string;
  headers: Record<string, string>;
};

type MultipartUploadPayload = {
  type: "multipart";
  uploadId: string;
  partSizeBytes: number;
  totalParts: number;
  method: "PUT";
  headers: Record<string, string>;
};

type UploadPayload = SignedUploadPayload | MultipartUploadPayload;

type UploadProgress = {
  loaded: number;
  total: number;
  percentage: number;
};

export const useUploadZip = () => {
  const utils = trpc.useUtils();
  const prepareUpload = trpc.ocr.uploadZip.useMutation();
  const getPartUrls = trpc.ocr.getZipMultipartPartUrls.useMutation();
  const completeMultipart = trpc.ocr.completeZipMultipartUpload.useMutation();
  const abortMultipart = trpc.ocr.abortZipMultipartUpload.useMutation();
  const confirmUpload = trpc.jobs.confirmUpload.useMutation();
  const abortUpload = trpc.ocr.abortUpload.useMutation();
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(
    null
  );

  const mutation = useMutation({
    mutationFn: async ({
      file,
      jobType,
      onProgress,
    }: UploadArgs & { onProgress?: (progress: UploadProgress) => void }) => {
      const prepareResponse = await prepareUpload.mutateAsync({
        filename: file.name,
        fileType: file.type || "application/zip",
        fileSize: file.size,
      });

      let uploadSucceeded = false;

      try {
        await uploadZipToStorage({
          file,
          jobId: prepareResponse.jobId,
          upload: prepareResponse.upload as UploadPayload,
          onProgress,
          getPartUrls: async (args) => {
            const res = await getPartUrls.mutateAsync(args);
            return res.urls;
          },
          completeMultipart: async (args) => {
            await completeMultipart.mutateAsync(args);
          },
          abortMultipart: async (args) => {
            await abortMultipart.mutateAsync(args);
          },
        });
        uploadSucceeded = true;

        await confirmUpload.mutateAsync({ 
          jobId: prepareResponse.jobId,
          jobType,
        });

        return { jobId: prepareResponse.jobId };
      } catch (error) {
        // If upload succeeded but confirmUpload fails, attempt cleanup to remove orphaned file
        if (uploadSucceeded) {
          console.warn(
            `Upload confirmation failed for job ${prepareResponse.jobId}, attempting cleanup...`
          );

          try {
            await abortUpload.mutateAsync({ jobId: prepareResponse.jobId });
            console.info(
              `Successfully cleaned up orphaned file for job ${prepareResponse.jobId}`
            );
          } catch (cleanupError) {
            console.error(
              `Failed to cleanup orphaned file for job ${prepareResponse.jobId}:`,
              cleanupError instanceof Error ? cleanupError.message : cleanupError
            );
            // Don't suppress the original error - log cleanup failure but rethrow original
          }
        }

        // Rethrow the original error
        throw error;
      }
    },
    onSuccess: () => {
      utils.jobs.listJobs.invalidate();
      // Reset progress after successful upload
      setTimeout(() => {
        setUploadProgress(null);
      }, 500);
    },
    onError: () => {
      // Reset progress on error
      setUploadProgress(null);
    },
  });

  const mutateAsync = useCallback(
    async (args: UploadArgs) => {
      // Reset progress when starting a new upload
      setUploadProgress(null);
      return mutation.mutateAsync({
        ...args,
        onProgress: (progress) => {
          setUploadProgress(progress);
        },
      });
    },
    [mutation]
  );

  return {
    ...mutation,
    mutateAsync,
    uploadProgress,
  };
};

const uploadViaSignedUrl = async (
  file: File,
  signed: SignedUploadPayload,
  onProgress?: (progress: UploadProgress) => void
): Promise<void> => {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && onProgress) {
        const loaded = event.loaded;
        const total = event.total;
        const percentage = Math.round((loaded / total) * 100);

        onProgress({
          loaded,
          total,
          percentage,
  });
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(
          new Error(
            `Failed to upload ZIP to storage (status ${xhr.status})`
          )
        );
      }
    });

    xhr.addEventListener("error", () => {
      reject(new Error("Network error during upload"));
    });

    xhr.addEventListener("abort", () => {
      reject(new Error("Upload was aborted"));
    });

    xhr.open(signed.method, signed.url);

    // Set headers
    Object.entries(signed.headers).forEach(([key, value]) => {
      xhr.setRequestHeader(key, value);
    });

    xhr.send(file);
  });
};

type SignedPartUrl = {
  partNumber: number;
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: string;
};

type UploadZipToStorageArgs = {
  file: File;
  jobId: string;
  upload: UploadPayload;
  onProgress?: (progress: UploadProgress) => void;
  getPartUrls: (args: {
    jobId: string;
    uploadId: string;
    contentType?: string;
    startPartNumber: number;
    count: number;
  }) => Promise<SignedPartUrl[]>;
  completeMultipart: (args: {
    jobId: string;
    uploadId: string;
    parts: Array<{ partNumber: number; etag: string }>;
  }) => Promise<void>;
  abortMultipart: (args: { jobId: string; uploadId: string }) => Promise<void>;
};

const uploadZipToStorage = async ({
  file,
  jobId,
  upload,
  onProgress,
  getPartUrls,
  completeMultipart,
  abortMultipart,
}: UploadZipToStorageArgs): Promise<void> => {
  if ((upload as MultipartUploadPayload).type === "multipart") {
    const multipart = upload as MultipartUploadPayload;
    try {
      await uploadViaMultipart({
        file,
        jobId,
        uploadId: multipart.uploadId,
        partSizeBytes: multipart.partSizeBytes,
        totalParts: multipart.totalParts,
        contentType: multipart.headers["Content-Type"] ?? "application/zip",
        onProgress,
        getPartUrls,
        completeMultipart,
      });
    } catch (error) {
      try {
        await abortMultipart({ jobId, uploadId: multipart.uploadId });
      } catch {
        // best-effort abort; rethrow original error
      }
      throw error;
    }
    return;
  }

  await uploadViaSignedUrl(file, upload as SignedUploadPayload, onProgress);
};

type UploadViaMultipartArgs = {
  file: File;
  jobId: string;
  uploadId: string;
  partSizeBytes: number;
  totalParts: number;
  contentType: string;
  onProgress?: (progress: UploadProgress) => void;
  getPartUrls: UploadZipToStorageArgs["getPartUrls"];
  completeMultipart: UploadZipToStorageArgs["completeMultipart"];
};

const uploadViaMultipart = async ({
  file,
  jobId,
  uploadId,
  partSizeBytes,
  totalParts,
  contentType,
  onProgress,
  getPartUrls,
  completeMultipart,
}: UploadViaMultipartArgs): Promise<void> => {
  const urlsByPart = new Map<number, SignedPartUrl>();

  for (let start = 1; start <= totalParts; start += 500) {
    const count = Math.min(500, totalParts - start + 1);
    const urls = await getPartUrls({
      jobId,
      uploadId,
      contentType,
      startPartNumber: start,
      count,
    });
    for (const u of urls) {
      urlsByPart.set(u.partNumber, u);
    }
  }

  const uploadedBytesByPart = new Map<number, number>();
  const completedParts: Array<{ partNumber: number; etag: string }> = [];

  const updateProgress = () => {
    if (!onProgress) return;
    let loaded = 0;
    for (const v of uploadedBytesByPart.values()) loaded += v;
    const total = file.size;
    const percentage = total > 0 ? Math.round((loaded / total) * 100) : 0;
    onProgress({ loaded, total, percentage });
  };

  const concurrency = 4;
  let nextPartNumber = 1;

  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const partNumber = nextPartNumber;
      nextPartNumber += 1;
      if (partNumber > totalParts) return;

      const startByte = (partNumber - 1) * partSizeBytes;
      const endByteExclusive = Math.min(file.size, startByte + partSizeBytes);
      const blob = file.slice(startByte, endByteExclusive);

      const signed = urlsByPart.get(partNumber);
      if (!signed) {
        throw new Error(`Missing signed URL for multipart part ${partNumber}.`);
      }

      const { etag } = await uploadPartViaXhr({
        signed,
        blob,
        onProgress: (loaded) => {
          uploadedBytesByPart.set(partNumber, loaded);
          updateProgress();
        },
      });

      uploadedBytesByPart.set(partNumber, blob.size);
      updateProgress();
      completedParts.push({ partNumber, etag });
    }
  });

  await Promise.all(workers);

  // Ensure a stable, complete list of parts for the finalize call
  const parts = completedParts
    .slice()
    .sort((a, b) => a.partNumber - b.partNumber);

  if (parts.length !== totalParts) {
    throw new Error(
      `Multipart upload incomplete: uploaded ${parts.length}/${totalParts} parts.`
    );
  }

  await completeMultipart({
    jobId,
    uploadId,
    parts,
  });
};

type UploadPartViaXhrArgs = {
  signed: SignedPartUrl;
  blob: Blob;
  onProgress: (loaded: number) => void;
};

const uploadPartViaXhr = async ({
  signed,
  blob,
  onProgress,
}: UploadPartViaXhrArgs): Promise<{ etag: string }> => {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress(event.loaded);
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader("ETag");
        if (!etag) {
          reject(new Error("Missing ETag header after uploading a part."));
          return;
        }
        resolve({ etag });
      } else {
        reject(
          new Error(
            `Failed to upload multipart part ${signed.partNumber} (status ${xhr.status})`
          )
        );
      }
    });

    xhr.addEventListener("error", () => {
      reject(new Error("Network error during multipart upload"));
    });

    xhr.addEventListener("abort", () => {
      reject(new Error("Multipart upload was aborted"));
    });

    xhr.open(signed.method, signed.url);

    Object.entries(signed.headers).forEach(([key, value]) => {
      xhr.setRequestHeader(key, value);
    });

    xhr.send(blob);
  });
};
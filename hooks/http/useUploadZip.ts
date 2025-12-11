import { useMutation } from "@tanstack/react-query";
import { trpc } from "@/trpc/client";
import { useState, useCallback } from "react";

type UploadArgs = {
  file: File;
};

type SignedUploadPayload = {
  url: string;
  method: string;
  headers: Record<string, string>;
};

type UploadProgress = {
  loaded: number;
  total: number;
  percentage: number;
};

export const useUploadOcrZip = () => {
  const utils = trpc.useUtils();
  const prepareUpload = trpc.ocr.uploadZip.useMutation();
  const confirmUpload = trpc.ocr.confirmUpload.useMutation();
  const abortUpload = trpc.ocr.abortUpload.useMutation();
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(
    null
  );

  const mutation = useMutation({
    mutationFn: async ({
      file,
      onProgress,
    }: UploadArgs & { onProgress?: (progress: UploadProgress) => void }) => {
      const prepareResponse = await prepareUpload.mutateAsync({
        filename: file.name,
        fileType: file.type || "application/zip",
        fileSize: file.size,
      });

      let uploadSucceeded = false;

      try {
        await uploadViaSignedUrl(file, prepareResponse.upload, onProgress);
        uploadSucceeded = true;

        await confirmUpload.mutateAsync({ jobId: prepareResponse.jobId });

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
      utils.ocr.listJobs.invalidate();
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
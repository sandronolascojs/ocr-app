import { useMutation } from "@tanstack/react-query";
import { trpc } from "@/trpc/client";

type UploadArgs = {
  file: File;
};

type SignedUploadPayload = {
  url: string;
  method: string;
  headers: Record<string, string>;
};

export const useUploadOcrZip = () => {
  const utils = trpc.useUtils();
  const prepareUpload = trpc.ocr.uploadZip.useMutation();
  const confirmUpload = trpc.ocr.confirmUpload.useMutation();
  const abortUpload = trpc.ocr.abortUpload.useMutation();

  return useMutation({
    mutationFn: async ({ file }: UploadArgs) => {
      const prepareResponse = await prepareUpload.mutateAsync({
        filename: file.name,
        fileType: file.type || "application/zip",
        fileSize: file.size,
      });

      let uploadSucceeded = false;

      try {
        await uploadViaSignedUrl(file, prepareResponse.upload);
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
    },
  });
};

const uploadViaSignedUrl = async (file: File, signed: SignedUploadPayload) => {
  const response = await fetch(signed.url, {
    method: signed.method,
    headers: signed.headers,
    body: file,
  });

  if (!response.ok) {
    throw new Error(`Failed to upload ZIP to storage (status ${response.status})`);
  }
};
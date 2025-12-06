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

  return useMutation({
    mutationFn: async ({ file }: UploadArgs) => {
      const prepareResponse = await prepareUpload.mutateAsync({
        filename: file.name,
        fileType: file.type || "application/zip",
        fileSize: file.size,
      });

      await uploadViaSignedUrl(file, prepareResponse.upload);

      await confirmUpload.mutateAsync({ jobId: prepareResponse.jobId });

      return { jobId: prepareResponse.jobId };
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
import { useMutation } from "@tanstack/react-query";
import { trpc } from "@/trpc/client";

type UploadArgs = {
  file: File;
};

export const useUploadOcrZip = () => {
  const utils = trpc.useUtils();
  const mutation = trpc.ocr.uploadZip.useMutation();

  return useMutation({
    mutationFn: async ({ file }: UploadArgs) => {
      const base64 = await fileToDataUrl(file);

      const res = await mutation.mutateAsync({
        fileBase64: base64,
        filename: file.name,
      });

      return res; // { jobId }
    },
    onSuccess: () => {
      utils.ocr.listJobs.invalidate();
    },
  });
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });
}
import { useMutation } from "@tanstack/react-query";
import Uppy from "@uppy/core";
import AwsS3 from "@uppy/aws-s3";
import { useCallback, useState } from "react";

import { trpc } from "@/trpc/client";
import { JobType } from "@/types";

type UploadArgs = {
  file: File;
  jobType: JobType;
};

type UploadProgress = {
  loaded: number;
  total: number;
  percentage: number;
};

type SignedUploadPayload = {
  key: string;
  url: string;
  method: "PUT";
  headers: Record<string, string>;
};

type MultipartUploadPayload = {
  type: "multipart";
  key: string;
  uploadId: string;
  partSizeBytes: number;
  totalParts: number;
  headers: Record<string, string>;
};

type UploadPayload = SignedUploadPayload | MultipartUploadPayload;

const isMultipart = (upload: UploadPayload): upload is MultipartUploadPayload => {
  return (upload as MultipartUploadPayload).type === "multipart";
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

      const upload = prepareResponse.upload as UploadPayload;
      const jobId = prepareResponse.jobId;

      let uploadSucceeded = false;

      try {
        await uploadZipWithUppy({
          file,
          jobId,
          upload,
          onProgress,
          utils,
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
          jobId,
          jobType,
        });

        return { jobId };
      } catch (error) {
        // If upload succeeded but confirmUpload fails, attempt cleanup to remove orphaned file
        if (uploadSucceeded) {
          try {
            await abortUpload.mutateAsync({ jobId });
          } catch {
            // best-effort cleanup
          }
        }
        throw error;
      }
    },
    onSuccess: () => {
      utils.jobs.listJobs.invalidate();
      setTimeout(() => {
        setUploadProgress(null);
      }, 500);
    },
    onError: () => {
      setUploadProgress(null);
    },
  });

  const mutateAsync = useCallback(
    async (args: UploadArgs) => {
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

type SignedPartUrl = {
  partNumber: number;
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: string;
};

type UploadZipWithUppyArgs = {
  file: File;
  jobId: string;
  upload: UploadPayload;
  onProgress?: (progress: UploadProgress) => void;
  utils: ReturnType<typeof trpc.useUtils>;
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
    expectedTotalParts: number;
    expectedSizeBytes: number;
  }) => Promise<void>;
  abortMultipart: (args: { jobId: string; uploadId: string }) => Promise<void>;
};

const uploadZipWithUppy = async ({
  file,
  jobId,
  upload,
  onProgress,
  utils,
  getPartUrls,
  completeMultipart,
  abortMultipart,
}: UploadZipWithUppyArgs): Promise<void> => {
  const contentType = file.type || "application/zip";
  const multipart = isMultipart(upload) ? upload : null;
  const single = multipart ? null : (upload as SignedUploadPayload);

  const uppy = new Uppy({
    autoProceed: true,
    restrictions: {
      maxNumberOfFiles: 1,
    },
  });

  uppy.on("upload-progress", (_file, progress) => {
    if (!onProgress) return;
    const total = file.size;
    const loaded = progress.bytesUploaded ?? 0;
    const percentage = total > 0 ? Math.round((loaded / total) * 100) : 0;
    onProgress({ loaded, total, percentage });
  });

  uppy.use(AwsS3, {
    // Bounded concurrency at the plugin level.
    limit: 4,
    retryDelays: [0, 1000, 3000, 5000, 10000],
    shouldUseMultipart: () => Boolean(multipart),
    getChunkSize: () => multipart?.partSizeBytes ?? file.size,
    getUploadParameters: async () => {
      if (multipart) {
        throw new Error("getUploadParameters called for a multipart upload.");
      }
      if (!single) {
        throw new Error("Missing single upload parameters.");
      }
      return {
        method: "PUT",
        url: single.url,
        fields: {},
        headers: {
          ...single.headers,
          "Content-Type": contentType,
        },
      };
    },
    createMultipartUpload: async () => {
      if (!multipart) {
        throw new Error("createMultipartUpload called for a non-multipart upload.");
      }
      return {
        key: multipart.key,
        uploadId: multipart.uploadId,
      };
    },
    listParts: async (_file, opts) => {
      if (!multipart) {
        throw new Error("listParts called for a non-multipart upload.");
      }
      if (!opts.uploadId) {
        throw new Error("Missing uploadId for listParts.");
      }
      // Used by Uppy for pause/resume. We list via server credentials.
      const res = await utils.ocr.listZipMultipartParts.fetch({
        jobId,
        uploadId: opts.uploadId,
      });
      return res.parts;
    },
    signPart: async (_file, opts) => {
      const urls = await getPartUrls({
        jobId,
        uploadId: opts.uploadId,
        contentType,
        startPartNumber: opts.partNumber,
        count: 1,
      });
      const signed = urls[0];
      if (!signed) {
        throw new Error(`Failed to sign part ${opts.partNumber}.`);
      }
      return {
        method: "PUT",
        url: signed.url,
        fields: {},
        headers: signed.headers,
      };
    },
    completeMultipartUpload: async (_file, opts) => {
      if (!multipart) {
        throw new Error("completeMultipartUpload called for a non-multipart upload.");
      }
      if (!opts.uploadId) {
        throw new Error("Missing uploadId for completeMultipartUpload.");
      }
      await completeMultipart({
        jobId,
        uploadId: opts.uploadId,
        expectedTotalParts: multipart.totalParts,
        expectedSizeBytes: file.size,
      });
      return {};
    },
    abortMultipartUpload: async (_file, opts) => {
      if (!multipart) return;
      const uploadId = opts.uploadId ?? multipart.uploadId;
      await abortMultipart({
        jobId,
        uploadId,
      });
    },
  });

  try {
    uppy.addFile({
      name: file.name,
      type: contentType,
      data: file,
      source: "local",
      isRemote: false,
    });

    const result = await uppy.upload();
    if (!result) {
      throw new Error("Upload did not return a result (possibly aborted).");
    }
    const failed = result.failed ?? [];
    if (failed.length > 0) {
      const err = failed[0]?.error;
      throw err ?? new Error("Upload failed");
    }
  } catch (error) {
    // Ensure we don't leave dangling multipart uploads behind.
    if (multipart) {
      try {
        await abortMultipart({ jobId, uploadId: multipart.uploadId });
      } catch {
        // best-effort cleanup
      }
    }
    throw error;
  } finally {
    uppy.destroy();
  }
};
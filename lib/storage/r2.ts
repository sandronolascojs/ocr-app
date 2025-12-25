import { createWriteStream, createReadStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { PassThrough, Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListPartsCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  type GetObjectCommandInput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Upload } from "@aws-sdk/lib-storage";

import { env } from "@/env.mjs";

const r2Endpoint =
  env.CLOUDFLARE_R2_S3_ENDPOINT ??
  `https://${env.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

const r2Client = new S3Client({
  region: "auto",
  endpoint: r2Endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId: env.CLOUDFLARE_R2_ACCESS_KEY_ID,
    secretAccessKey: env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
  },
});

type SignedUrlBase = {
  url: string;
  expiresAt: string;
  key: string;
};

export type SignedUploadUrl = SignedUrlBase & {
  method: "PUT";
  headers: Record<string, string>;
};

export type SignedDownloadUrl = SignedUrlBase & {
  headers: Record<string, string>;
};

const createExpiryIso = (ttlSeconds: number): string =>
  new Date(Date.now() + ttlSeconds * 1000).toISOString();

const DEFAULT_STREAM_UPLOAD_CACHE_CONTROL = "private, max-age=0, must-revalidate";
const R2_SINGLE_PART_MAX_BYTES = 5 * 1024 * 1024 * 1024; // 5 GiB
// Browser uploads work better with larger part sizes (fewer requests, less signing, fewer edge failures).
// R2/S3 minimum part size is 5MiB (except last part), maximum part size is 5GiB.
const R2_MULTIPART_MIN_PART_BYTES = 64 * 1024 * 1024; // 64MiB
const R2_MULTIPART_MAX_PART_BYTES = 1024 * 1024 * 1024; // 1GiB
const R2_MULTIPART_MAX_PARTS = 10_000;

export type MultipartUploadInit = SignedUrlBase & {
  type: "multipart";
  uploadId: string;
  partSizeBytes: number;
  totalParts: number;
  method: "PUT";
  headers: Record<string, string>;
};

export type UploadPlan =
  | ({
      type: "single";
      method: "PUT";
      headers: Record<string, string>;
    } & SignedUrlBase)
  | MultipartUploadInit;

type CompletedPart = {
  partNumber: number;
  etag: string;
};

const roundUpToMiB = (bytes: number): number => {
  const mib = 1024 * 1024;
  return Math.ceil(bytes / mib) * mib;
};

export const pickMultipartPartSizeBytes = (fileSizeBytes: number): number => {
  // Target a reasonable number of parts for browser reliability.
  // 50GiB at 64MiB -> ~800 parts. At 256MiB -> ~200 parts.
  const targetMaxParts = 1000;
  const minBytesToStayUnderTarget = Math.ceil(fileSizeBytes / targetMaxParts);
  const candidate = roundUpToMiB(minBytesToStayUnderTarget);

  return Math.min(
    R2_MULTIPART_MAX_PART_BYTES,
    Math.max(R2_MULTIPART_MIN_PART_BYTES, candidate)
  );
};

export const shouldUseMultipartUpload = (fileSizeBytes: number): boolean => {
  // Cloudflare R2 single-part upload limit is ~5 GiB. Anything above must use multipart.
  return fileSizeBytes > R2_SINGLE_PART_MAX_BYTES;
};

/**
 * Sanitizes a filename for use in Content-Disposition header.
 * Removes CR/LF characters and escapes quotes and backslashes.
 */
const sanitizeFilename = (filename: string): string => {
  return filename
    .replace(/[\r\n]/g, " ") // Replace CR/LF with spaces
    .replace(/\\/g, "\\\\") // Escape backslashes
    .replace(/"/g, '\\"'); // Escape quotes
};

/**
 * Encodes a filename according to RFC5987 for use in Content-Disposition header.
 * Returns the encoded value for the filename* parameter.
 */
const encodeFilenameRfc5987 = (filename: string): string => {
  return encodeURIComponent(filename);
};

/**
 * Checks if an error indicates that an R2 object was not found.
 * Handles various error formats from AWS SDK S3-compatible APIs.
 */
const isNotFoundError = (error: unknown): boolean => {
  const isNotFoundName =
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: string }).name === "NotFound";
  const isNotFoundCode =
    typeof error === "object" &&
    error !== null &&
    "Code" in error &&
    (error as { Code?: string }).Code === "NoSuchKey";
  const isNotFoundStatus =
    typeof error === "object" &&
    error !== null &&
    "$metadata" in error &&
    Boolean(
      (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode === 404
    );

  return isNotFoundName || isNotFoundCode || isNotFoundStatus;
};

const isNoSuchUploadError = (error: unknown): boolean => {
  const isNoSuchUploadCode =
    typeof error === "object" &&
    error !== null &&
    "Code" in error &&
    (error as { Code?: string }).Code === "NoSuchUpload";

  const isNoSuchUploadName =
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: string }).name === "NoSuchUpload";

  return isNoSuchUploadCode || isNoSuchUploadName;
};

export const createSignedUploadUrl = async (params: {
  key: string;
  contentType: string;
}): Promise<SignedUploadUrl> => {
  const ttl = env.R2_SIGNED_UPLOAD_TTL_SECONDS;
  const command = new PutObjectCommand({
    Bucket: env.CLOUDFLARE_R2_BUCKET_NAME,
    Key: params.key,
    ContentType: params.contentType,
  });

  const url = await getSignedUrl(r2Client, command, { expiresIn: ttl });

  return {
    key: params.key,
    url,
    method: "PUT",
    headers: {
      "Content-Type": params.contentType,
    },
    expiresAt: createExpiryIso(ttl),
  };
};

export const createMultipartUpload = async (params: {
  key: string;
  contentType: string;
  fileSizeBytes: number;
}): Promise<MultipartUploadInit> => {
  const ttl = env.R2_SIGNED_UPLOAD_TTL_SECONDS;
  const createResponse = await r2Client.send(
    new CreateMultipartUploadCommand({
      Bucket: env.CLOUDFLARE_R2_BUCKET_NAME,
      Key: params.key,
      ContentType: params.contentType,
    })
  );

  if (!createResponse.UploadId) {
    throw new Error("Failed to create multipart upload: missing UploadId.");
  }

  const partSizeBytes = pickMultipartPartSizeBytes(params.fileSizeBytes);
  const totalParts = Math.ceil(params.fileSizeBytes / partSizeBytes);

  if (totalParts > R2_MULTIPART_MAX_PARTS) {
    throw new Error(
      `Multipart upload would require ${totalParts} parts which exceeds the maximum of ${R2_MULTIPART_MAX_PARTS}.`
    );
  }

  return {
    type: "multipart",
    key: params.key,
    url: "", // not used for multipart; parts are uploaded via per-part signed URLs
    uploadId: createResponse.UploadId,
    partSizeBytes,
    totalParts,
    method: "PUT",
    headers: {
      // UploadPart requests should not require Content-Type, but it is safe if the client sets it.
      "Content-Type": params.contentType,
    },
    expiresAt: createExpiryIso(ttl),
  };
};

export type SignedUploadPartUrl = {
  partNumber: number;
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: string;
};

export const createSignedUploadPartUrls = async (params: {
  key: string;
  uploadId: string;
  contentType: string;
  partNumbers: number[];
}): Promise<SignedUploadPartUrl[]> => {
  const ttl = env.R2_SIGNED_UPLOAD_TTL_SECONDS;
  const expiresAt = createExpiryIso(ttl);

  const unique = Array.from(new Set(params.partNumbers)).sort((a, b) => a - b);

  const urls = await Promise.all(
    unique.map(async (partNumber) => {
      if (!Number.isInteger(partNumber) || partNumber < 1) {
        throw new Error(`Invalid multipart partNumber: ${partNumber}`);
      }

      const command = new UploadPartCommand({
        Bucket: env.CLOUDFLARE_R2_BUCKET_NAME,
        Key: params.key,
        UploadId: params.uploadId,
        PartNumber: partNumber,
      });

      const url = await getSignedUrl(r2Client, command, { expiresIn: ttl });

      return {
        partNumber,
        url,
        method: "PUT" as const,
        headers: {
          "Content-Type": params.contentType,
        },
        expiresAt,
      };
    })
  );

  return urls;
};

export const completeMultipartUpload = async (params: {
  key: string;
  uploadId: string;
  parts: CompletedPart[];
}): Promise<void> => {
  const normalizedParts = params.parts
    .slice()
    .sort((a, b) => a.partNumber - b.partNumber)
    .map((p) => ({
      ETag: p.etag,
      PartNumber: p.partNumber,
    }));

  await r2Client.send(
    new CompleteMultipartUploadCommand({
      Bucket: env.CLOUDFLARE_R2_BUCKET_NAME,
      Key: params.key,
      UploadId: params.uploadId,
      MultipartUpload: {
        Parts: normalizedParts,
      },
    })
  );
};

type ListedPart = {
  partNumber: number;
  etag: string;
  sizeBytes: number;
};

const listAllMultipartParts = async (params: {
  key: string;
  uploadId: string;
}): Promise<ListedPart[]> => {
  const parts: ListedPart[] = [];
  let partNumberMarker: string | undefined;

  // S3 ListParts returns up to 1000 parts per page
  do {
    const response = await r2Client.send(
      new ListPartsCommand({
        Bucket: env.CLOUDFLARE_R2_BUCKET_NAME,
        Key: params.key,
        UploadId: params.uploadId,
        PartNumberMarker: partNumberMarker,
        MaxParts: 1000,
      })
    );

    for (const p of response.Parts ?? []) {
      if (!p.PartNumber || !p.ETag || typeof p.Size !== "number") continue;
      parts.push({
        partNumber: p.PartNumber,
        etag: p.ETag,
        sizeBytes: p.Size,
      });
    }

    partNumberMarker = response.IsTruncated ? response.NextPartNumberMarker : undefined;
  } while (partNumberMarker);

  return parts;
};

export type MultipartUploadPart = {
  PartNumber: number;
  Size: number;
  ETag: string;
};

export const listMultipartUploadParts = async (params: {
  key: string;
  uploadId: string;
}): Promise<MultipartUploadPart[]> => {
  const parts = await listAllMultipartParts({
    key: params.key,
    uploadId: params.uploadId,
  });

  return parts.map((p) => ({
    PartNumber: p.partNumber,
    Size: p.sizeBytes,
    ETag: p.etag,
  }));
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
};

/**
 * Completes a multipart upload by listing the uploaded parts server-side.
 *
 * This avoids requiring the browser to read ETag response headers (often blocked by CORS),
 * and guarantees the final object is created as a single R2 object.
 */
export const completeMultipartUploadByListingParts = async (params: {
  key: string;
  uploadId: string;
  expectedTotalParts?: number;
  expectedSizeBytes?: number;
}): Promise<void> => {
  const maxAttempts = 20;
  const delayMs = 300;

  let parts: ListedPart[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    parts = await listAllMultipartParts({
      key: params.key,
      uploadId: params.uploadId,
    });

    if (!params.expectedTotalParts || parts.length >= params.expectedTotalParts) {
      break;
    }

    await sleep(delayMs);
  }

  if (parts.length === 0) {
    throw new Error(
      "Cannot complete multipart upload: no uploaded parts were found for this uploadId."
    );
  }

  if (params.expectedTotalParts && parts.length < params.expectedTotalParts) {
    throw new Error(
      `Cannot complete multipart upload: expected ${params.expectedTotalParts} parts, but only found ${parts.length}.`
    );
  }

  if (params.expectedTotalParts) {
    const partNumbers = new Set(parts.map((p) => p.partNumber));
    for (let n = 1; n <= params.expectedTotalParts; n += 1) {
      if (!partNumbers.has(n)) {
        throw new Error(
          `Cannot complete multipart upload: missing partNumber ${n} of ${params.expectedTotalParts}.`
        );
      }
    }
  }

  if (typeof params.expectedSizeBytes === "number") {
    const totalUploadedBytes = parts.reduce((acc, p) => acc + p.sizeBytes, 0);
    if (totalUploadedBytes !== params.expectedSizeBytes) {
      throw new Error(
        `Cannot complete multipart upload: uploaded bytes (${totalUploadedBytes}) do not match expected file size (${params.expectedSizeBytes}).`
      );
    }
  }

  await completeMultipartUpload({
    key: params.key,
    uploadId: params.uploadId,
    parts,
  });
};

export type MultipartUploadStatus = {
  key: string;
  uploadId: string;
  partCount: number;
  expectedTotalParts: number | null;
  objectExists: boolean;
  objectSizeBytes: number | null;
};

export const getMultipartUploadStatus = async (params: {
  key: string;
  uploadId: string;
  expectedTotalParts?: number;
}): Promise<MultipartUploadStatus> => {
  const expectedTotalParts = params.expectedTotalParts ?? null;

  let partsCount = 0;
  try {
    const parts = await listAllMultipartParts({
      key: params.key,
      uploadId: params.uploadId,
    });
    partsCount = parts.length;
  } catch (error) {
    // If the upload was already completed/aborted, ListParts can throw NoSuchUpload.
    if (!isNoSuchUploadError(error)) {
      throw error;
    }
  }

  const objectSizeBytes = await getObjectSize(params.key);
  const objectExists = objectSizeBytes !== null;

  return {
    key: params.key,
    uploadId: params.uploadId,
    partCount: partsCount,
    expectedTotalParts,
    objectExists,
    objectSizeBytes,
  };
};

export const abortMultipartUpload = async (params: {
  key: string;
  uploadId: string;
}): Promise<void> => {
  await r2Client.send(
    new AbortMultipartUploadCommand({
      Bucket: env.CLOUDFLARE_R2_BUCKET_NAME,
      Key: params.key,
      UploadId: params.uploadId,
    })
  );
};

export const createSignedDownloadUrl = async (params: {
  key: string;
  responseContentType: string;
  downloadFilename: string;
}): Promise<SignedDownloadUrl> => {
  const ttl = env.R2_SIGNED_DOWNLOAD_TTL_SECONDS;
  const sanitizedFilename = sanitizeFilename(params.downloadFilename);
  const encodedFilename = encodeFilenameRfc5987(params.downloadFilename);
  const contentDisposition = `attachment; filename="${sanitizedFilename}"; filename*=UTF-8''${encodedFilename}`;

  const command = new GetObjectCommand({
    Bucket: env.CLOUDFLARE_R2_BUCKET_NAME,
    Key: params.key,
    ResponseContentType: params.responseContentType,
    ResponseContentDisposition: contentDisposition,
  } satisfies GetObjectCommandInput);

  const url = await getSignedUrl(r2Client, command, { expiresIn: ttl });

  return {
    key: params.key,
    url,
    headers: {},
    expiresAt: createExpiryIso(ttl),
  };
};

export const createSignedDownloadUrlWithTtl = async (params: {
  key: string;
  responseContentType: string;
  downloadFilename: string;
  ttlSeconds: number;
}): Promise<SignedDownloadUrl> => {
  const sanitizedFilename = sanitizeFilename(params.downloadFilename);
  const encodedFilename = encodeFilenameRfc5987(params.downloadFilename);
  const contentDisposition = `attachment; filename="${sanitizedFilename}"; filename*=UTF-8''${encodedFilename}`;

  const command = new GetObjectCommand({
    Bucket: env.CLOUDFLARE_R2_BUCKET_NAME,
    Key: params.key,
    ResponseContentType: params.responseContentType,
    ResponseContentDisposition: contentDisposition,
  } satisfies GetObjectCommandInput);

  const url = await getSignedUrl(r2Client, command, {
    expiresIn: params.ttlSeconds,
  });

  return {
    key: params.key,
    url,
    headers: {},
    expiresAt: createExpiryIso(params.ttlSeconds),
  };
};

export const ensureObjectExists = async (key: string): Promise<boolean> => {
  try {
    await r2Client.send(
      new HeadObjectCommand({
        Bucket: env.CLOUDFLARE_R2_BUCKET_NAME,
        Key: key,
      })
    );
    return true;
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }
    throw error;
  }
};

export const downloadObjectToFile = async (params: {
  key: string;
  filePath: string;
}): Promise<void> => {
  const response = await r2Client.send(
    new GetObjectCommand({
      Bucket: env.CLOUDFLARE_R2_BUCKET_NAME,
      Key: params.key,
    })
  );

  if (!response.Body) {
    throw new Error(`R2 object ${params.key} has no body to download.`);
  }

  const readable = response.Body as Readable;
  await mkdir(path.dirname(params.filePath), { recursive: true });
  await pipeline(readable, createWriteStream(params.filePath));
};

export const downloadObjectStream = async (key: string): Promise<Readable> => {
  const response = await r2Client.send(
    new GetObjectCommand({
      Bucket: env.CLOUDFLARE_R2_BUCKET_NAME,
      Key: key,
    })
  );

  if (!response.Body) {
    throw new Error(`R2 object ${key} has no body to download.`);
  }

  return response.Body as Readable;
};

export const uploadFileToObject = async (params: {
  key: string;
  filePath: string;
  contentType: string;
  cacheControl?: string;
}): Promise<void> => {
  await r2Client.send(
    new PutObjectCommand({
      Bucket: env.CLOUDFLARE_R2_BUCKET_NAME,
      Key: params.key,
      Body: createReadStream(params.filePath),
      ContentType: params.contentType,
      CacheControl: params.cacheControl,
    })
  );
};

export const uploadBufferToObject = async (params: {
  key: string;
  body: Buffer;
  contentType: string;
  cacheControl?: string;
}): Promise<void> => {
  await r2Client.send(
    new PutObjectCommand({
      Bucket: env.CLOUDFLARE_R2_BUCKET_NAME,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
      CacheControl: params.cacheControl ?? DEFAULT_STREAM_UPLOAD_CACHE_CONTROL,
    })
  );
};

export const uploadStreamToObject = async (params: {
  key: string;
  stream: Readable;
  contentType: string;
  cacheControl?: string;
}): Promise<void> => {
  const uploader = new Upload({
    client: r2Client,
    params: {
      Bucket: env.CLOUDFLARE_R2_BUCKET_NAME,
      Key: params.key,
      Body: params.stream,
      ContentType: params.contentType,
      CacheControl: params.cacheControl ?? DEFAULT_STREAM_UPLOAD_CACHE_CONTROL,
    },
    queueSize: 4,
    partSize: 8 * 1024 * 1024, // 8MB parts to balance memory and requests
    leavePartsOnError: false,
  });

  await uploader.done();
};

export const uploadStreamToObjectWithSize = async (params: {
  key: string;
  streamFactory: () => Readable;
  contentType: string;
  cacheControl?: string;
}): Promise<number> => {
  let sizeBytes = 0;

  const countingStream = new Transform({
    transform(chunk, _encoding, callback) {
      sizeBytes += chunk.length;
      callback(null, chunk);
    },
  });

  const upstream = params.streamFactory();
  const passThrough = new PassThrough();

  upstream.pipe(countingStream).pipe(passThrough);

  await uploadStreamToObject({
    key: params.key,
    stream: passThrough,
    contentType: params.contentType,
    cacheControl: params.cacheControl,
  });

  return sizeBytes;
};

export const deleteObjectIfExists = async (key: string): Promise<void> => {
  await r2Client.send(
    new DeleteObjectCommand({
      Bucket: env.CLOUDFLARE_R2_BUCKET_NAME,
      Key: key,
    })
  );
};

export const listObjectsByPrefix = async (
  prefix: string
): Promise<Array<{ key: string; size: number }>> => {
  const objects: Array<{ key: string; size: number }> = [];
  let continuationToken: string | undefined;

  do {
    const command = new ListObjectsV2Command({
      Bucket: env.CLOUDFLARE_R2_BUCKET_NAME,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    });

    const response = await r2Client.send(command);

    if (response.Contents) {
      for (const object of response.Contents) {
        if (object.Key && object.Size !== undefined) {
          objects.push({
            key: object.Key,
            size: object.Size,
          });
        }
      }
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return objects;
};

export const getObjectSize = async (key: string): Promise<number | null> => {
  try {
    const response = await r2Client.send(
      new HeadObjectCommand({
        Bucket: env.CLOUDFLARE_R2_BUCKET_NAME,
        Key: key,
      })
    );

    return response.ContentLength ?? null;
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
};

export const deleteObjectsByPrefix = async (
  prefix: string
): Promise<number> => {
  // Validate prefix to prevent accidental full-bucket deletions
  if (!prefix || prefix.trim().length === 0) {
    throw new Error(
      "Prefix cannot be empty or whitespace-only. This prevents accidental deletion of all objects in the bucket."
    );
  }

  const objects = await listObjectsByPrefix(prefix);
  let deletedCount = 0;

  // Delete in batches of 1000 (S3 limit)
  const batchSize = 1000;
  for (let i = 0; i < objects.length; i += batchSize) {
    const batch = objects.slice(i, i + batchSize);

    try {
      const response = await r2Client.send(
        new DeleteObjectsCommand({
          Bucket: env.CLOUDFLARE_R2_BUCKET_NAME,
          Delete: {
            Objects: batch.map((obj) => ({ Key: obj.key })),
          },
        })
      );

      // Handle errors from the response
      if (response.Errors && response.Errors.length > 0) {
        const failedKeys = response.Errors.map(
          (error) => error.Key ?? "unknown"
        );
        const errorDetails = response.Errors.map(
          (error) => `${error.Key ?? "unknown"}: ${error.Code ?? "unknown"} - ${error.Message ?? "no message"}`
        ).join("; ");

        throw new Error(
          `Failed to delete ${response.Errors.length} object(s) with prefix "${prefix}". Failed keys: ${failedKeys.join(", ")}. Error details: ${errorDetails}`
        );
      }

      // Update deletedCount based on successful deletions returned
      deletedCount += response.Deleted?.length ?? 0;
    } catch (error) {
      // Re-throw with context about which batch failed
      const batchStart = i;
      const batchEnd = Math.min(i + batchSize, objects.length);
      throw new Error(
        `Failed to delete objects batch (indices ${batchStart}-${batchEnd}) with prefix "${prefix}": ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }

  return deletedCount;
};

export const createSignedThumbnailUrl = async (
  key: string
): Promise<SignedDownloadUrl | null> => {
  const exists = await ensureObjectExists(key);
  if (!exists) {
    return null;
  }

  return createSignedDownloadUrl({
    key,
    responseContentType: "image/jpeg",
    downloadFilename: "thumbnail.jpg",
  });
};


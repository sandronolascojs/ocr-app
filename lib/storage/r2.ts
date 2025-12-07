import { createWriteStream, createReadStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  type GetObjectCommandInput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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

    if (isNotFoundName || isNotFoundCode || isNotFoundStatus) {
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

    if (isNotFoundName || isNotFoundCode || isNotFoundStatus) {
      return null;
    }
    throw error;
  }
};

export const deleteObjectsByPrefix = async (
  prefix: string
): Promise<number> => {
  const objects = await listObjectsByPrefix(prefix);
  let deletedCount = 0;

  // Delete in batches of 1000 (S3 limit)
  const batchSize = 1000;
  for (let i = 0; i < objects.length; i += batchSize) {
    const batch = objects.slice(i, i + batchSize);

    await r2Client.send(
      new DeleteObjectsCommand({
        Bucket: env.CLOUDFLARE_R2_BUCKET_NAME,
        Delete: {
          Objects: batch.map((obj) => ({ Key: obj.key })),
        },
      })
    );

    deletedCount += batch.length;
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


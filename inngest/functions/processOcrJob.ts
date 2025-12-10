import * as fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import archiver from "archiver";
import { Transform } from "node:stream";
import sharp from "sharp";
import unzipper from "unzipper";
import { inngest } from "@/inngest/client";
import { db } from "@/db";
import { ocrJobs, ocrJobFrames } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  compareImageFilenames,
  getBaseKeyFromFilename,
} from "@/lib/ocr/utils";
import { validateProcessableImageEntry } from "@/lib/ocr";
import {
  getJobRootDir,
  getJobRawDir,
  getJobNormalizedDir,
  getJobCropsDir,
  getJobTxtPath,
  getJobDocxPath,
  getJobBatchJsonlPath,
  getJobRawArchivePath,
  getJobZipPath,
  VOLUME_DIRS,
} from "@/lib/paths";
import { writeDocxFromParagraphs } from "@/lib/ocr/docx";
import { buildParagraphsFromFrames } from "@/lib/ocr/paragraphs";
import { JobsStatus } from "@/types";
import { JobStep } from "@/types/enums/jobs/jobStep.enum";
import { InngestEvents, OcrStepId, OcrSleepId } from "@/types/enums/inngest";
import { getUserOpenAIClient } from "@/lib/openai-user";
import type { OpenAI } from "openai";
import { InngestFunctions } from "@/types/enums/inngest/inngestFunctions.enum";
import { AI_CONSTANTS } from "@/constants/ai.constants";
import {
  getJobDocxKey,
  getJobRawArchiveKey,
  getJobTxtKey,
  getJobCropKey,
  getJobThumbnailKey,
  uploadFileToObject,
  uploadBufferToObject,
  uploadStreamToObject,
  createSignedDownloadUrlWithTtl,
  downloadObjectStream,
} from "@/lib/storage";

const BATCH_SLEEP_INTERVAL = "20s";

type ChatCompletionContentPart =
  | string
  | {
      type?: string;
      text?: string;
    };

type ChatCompletionContent = string | ChatCompletionContentPart[];

type CropMeta = {
  filename: string;
  cropKey: string;
  cropSignedUrl: string;
};

type ImageEntry = {
  entryName: string;
  buffer: Buffer;
  processable: {
    baseName: string;
    originalName: string;
    shouldIncludeInZip: boolean;
  };
};

type ProcessBatchResult = {
  cropsMeta: CropMeta[];
  processedCount: number;
  thumbnailKey: string | null;
  normalizedImageKeys: Array<{ name: string; key: string }>;
};

type WorkspacePaths = {
  jobRootDir: string;
  rawDir: string;
  normalizedDir: string;
  cropsDir: string;
  txtPath: string;
  docxPath: string;
  batchJsonlPath: string;
  zipPath: string;
  rawArchivePath: string;
};

type StorageKeys = {
  txtKey: string;
  docxKey: string;
  rawZipKey: string;
};

type StreamingArtifacts = {
  cropsMeta: CropMeta[];
  totalImages: number;
  rawZipKey: string | null;
  rawZipSizeBytes: number | null;
  thumbnailKey: string | null;
};

type BatchArtifacts = {
  batchId: string;
  batchInputFileId: string;
};

type PersistableFrame = {
  jobId: string;
  filename: string;
  baseKey: string;
  index: number;
  text: string;
};

type SleepFn = (id: string, duration: string) => Promise<void>;

const extractTextFromCompletion = (
  completion?: ChatCompletionContent
): string => {
  if (typeof completion === "string") {
    return completion.trim();
  }

  if (Array.isArray(completion)) {
    return completion
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (
          part &&
          typeof part === "object" &&
          "type" in part &&
          (part as { type?: string }).type === "text" &&
          "text" in part &&
          typeof (part as { text?: string }).text === "string"
        ) {
          return (part as { text: string }).text;
        }

        return "";
      })
      .join("")
      .trim();
  }

  return "";
};

const CROP_SIGNED_URL_TTL_SECONDS = 60 * 60 * 24; // 24 hours
const IMAGES_PER_BATCH = 50; // Process 50 images per step to avoid timeout

const normalizeBufferTo1280x720 = async (input: Buffer): Promise<Buffer> => {
  const image = sharp(input);
  const meta = await image.metadata();

  const targetW = 1280;
  const targetH = 720;
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  if (!width || !height) {
    return image.resize(targetW, targetH, { fit: "contain" }).png().toBuffer();
  }

  const aspect = width / height;
  const targetAspect = targetW / targetH;

  if (Math.abs(aspect - targetAspect) < 0.01) {
    return image.resize(targetW, targetH).png().toBuffer();
  }

  return image
    .resize(targetW, targetH, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    })
    .png()
    .toBuffer();
};

const cropSubtitleFromBuffer = async (
  normalizedBuffer: Buffer
): Promise<Buffer> => {
  const image = sharp(normalizedBuffer);
  const meta = await image.metadata();

  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  if (!width || !height) {
    return image.png().toBuffer();
  }

  const roiHeight = Math.floor(height * 0.32);
  const top = Math.max(0, height - roiHeight);

  return image
    .extract({ left: 0, top, width, height: roiHeight })
    .png()
    .toBuffer();
};

const createThumbnailFromBuffer = async (buffer: Buffer): Promise<Buffer> => {
  return sharp(buffer)
    .resize(200, 200, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
};

const extractImageEntryNames = async (zipKey: string): Promise<
  Array<{
    entryName: string;
    processable: {
      baseName: string;
      originalName: string;
      shouldIncludeInZip: boolean;
    };
  }>
> => {
  const zipReadable = await downloadObjectStream(zipKey);
  const unzipStream = zipReadable.pipe(unzipper.Parse({ forceStream: true }));

  const entries: Array<{
    entryName: string;
    processable: {
      baseName: string;
      originalName: string;
      shouldIncludeInZip: boolean;
    };
  }> = [];

  for await (const entry of unzipStream) {
    if (entry.type === "Directory") {
      entry.autodrain();
      continue;
    }

    const entryName = entry.path;
    const processable = validateProcessableImageEntry(entryName);
    if (!processable) {
      entry.autodrain();
      continue;
    }

    entries.push({
      entryName,
      processable,
    });
    entry.autodrain(); // Drain to avoid memory issues
  }

  return entries;
};

const processImageBatchFromZip = async ({
  jobId,
  zipKey,
  batchEntryNames,
  batchIndex,
  storageKeys,
}: {
  jobId: string;
  zipKey: string;
  batchEntryNames: Array<{
    entryName: string;
    processable: {
      baseName: string;
      originalName: string;
      shouldIncludeInZip: boolean;
    };
  }>;
  batchIndex: number;
  storageKeys: StorageKeys;
}): Promise<ProcessBatchResult> => {
  // Re-download and extract only the needed entries
  const zipReadable = await downloadObjectStream(zipKey);
  const unzipStream = zipReadable.pipe(unzipper.Parse({ forceStream: true }));

  const entryNameSet = new Set(batchEntryNames.map((e) => e.entryName));
  const cropsMeta: CropMeta[] = [];
  const normalizedImageKeys: Array<{ name: string; key: string }> = [];
  let thumbnailKey: string | null = null;

  for await (const entry of unzipStream) {
    if (entry.type === "Directory") {
      entry.autodrain();
      continue;
    }

    if (!entryNameSet.has(entry.path)) {
      entry.autodrain();
      continue;
    }

    const entryInfo = batchEntryNames.find((e) => e.entryName === entry.path);
    if (!entryInfo) {
      entry.autodrain();
      continue;
    }

    const fileBuffer = await entry.buffer();
    const normalizedBuffer = await normalizeBufferTo1280x720(fileBuffer);
    const cropBuffer = await cropSubtitleFromBuffer(normalizedBuffer);

    // Only include base images (1, 2, 3, etc.) in the final ZIP
    // Upload normalized image to temporary storage for ZIP creation later
    if (entryInfo.processable.shouldIncludeInZip) {
      const zipFilename = `${entryInfo.processable.baseName}.png`;
      const normalizedKey = `${storageKeys.rawZipKey}-temp-${zipFilename}`;
      await uploadBufferToObject({
        key: normalizedKey,
        body: normalizedBuffer,
        contentType: "image/png",
      });
      normalizedImageKeys.push({
        name: zipFilename,
        key: normalizedKey,
      });
    }

    // Create crop for ALL images (including 1.1, 1.2, etc.) for OCR processing
    const cropFilename = entryInfo.processable.originalName.replace(
      /\.(png|jpe?g)$/i,
      ".png"
    );
    const cropKey = getJobCropKey(jobId, cropFilename);
    await uploadBufferToObject({
      key: cropKey,
      body: cropBuffer,
      contentType: "image/png",
    });

    const signedCropUrl = await createSignedDownloadUrlWithTtl({
      key: cropKey,
      responseContentType: "image/png",
      downloadFilename: cropFilename,
      ttlSeconds: CROP_SIGNED_URL_TTL_SECONDS,
    });

    cropsMeta.push({
      filename: cropFilename,
      cropKey,
      cropSignedUrl: signedCropUrl.url,
    });

    // Only create thumbnail from first batch, first image
    if (!thumbnailKey && batchIndex === 0 && cropsMeta.length === 1) {
      const thumbnailBuffer = await createThumbnailFromBuffer(normalizedBuffer);
      const thumbKey = getJobThumbnailKey(jobId);
      await uploadBufferToObject({
        key: thumbKey,
        body: thumbnailBuffer,
        contentType: "image/jpeg",
        cacheControl: "public, max-age=31536000, immutable",
      });
      thumbnailKey = thumbKey;
    }
  }

  return {
    cropsMeta,
    processedCount: batchEntryNames.length,
    thumbnailKey,
    normalizedImageKeys,
  };
};


const createFinalZip = async ({
  normalizedImageKeys,
  storageKeys,
}: {
  normalizedImageKeys: Array<{ name: string; key: string }>;
  storageKeys: StorageKeys;
}): Promise<{ rawZipKey: string | null; rawZipSizeBytes: number | null }> => {
  if (!normalizedImageKeys.length) {
    return { rawZipKey: null, rawZipSizeBytes: null };
  }

  const archive = archiver("zip", { zlib: { level: 9 } });
  let filteredZipSizeBytes = 0;
  const sizeCounter = new Transform({
    transform(chunk, _encoding, callback) {
      filteredZipSizeBytes += chunk.length;
      callback(null, chunk);
    },
  });

  const archiveOutput = archive.pipe(sizeCounter);
  const filteredZipUploadPromise = uploadStreamToObject({
    key: storageKeys.rawZipKey,
    stream: archiveOutput,
    contentType: "application/zip",
  });

  // Sort zip entries by filename to ensure consistent ordering
  const sortedImageKeys = [...normalizedImageKeys].sort((a, b) => {
    const comparison = compareImageFilenames(a.name, b.name);
    if (comparison !== 0) {
      return comparison;
    }
    return a.name.localeCompare(b.name);
  });

  // Download each normalized image and add to ZIP
  for (const imageKey of sortedImageKeys) {
    const imageStream = await downloadObjectStream(imageKey.key);
    archive.append(imageStream, { name: imageKey.name });
  }

  await archive.finalize();
  await filteredZipUploadPromise;

  return {
    rawZipKey: storageKeys.rawZipKey,
    rawZipSizeBytes: filteredZipSizeBytes,
  };
};

const createBatchArtifacts = async ({
  jobId,
  cropsMeta,
  paths,
  openai,
}: {
  jobId: string;
  cropsMeta: CropMeta[];
  paths: WorkspacePaths;
  openai: OpenAI;
}): Promise<BatchArtifacts> => {
  if (!cropsMeta.length) {
    throw new Error(
      `No crops found for job ${jobId} when creating Batch artifacts.`
    );
  }

  const jsonlStream = fsSync.createWriteStream(paths.batchJsonlPath, {
    encoding: "utf8",
  });

  // Register error handler immediately to catch errors from write() calls
  const streamPromise = new Promise<void>((resolve, reject) => {
    jsonlStream.on("error", (err) => reject(err));
    jsonlStream.on("finish", () => resolve());
  });

  // Write all lines
  for (let index = 0; index < cropsMeta.length; index++) {
    const { filename, cropSignedUrl } = cropsMeta[index];
    const customId = `job-${jobId}-frame-${index}-${filename}`;

    const line = {
      custom_id: customId,
      method: "POST",
      url: "/v1/chat/completions",
      body: {
        model: AI_CONSTANTS.MODELS.OPENAI,
        temperature: 0,
        max_tokens: 96,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: AI_CONSTANTS.PROMPTS.OCR },
              {
                type: "image_url",
                image_url: { url: cropSignedUrl },
              },
            ],
          },
        ],
      },
    };

    jsonlStream.write(JSON.stringify(line) + "\n");
  }

  jsonlStream.end();
  await streamPromise;

  const inputFile = await openai.files.create({
    file: fsSync.createReadStream(paths.batchJsonlPath),
    purpose: "batch",
  });

  const batch = await openai.batches.create({
    input_file_id: inputFile.id,
    endpoint: "/v1/chat/completions",
    completion_window: "24h",
  });

  await db
    .update(ocrJobs)
    .set({
      batchId: batch.id,
      batchInputFileId: inputFile.id,
    })
    .where(eq(ocrJobs.jobId, jobId));

  return {
    batchId: batch.id,
    batchInputFileId: inputFile.id,
  };
};

const waitForBatchCompletion = async ({
  jobId,
  batchId,
  sleep,
  openai,
}: {
  jobId: string;
  batchId: string;
  sleep: SleepFn;
  openai: OpenAI;
}): Promise<string> => {
  let attempt = 0;
  while (true) {
    const latestBatch = await openai.batches.retrieve(batchId);

    if (
      latestBatch.status === "completed" &&
      latestBatch.output_file_id
    ) {
      return latestBatch.output_file_id as string;
    }

    if (
      latestBatch.status === "failed" ||
      latestBatch.status === "cancelled"
    ) {
      throw new Error(`Batch failed with status=${latestBatch.status}`);
    }

    await sleep(
      `${OcrSleepId.WaitBatchCompletion}-${jobId}-${attempt}`,
      BATCH_SLEEP_INTERVAL
    );
    attempt += 1;
  }
};

const saveBatchResults = async ({
  jobId,
  batchOutputFileId,
  totalImages,
  openai,
}: {
  jobId: string;
  batchOutputFileId: string;
  totalImages: number;
  openai: OpenAI;
}) => {
  const outputStream = await openai.files.content(batchOutputFileId);
  const outputBuffer = Buffer.from(await outputStream.arrayBuffer());
  const outputJsonl = outputBuffer.toString("utf8");

  const lines = outputJsonl
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (!lines.length) {
    throw new Error("Batch output file is empty.");
  }

  if (totalImages > 0 && lines.length !== totalImages) {
    throw new Error(
      `Batch output mismatch: expected ${totalImages} responses but got ${lines.length}.`
    );
  }

  const framesToPersist: PersistableFrame[] = [];

  for (const line of lines) {
    let parsed: {
      custom_id?: string;
      error?: { message?: string; code?: string };
      response?: {
        body?: {
          choices?: Array<{
            message?: { content?: ChatCompletionContent };
          }>;
        };
      };
    };

    try {
      parsed = JSON.parse(line) as {
        custom_id?: string;
        error?: { message?: string; code?: string };
        response?: {
          body?: {
            choices?: Array<{
              message?: { content?: ChatCompletionContent };
            }>;
          };
        };
      };
    } catch (error) {
      throw new Error(
        `Invalid JSON line in batch output: ${(error as Error).message}`
      );
    }

    if (parsed.error) {
      const message =
        parsed.error?.message ??
        parsed.error?.code ??
        "Unknown OpenAI batch error";
      throw new Error(
        `OpenAI batch entry failed (${parsed.custom_id ?? "unknown"}): ${message}`
      );
    }

    const customId = parsed.custom_id;
    if (!customId) {
      continue;
    }

    const match = customId.match(/^job-(.+)-frame-(\d+)-(.+)$/);
    if (!match) {
      continue;
    }

    const [, , indexAsString, filename] = match;
    const index = Number.parseInt(indexAsString, 10);
    if (Number.isNaN(index)) {
      continue;
    }

    const completion =
      parsed.response?.body?.choices?.[0]?.message?.content;
    const text = extractTextFromCompletion(completion);

    if (!text || text === "<EMPTY>") {
      continue;
    }

    framesToPersist.push({
      jobId,
      filename,
      baseKey: getBaseKeyFromFilename(filename),
      index,
      text,
    });
  }

  if (!framesToPersist.length) {
    throw new Error("No OCR frames were parsed from the batch output.");
  }

  await db.delete(ocrJobFrames).where(eq(ocrJobFrames.jobId, jobId));
  await db.insert(ocrJobFrames).values(framesToPersist);

  await db
    .update(ocrJobs)
    .set({ step: JobStep.DOCS_BUILT })
    .where(eq(ocrJobs.jobId, jobId));
};

const buildDocuments = async ({
  jobId,
  paths,
  storageKeys,
}: {
  jobId: string;
  paths: WorkspacePaths;
  storageKeys: StorageKeys;
}): Promise<string | null> => {
  const frames = await db
    .select()
    .from(ocrJobFrames)
    .where(eq(ocrJobFrames.jobId, jobId));

  const paragraphs = buildParagraphsFromFrames(frames);
  if (!paragraphs.length) {
    throw new Error("Unable to build OCR paragraphs for this job.");
  }

  const paragraphsWithBlankLine = paragraphs.flatMap((paragraph, index) =>
    index < paragraphs.length - 1 ? [paragraph, ""] : [paragraph]
  );

  const txtContent = paragraphsWithBlankLine.join("\n");

  await fs.writeFile(paths.txtPath, txtContent, "utf8");
  await writeDocxFromParagraphs(paragraphs, paths.docxPath);

  // Calculate file sizes before uploading
  const txtStats = fsSync.statSync(paths.txtPath);
  const docxStats = fsSync.statSync(paths.docxPath);

  await uploadFileToObject({
    key: storageKeys.txtKey,
    filePath: paths.txtPath,
    contentType: "text/plain; charset=utf-8",
  });

  await uploadFileToObject({
    key: storageKeys.docxKey,
    filePath: paths.docxPath,
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });

  // Update job with documents info
  await db
    .update(ocrJobs)
    .set({
      status: JobsStatus.DONE,
      txtPath: storageKeys.txtKey,
      docxPath: storageKeys.docxKey,
      txtSizeBytes: txtStats.size,
      docxSizeBytes: docxStats.size,
    })
    .where(eq(ocrJobs.jobId, jobId));

  const dirsToRemove = [paths.rawDir, paths.normalizedDir, paths.cropsDir];
  const filesToRemove = [
    paths.zipPath,
    paths.batchJsonlPath,
    paths.txtPath,
    paths.docxPath,
    paths.rawArchivePath,
  ];

  for (const file of filesToRemove) {
    try {
      await fs.unlink(file);
    } catch {
      // ignore
    }
  }

  for (const dir of dirsToRemove) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  // Return raw zip key (already saved in DB earlier, use storage key)
  return storageKeys.rawZipKey;
};

const buildWorkspacePaths = (jobId: string): WorkspacePaths => ({
  jobRootDir: getJobRootDir(jobId),
  rawDir: getJobRawDir(jobId),
  normalizedDir: getJobNormalizedDir(jobId),
  cropsDir: getJobCropsDir(jobId),
  txtPath: getJobTxtPath(jobId),
  docxPath: getJobDocxPath(jobId),
  batchJsonlPath: getJobBatchJsonlPath(jobId),
  zipPath: getJobZipPath(jobId),
  rawArchivePath: getJobRawArchivePath(jobId),
});

const buildStorageKeys = (jobId: string): StorageKeys => ({
  txtKey: getJobTxtKey(jobId),
  docxKey: getJobDocxKey(jobId),
  rawZipKey: getJobRawArchiveKey(jobId),
});

const ensureWorkspaceLayout = async (paths: WorkspacePaths) => {
  await fs.mkdir(paths.jobRootDir, { recursive: true });
  await fs.mkdir(paths.rawDir, { recursive: true });
  await fs.mkdir(paths.normalizedDir, { recursive: true });
  await fs.mkdir(paths.cropsDir, { recursive: true });
  await fs.mkdir(VOLUME_DIRS.txtBase, { recursive: true });
  await fs.mkdir(VOLUME_DIRS.wordBase, { recursive: true });
  await fs.mkdir(VOLUME_DIRS.tmpBase, { recursive: true });
};

export const processOcrJob = inngest.createFunction(
  {
    id: InngestFunctions.PROCESS_OCR_JOB,
  },
  { event: InngestEvents.ZIP_UPLOADED },
  async ({ event, step }): Promise<{
    jobId: string;
    txtKey: string;
    docxKey: string;
    rawZipKey: string | null;
  }> => {
    const { jobId, zipKey, userId } = event.data as {
      jobId: string;
      zipKey: string;
      userId: string;
    };

    if (!userId) {
      console.error("UserId missing in event data", event.data);
      
      try {
        await db
          .update(ocrJobs)
          .set({
            status: JobsStatus.ERROR,
            error: "UserId missing in event data",
          })
          .where(eq(ocrJobs.jobId, jobId));
      } catch (updateError) {
        console.error(
          `Failed to update job ${jobId} to ERROR state:`,
          updateError
        );
      }
      
      return { jobId, txtKey: "", docxKey: "", rawZipKey: null };
    }

    try {
      // Get user's OpenAI client
      const openai = await getUserOpenAIClient(userId);

      const [job] = await db
        .select()
        .from(ocrJobs)
        .where(eq(ocrJobs.jobId, jobId))
        .limit(1);

      if (!job) {
        console.error("Job not found", jobId);
        return { jobId, txtKey: "", docxKey: "", rawZipKey: null };
      }

      const storageZipKey = zipKey ?? job.zipPath;
      if (!storageZipKey) {
        console.error("Zip key missing for job", jobId);
        return { jobId, txtKey: "", docxKey: "", rawZipKey: null };
      }

      // Estado actual en memoria (se irá actualizando manualmente)
      let currentStep: JobStep = job.step ?? JobStep.PREPROCESSING;
      let totalImages = job.totalImages ?? 0;
      let batchId = job.batchId ?? null;
      let batchInputFileId = job.batchInputFileId ?? null;
      let batchOutputFileId = job.batchOutputFileId ?? null;

      const workspacePaths = buildWorkspacePaths(jobId);
      const storageKeys = buildStorageKeys(jobId);
      let rawZipKeyForJob: string | null = job.rawZipPath ?? null;

      await ensureWorkspaceLayout(workspacePaths);

      // Step 1: Extract all image entry names (quick operation, no buffers)
      const imageEntryNames = await step.run(
        `${OcrStepId.PreprocessImagesAndCrops}-extract`,
        () => extractImageEntryNames(storageZipKey)
      );

      if (!imageEntryNames.length) {
        throw new Error("No valid images found in the ZIP file.");
      }

      // Step 2: Process images in batches to avoid timeout
      const allCropsMeta: CropMeta[] = [];
      const allNormalizedImageKeys: Array<{ name: string; key: string }> = [];
      let thumbnailKey: string | null = null;

      type EntryNameType = {
        entryName: string;
        processable: {
          baseName: string;
          originalName: string;
          shouldIncludeInZip: boolean;
        };
      };

      const batches: EntryNameType[][] = [];
      for (let i = 0; i < imageEntryNames.length; i += IMAGES_PER_BATCH) {
        batches.push(imageEntryNames.slice(i, i + IMAGES_PER_BATCH));
      }

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch: EntryNameType[] = batches[batchIndex];
        const batchResult = await step.run(
          `${OcrStepId.ProcessImageBatch}-${batchIndex}`,
          () =>
            processImageBatchFromZip({
              jobId,
              zipKey: storageZipKey,
              batchEntryNames: batch,
              batchIndex,
              storageKeys,
            })
        );

        allCropsMeta.push(...batchResult.cropsMeta);
        allNormalizedImageKeys.push(...batchResult.normalizedImageKeys);

        if (batchResult.thumbnailKey && !thumbnailKey) {
          thumbnailKey = batchResult.thumbnailKey;
        }

        // Update progress in database
        const currentProcessed = allCropsMeta.length;
        await db
          .update(ocrJobs)
          .set({
            processedImages: currentProcessed,
            totalImages: imageEntryNames.length,
            status: JobsStatus.PROCESSING,
          })
          .where(eq(ocrJobs.jobId, jobId));
      }

      // Step 3: Create final ZIP from all processed images
      const zipResult = await step.run(
        `${OcrStepId.PreprocessImagesAndCrops}-create-zip`,
        () =>
          createFinalZip({
            normalizedImageKeys: allNormalizedImageKeys,
            storageKeys,
          })
      );

      // Sort cropsMeta by filename
      const sortedCrops = [...allCropsMeta].sort((a, b) => {
        const comparison = compareImageFilenames(a.filename, b.filename);
        if (comparison !== 0) {
          return comparison;
        }
        return a.filename.localeCompare(b.filename);
      });

      totalImages = allCropsMeta.length;
      rawZipKeyForJob = zipResult.rawZipKey;

      await db
        .update(ocrJobs)
        .set({
          rawZipPath: zipResult.rawZipKey,
          rawZipSizeBytes: zipResult.rawZipSizeBytes,
          thumbnailKey,
          step: JobStep.BATCH_SUBMITTED,
          totalImages,
          processedImages: totalImages,
          status: JobsStatus.PROCESSING,
        })
        .where(eq(ocrJobs.jobId, jobId));

      const cropsMeta: CropMeta[] = sortedCrops;
      if (!cropsMeta.length) {
        throw new Error("No crops were generated from the provided ZIP file.");
      }
      currentStep = JobStep.BATCH_SUBMITTED;

      if (currentStep === JobStep.BATCH_SUBMITTED) {
        if (!batchId || !batchInputFileId) {
          const artifacts = await step.run(
            OcrStepId.CreateAndAwaitBatch,
            () =>
              createBatchArtifacts({
                jobId,
                cropsMeta,
                paths: workspacePaths,
                openai,
              })
          );
          batchId = artifacts.batchId;
          batchInputFileId = artifacts.batchInputFileId;
        }

        if (!batchId) {
          throw new Error("Batch ID missing after creation.");
        }

        batchOutputFileId = await waitForBatchCompletion({
          jobId,
          batchId,
          sleep: step.sleep,
          openai,
        });

        await db
          .update(ocrJobs)
          .set({
            batchOutputFileId,
            step: JobStep.RESULTS_SAVED,
          })
          .where(eq(ocrJobs.jobId, jobId));

        currentStep = JobStep.RESULTS_SAVED;
      }

      if (!batchOutputFileId) {
        batchOutputFileId = job.batchOutputFileId ?? null;
      }

      if (currentStep === JobStep.RESULTS_SAVED) {
        if (!batchOutputFileId) {
          throw new Error("Batch output file id missing");
        }

        await step.run(OcrStepId.SaveResultsToDb, () =>
          saveBatchResults({
            jobId,
            batchOutputFileId,
            totalImages,
            openai,
          })
        );

        currentStep = JobStep.DOCS_BUILT;
      }

      if (currentStep === JobStep.DOCS_BUILT) {
        rawZipKeyForJob = await step.run(OcrStepId.BuildDocsAndCleanup, () =>
          buildDocuments({
            jobId,
            paths: workspacePaths,
            storageKeys,
          })
        );

        // Ensure the job reflects the final step in case any prior update was skipped
        await db
          .update(ocrJobs)
          .set({
            step: JobStep.DOCS_BUILT,
            status: JobsStatus.DONE,
          })
          .where(eq(ocrJobs.jobId, jobId));
      }

      return {
        jobId,
        txtKey: storageKeys.txtKey,
        docxKey: storageKeys.docxKey,
        rawZipKey: rawZipKeyForJob,
      };
    } catch (err) {
      console.error("processOcrJob failed", jobId, err);

      const errorMessage =
        err instanceof Error ? err.message : "Unknown error in OCR job";

      // Guardar error y marcar job como ERROR; el retry lo relanza desde el step que quedó
      await db
        .update(ocrJobs)
        .set({
          status: JobsStatus.ERROR,
          error: errorMessage,
        })
        .where(eq(ocrJobs.jobId, jobId));

      throw err;
    }
  }
);
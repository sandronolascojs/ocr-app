import * as fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { inngest } from "@/inngest/client";
import { db } from "@/db";
import { ocrJobs, ocrJobFrames } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  compareImageFilenames,
  extractImagesFromZip,
  normalizeTo1280x720,
  cropSubtitleToFile,
  imageFileToDataUrl,
  getBaseKeyFromFilename,
} from "@/lib/ocr/utils";
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
import { openai } from "@/lib/openai";
import { InngestFunctions } from "@/types/enums/inngest/inngestFunctions.enum";
import { AI_CONSTANTS } from "@/constants/ai.constants";
import {
  downloadObjectToFile,
  getJobDocxKey,
  getJobRawArchiveKey,
  getJobTxtKey,
  uploadFileToObject,
} from "@/lib/storage";

const BATCH_SLEEP_INTERVAL = "60s";

type ChatCompletionContentPart =
  | string
  | {
      type?: string;
      text?: string;
    };

type ChatCompletionContent = string | ChatCompletionContentPart[];

type CropMeta = {
  filename: string;
  cropPath: string;
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

const preprocessJob = async ({
  jobId,
  paths,
}: {
  jobId: string;
  paths: WorkspacePaths;
}): Promise<{ cropsMeta: CropMeta[]; totalImages: number }> => {
  await fs.rm(paths.rawDir, { recursive: true, force: true });
  await fs.rm(paths.normalizedDir, { recursive: true, force: true });
  await fs.rm(paths.cropsDir, { recursive: true, force: true });

  await fs.mkdir(paths.rawDir, { recursive: true });
  await fs.mkdir(paths.normalizedDir, { recursive: true });
  await fs.mkdir(paths.cropsDir, { recursive: true });

  const imagePaths = await extractImagesFromZip(paths.zipPath, paths.rawDir);
  await db
    .update(ocrJobs)
    .set({
      status: JobsStatus.PROCESSING,
      totalImages: imagePaths.length,
      processedImages: 0,
    })
    .where(eq(ocrJobs.jobId, jobId));

  const normalizedPaths: string[] = [];
  for (const sourcePath of imagePaths) {
    const normalizedPath = path.join(
      paths.normalizedDir,
      path.basename(sourcePath)
    );
    await normalizeTo1280x720(sourcePath, normalizedPath);
    normalizedPaths.push(normalizedPath);
  }

  const sortedNormalized = [...normalizedPaths].sort((a, b) => {
    const comparison = compareImageFilenames(
      path.basename(a),
      path.basename(b)
    );
    if (comparison !== 0) {
      return comparison;
    }
    return a.localeCompare(b);
  });

  const cropsMeta: CropMeta[] = [];
  let processedImages = 0;

  for (const normalizedPath of sortedNormalized) {
    const filename = path.basename(normalizedPath);
    const cropPath = path.join(
      paths.cropsDir,
      filename.replace(/\.[^.]+$/, ".png")
    );

    await cropSubtitleToFile(normalizedPath, cropPath);
    cropsMeta.push({ filename, cropPath });

    processedImages += 1;
    await db
      .update(ocrJobs)
      .set({ processedImages })
      .where(eq(ocrJobs.jobId, jobId));
  }

  await db
    .update(ocrJobs)
    .set({ step: JobStep.BATCH_SUBMITTED })
    .where(eq(ocrJobs.jobId, jobId));

  return { cropsMeta, totalImages: imagePaths.length };
};

const createBatchArtifacts = async ({
  jobId,
  cropsMeta,
  paths,
}: {
  jobId: string;
  cropsMeta: CropMeta[];
  paths: WorkspacePaths;
}): Promise<BatchArtifacts> => {
  if (!cropsMeta.length) {
    throw new Error(
      `No crops found for job ${jobId} when creating Batch artifacts.`
    );
  }

  const jsonlStream = fsSync.createWriteStream(paths.batchJsonlPath, {
    encoding: "utf8",
  });

  for (let index = 0; index < cropsMeta.length; index++) {
    const { filename, cropPath } = cropsMeta[index];
    const dataUrl = await imageFileToDataUrl(cropPath);
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
                image_url: { url: dataUrl },
              },
            ],
          },
        ],
      },
    };

    jsonlStream.write(JSON.stringify(line) + "\n");
  }

  await new Promise<void>((resolve, reject) => {
    jsonlStream.end(() => resolve());
    jsonlStream.on("error", (err) => reject(err));
  });

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
}: {
  jobId: string;
  batchId: string;
  sleep: SleepFn;
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
}: {
  jobId: string;
  batchOutputFileId: string;
  totalImages: number;
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

  const listRawImages = async (): Promise<string[]> => {
    try {
      const files = await fs.readdir(paths.rawDir);
      return files.filter((file) => /\.(png|jpe?g)$/i.test(file));
    } catch {
      return [];
    }
  };

  const pruneDecimalVariants = async () => {
    const rawImages = await listRawImages();
    if (!rawImages.length) {
      return;
    }

    const integerNameRegex = /^\d+$/;
    const decimalVariantRegex = /^(\d+)\.(\d+)$/;
    const baseNames = new Set(
      rawImages
        .map((filename) => filename.replace(/\.[^.]+$/, ""))
        .filter((name) => integerNameRegex.test(name))
    );

    const variants = rawImages.filter((filename) => {
      const name = filename.replace(/\.[^.]+$/, "");
      const match = name.match(decimalVariantRegex);
      return Boolean(match && baseNames.has(match[1]));
    });

    await Promise.all(
      variants.map((variant) =>
        fs.unlink(path.join(paths.rawDir, variant)).catch(() => undefined)
      )
    );
  };

  await pruneDecimalVariants();

  const filteredRawImages = await listRawImages();
  let rawZipKey: string | null = storageKeys.rawZipKey;

  if (filteredRawImages.length) {
    const archive = new AdmZip();
    filteredRawImages
      .sort((a, b) => compareImageFilenames(a, b))
      .forEach((filename) => {
        archive.addLocalFile(path.join(paths.rawDir, filename), "", filename);
      });
    await fs.mkdir(path.dirname(paths.rawArchivePath), { recursive: true });
    await archive.writeZipPromise(paths.rawArchivePath);
    await uploadFileToObject({
      key: storageKeys.rawZipKey,
      filePath: paths.rawArchivePath,
      contentType: "application/zip",
    });
  } else {
    await fs.rm(paths.rawArchivePath, { force: true });
    rawZipKey = null;
  }

  await db
    .update(ocrJobs)
    .set({
      status: JobsStatus.DONE,
      txtPath: storageKeys.txtKey,
      docxPath: storageKeys.docxKey,
      rawZipPath: rawZipKey,
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

  return rawZipKey;
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

const loadCropsFromDisk = async (cropsDir: string): Promise<CropMeta[]> => {
  try {
    const files = await fs.readdir(cropsDir);
    return files
      .filter((file) => /\.(png)$/i.test(file))
      .sort((a, b) => {
        const comparison = compareImageFilenames(a, b);
        if (comparison !== 0) {
          return comparison;
        }
        return a.localeCompare(b);
      })
      .map((filename) => ({
        filename,
        cropPath: path.join(cropsDir, filename),
      }));
  } catch {
    return [];
  }
};

export const processOcrJob = inngest.createFunction(
  { id: InngestFunctions.PROCESS_OCR_JOB },
  { event: InngestEvents.ZIP_UPLOADED },
  async ({ event, step }): Promise<{
    jobId: string;
    txtKey: string;
    docxKey: string;
    rawZipKey: string | null;
  }> => {
    const { jobId, zipKey } = event.data as { jobId: string; zipKey: string };

    try {
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
      await downloadObjectToFile({
        key: storageZipKey,
        filePath: workspacePaths.zipPath,
      });

      let cropsMeta: CropMeta[] = [];
      if (currentStep === JobStep.PREPROCESSING) {
        const { cropsMeta: processedCrops, totalImages: processedTotal } =
          await step.run(OcrStepId.PreprocessImagesAndCrops, () =>
            preprocessJob({ jobId, paths: workspacePaths })
          );
        cropsMeta = processedCrops;
        totalImages = processedTotal;
        currentStep = JobStep.BATCH_SUBMITTED;
      } else {
        cropsMeta = await loadCropsFromDisk(workspacePaths.cropsDir);
      }

      if (currentStep === JobStep.BATCH_SUBMITTED) {
        if (!batchId || !batchInputFileId) {
          const artifacts = await step.run(
            OcrStepId.CreateAndAwaitBatch,
            () =>
              createBatchArtifacts({
                jobId,
                cropsMeta,
                paths: workspacePaths,
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
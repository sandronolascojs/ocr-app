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
  VOLUME_DIRS,
} from "@/lib/paths";
import { writeDocxFromParagraphs } from "@/lib/ocr/docx";
import { buildParagraphsFromFrames } from "@/lib/ocr/paragraphs";
import { JobsStatus } from "@/types";
import { JobStep } from "@/types/enums/jobs/jobStep.enum";
import { InngestEvents, OcrStepId } from "@/types/enums/inngest";
import { openai } from "@/lib/openai";
import { InngestFunctions } from "@/types/enums/inngest/inngestFunctions.enum";
import { AI_CONSTANTS } from "@/constants/ai.constants";

// Pequeño helper para esperar sin usar step.sleep (simple y suficiente en local)
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type ChatCompletionContentPart =
  | string
  | {
      type?: string;
      text?: string;
    };

type ChatCompletionContent = string | ChatCompletionContentPart[];

type BatchOutputLine = {
  custom_id?: string;
  error?: {
    message?: string;
    code?: string;
  };
  response?: {
    body?: {
      choices?: Array<{
        message?: {
          content?: ChatCompletionContent;
        };
      }>;
    };
  };
};

type PersistableFrame = {
  jobId: string;
  filename: string;
  baseKey: string;
  index: number;
  text: string;
};

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

export const processOcrJob = inngest.createFunction(
  { id: InngestFunctions.PROCESS_OCR_JOB },
  { event: InngestEvents.ZIP_UPLOADED },
  async ({ event, step }) => {
    const { jobId, zipPath } = event.data as { jobId: string; zipPath: string };

    try {
      // ------------------------------------------------------------------
      // CARGAR JOB
      // ------------------------------------------------------------------
      const [job] = await db
        .select()
        .from(ocrJobs)
        .where(eq(ocrJobs.jobId, jobId))
        .limit(1);

      if (!job) {
        console.error("Job not found", jobId);
        return;
      }

      // Estado actual en memoria (se irá actualizando manualmente)
      let currentStep: JobStep =
        (job.step as JobStep | null) ?? JobStep.PREPROCESSING;
      let totalImages = job.totalImages ?? 0;

      const jobRootDir = getJobRootDir(jobId);
      const rawDir = getJobRawDir(jobId);
      const normalizedDir = getJobNormalizedDir(jobId);
      const cropsDir = getJobCropsDir(jobId);
      const batchJsonlPath = getJobBatchJsonlPath(jobId);
      const txtPath = getJobTxtPath(jobId);
      const docxPath = getJobDocxPath(jobId);
      const rawArchivePath = getJobRawArchivePath(jobId);
      let rawZipPath: string | null = null;

      // Asegurar estructura de directorios
      await fs.mkdir(jobRootDir, { recursive: true });
      await fs.mkdir(rawDir, { recursive: true });
      await fs.mkdir(normalizedDir, { recursive: true });
      await fs.mkdir(cropsDir, { recursive: true });
      await fs.mkdir(VOLUME_DIRS.txtBase, { recursive: true });
      await fs.mkdir(VOLUME_DIRS.wordBase, { recursive: true });
      await fs.mkdir(VOLUME_DIRS.tmpBase, { recursive: true });

      // ------------------------------------------------------------------
      // STEP 1: PREPROCESSING  (unzip → normalize → crops)
      // ------------------------------------------------------------------
      let cropsMeta: { filename: string; cropPath: string }[] = [];

      if (currentStep === JobStep.PREPROCESSING) {
        cropsMeta = await step.run(
          OcrStepId.PreprocessImagesAndCrops,
          async () => {
            // Limpieza por si venía de un retry
            await fs.rm(rawDir, { recursive: true, force: true });
            await fs.rm(normalizedDir, { recursive: true, force: true });
            await fs.rm(cropsDir, { recursive: true, force: true });

            await fs.mkdir(rawDir, { recursive: true });
            await fs.mkdir(normalizedDir, { recursive: true });
            await fs.mkdir(cropsDir, { recursive: true });

            const imagePaths = await extractImagesFromZip(zipPath, rawDir);
            totalImages = imagePaths.length;

            await db
              .update(ocrJobs)
              .set({
                status: JobsStatus.PROCESSING,
                totalImages: imagePaths.length,
                processedImages: 0,
              })
              .where(eq(ocrJobs.jobId, jobId));

            const normalizedPaths: string[] = [];

            for (const src of imagePaths) {
              const out = path.join(normalizedDir, path.basename(src));
              await normalizeTo1280x720(src, out);
              normalizedPaths.push(out);
            }

            type CropInfo = { filename: string; cropPath: string };
            const crops: CropInfo[] = [];
            let processed = 0;

            const sortedNormalized = [...normalizedPaths].sort((a, b) => {
              const filenameCompare = compareImageFilenames(
                path.basename(a),
                path.basename(b)
              );
              if (filenameCompare !== 0) {
                return filenameCompare;
              }
              return a.localeCompare(b);
            });

            for (const norm of sortedNormalized) {
              const filename = path.basename(norm);
              const cropOut = path.join(
                cropsDir,
                filename.replace(/\.[^.]+$/, ".png")
              );

              await cropSubtitleToFile(norm, cropOut);
              crops.push({ filename, cropPath: cropOut });

              processed++;
              await db
                .update(ocrJobs)
                .set({ processedImages: processed })
                .where(eq(ocrJobs.jobId, jobId));
            }

            // Actualizar DB al siguiente step
            await db
              .update(ocrJobs)
              .set({ step: JobStep.BATCH_SUBMITTED })
              .where(eq(ocrJobs.jobId, jobId));

            return crops;
          }
        );

        // Muy importante: actualizar también el estado en memoria
        currentStep = JobStep.BATCH_SUBMITTED;
      } else {
        // Si venimos de un retry en un step siguiente, reconstruimos crops desde disco
        try {
          const files = await fs.readdir(cropsDir);
          cropsMeta = files
            .filter((f) => /\.(png)$/i.test(f))
            .sort((a, b) => {
              const filenameCompare = compareImageFilenames(a, b);
              if (filenameCompare !== 0) {
                return filenameCompare;
              }
              return a.localeCompare(b);
            })
            .map((f) => ({
              filename: f,
              cropPath: path.join(cropsDir, f),
            }));
        } catch {
          cropsMeta = [];
        }
      }

      // ------------------------------------------------------------------
      // STEP 2: BATCH_SUBMITTED  (crear JSONL → batch → esperar)
      // ------------------------------------------------------------------
      let batchOutputFileId = job.batchOutputFileId ?? null;

      if (currentStep === JobStep.BATCH_SUBMITTED) {
        const batchInfo = await step.run(
          OcrStepId.CreateAndAwaitBatch,
          async () => {
            if (!cropsMeta.length) {
              throw new Error(
                `No crops found for job ${jobId} when creating Batch.`
              );
            }

            // 2.1 – Crear JSONL local
            const stream = fsSync.createWriteStream(batchJsonlPath, {
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

              stream.write(JSON.stringify(line) + "\n");
            }

            await new Promise<void>((resolve, reject) => {
              stream.end(() => resolve());
              stream.on("error", (err) => reject(err));
            });

            // 2.2 – Subir archivo JSONL a OpenAI
            const inputFile = await openai.files.create({
              file: fsSync.createReadStream(batchJsonlPath),
              purpose: "batch",
            });

            // 2.3 – Crear batch
            const batch = await openai.batches.create({
              input_file_id: inputFile.id,
              endpoint: "/v1/chat/completions",
              completion_window: "24h",
            });

            // 2.4 – Polling simple (sin step.sleep)
            let finalBatch = batch;
            const maxTries = 80; // 80 * 5s ≈ 400s
            for (let i = 0; i < maxTries; i++) {
              if (
                finalBatch.status === "completed" &&
                finalBatch.output_file_id
              ) {
                break;
              }

              if (
                finalBatch.status === "failed" ||
                finalBatch.status === "cancelled"
              ) {
                throw new Error(
                  `Batch failed with status=${finalBatch.status}`
                );
              }

              await wait(5000);
              finalBatch = await openai.batches.retrieve(finalBatch.id);
            }

            if (
              finalBatch.status !== "completed" ||
              !finalBatch.output_file_id
            ) {
              throw new Error(
                `Batch did not complete within timeout. Last status=${finalBatch.status}`
              );
            }

            // Guardar datos del batch y avanzar de step
            await db
              .update(ocrJobs)
              .set({
                batchId: finalBatch.id,
                batchInputFileId: inputFile.id,
                batchOutputFileId: finalBatch.output_file_id,
                step: JobStep.RESULTS_SAVED,
              })
              .where(eq(ocrJobs.jobId, jobId));

            return {
              batchId: finalBatch.id,
              outputFileId: finalBatch.output_file_id as string,
            };
          }
        );

        batchOutputFileId = batchInfo.outputFileId;
        currentStep = JobStep.RESULTS_SAVED;
      }

      if (!batchOutputFileId && job.batchOutputFileId) {
        batchOutputFileId = job.batchOutputFileId;
      }

      // ------------------------------------------------------------------
      // STEP 3A: RESULTS_SAVED  (leer output JSONL → guardar frames en DB)
      // ------------------------------------------------------------------
      if (currentStep === JobStep.RESULTS_SAVED) {
        if (!batchOutputFileId) {
          throw new Error("Batch output file id missing");
        }

        await step.run(OcrStepId.SaveResultsToDb, async () => {
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
            let parsed: BatchOutputLine;

            try {
              parsed = JSON.parse(line) as BatchOutputLine;
            } catch (error) {
              throw new Error(
                `Invalid JSON line in batch output: ${
                  (error as Error).message
                }`
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

            const customId: string | undefined = parsed.custom_id;
            if (!customId) continue;

            const match = customId.match(/^job-(.+)-frame-(\d+)-(.+)$/);
            if (!match) continue;

            const [, , idxStr, filename] = match;
            const index = Number.parseInt(idxStr, 10);
            if (Number.isNaN(index)) continue;

            const completion =
              parsed.response?.body?.choices?.[0]?.message?.content;
            const text = extractTextFromCompletion(completion);

            if (!text || text === "<EMPTY>") continue;

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

          await db.transaction(async (tx) => {
            await tx.delete(ocrJobFrames).where(eq(ocrJobFrames.jobId, jobId));
            await tx.insert(ocrJobFrames).values(framesToPersist);
          });

          await db
            .update(ocrJobs)
            .set({ step: JobStep.DOCS_BUILT })
            .where(eq(ocrJobs.jobId, jobId));
        });

        currentStep = JobStep.DOCS_BUILT;
      }

      // ------------------------------------------------------------------
      // STEP 3B: DOCS_BUILT  (generar TXT + DOCX y limpiar)
      // ------------------------------------------------------------------
      if (currentStep === JobStep.DOCS_BUILT) {
        await step.run(OcrStepId.BuildDocsAndCleanup, async () => {
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

          await fs.writeFile(txtPath, txtContent, "utf8");
          await writeDocxFromParagraphs(paragraphs, docxPath);

          const listRawImages = async (): Promise<string[]> => {
            try {
              const files = await fs.readdir(rawDir);
              return files.filter((file) => /\.(png|jpe?g)$/i.test(file));
            } catch {
              return [];
            }
          };

          const pruneDecimalVariants = async () => {
            const rawImages = await listRawImages();
            if (!rawImages.length) return;

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
                fs
                  .unlink(path.join(rawDir, variant))
                  .catch(() => undefined)
              )
            );
          };

          await pruneDecimalVariants();

          const filteredRawImages = await listRawImages();

          if (filteredRawImages.length) {
            const archive = new AdmZip();
            filteredRawImages
              .sort((a, b) => compareImageFilenames(a, b))
              .forEach((filename) => {
                archive.addLocalFile(path.join(rawDir, filename), "", filename);
              });
            await fs.mkdir(path.dirname(rawArchivePath), { recursive: true });
            await archive.writeZipPromise(rawArchivePath);
            rawZipPath = rawArchivePath;
          } else {
            await fs.rm(rawArchivePath, { force: true });
            rawZipPath = null;
          }

          await db
            .update(ocrJobs)
            .set({
              status: JobsStatus.DONE,
              txtPath,
              docxPath,
            })
            .where(eq(ocrJobs.jobId, jobId));

          const dirsToRemove = [rawDir, normalizedDir, cropsDir];
          const filesToRemove = [zipPath, batchJsonlPath];

          for (const f of filesToRemove) {
            try {
              await fs.unlink(f);
            } catch {}
          }
          for (const d of dirsToRemove) {
            try {
              await fs.rm(d, { recursive: true, force: true });
            } catch {}
          }
        });
      }

      return { jobId, txtPath, docxPath, rawZipPath };
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
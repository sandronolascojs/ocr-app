import path from "node:path";

const BASE_VOLUME_DIR = path.resolve(process.cwd(), "mnt");

export const VOLUME_DIRS = {
  base: BASE_VOLUME_DIR,
  imagesBase: path.join(BASE_VOLUME_DIR, "image-files"),
  txtBase: path.join(BASE_VOLUME_DIR, "txt"),
  wordBase: path.join(BASE_VOLUME_DIR, "word"),
  tmpBase: path.join(BASE_VOLUME_DIR, "tmp"),
};

export function getJobRootDir(jobId: string) {
  return path.join(VOLUME_DIRS.imagesBase, jobId);
}

export function getJobZipPath(jobId: string) {
  return path.join(getJobRootDir(jobId), "input.zip");
}

export function getJobRawDir(jobId: string) {
  return path.join(getJobRootDir(jobId), "raw");
}

export function getJobNormalizedDir(jobId: string) {
  return path.join(getJobRootDir(jobId), "normalized");
}

export function getJobCropsDir(jobId: string) {
  return path.join(getJobRootDir(jobId), "crops");
}

export function getJobTxtPath(jobId: string) {
  return path.join(VOLUME_DIRS.txtBase, `${jobId}.txt`);
}

export function getJobDocxPath(jobId: string) {
  return path.join(VOLUME_DIRS.wordBase, `${jobId}.docx`);
}

export function getJobBatchJsonlPath(jobId: string) {
  return path.join(VOLUME_DIRS.tmpBase, `${jobId}-ocr-batch.jsonl`);
}

export function getJobRawArchivePath(jobId: string) {
  return path.join(getJobRootDir(jobId), "raw-images.zip");
}
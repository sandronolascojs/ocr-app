export const enum OcrStepId {
  PreprocessImagesAndCrops = "ocr.preprocess-images-and-crops",
  CreateAndAwaitBatch = "ocr.create-and-await-batch",
  SaveResultsToDb = "ocr.save-results-to-db",
  BuildDocsAndCleanup = "ocr.build-docs-from-db-and-cleanup",
}
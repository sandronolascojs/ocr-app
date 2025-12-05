import os from "node:os";
import path from "node:path";
import * as fs from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  extractImagesFromZip,
  getBaseKeyFromFilename,
} from "@/lib/ocr/utils";
import { buildParagraphsFromFrames } from "@/lib/ocr/paragraphs";

type FrameInput = {
  filename: string;
  baseKey: string;
  index: number;
  text: string;
};

const zipPath = path.resolve(process.cwd(), "test-input.zip");

const sortKeys = (a: string, b: string): number => {
  const na = Number(a);
  const nb = Number(b);
  const aIsNumber = !Number.isNaN(na);
  const bIsNumber = !Number.isNaN(nb);

  if (aIsNumber && bIsNumber) {
    return na - nb;
  }

  if (aIsNumber) {
    return -1;
  }

  if (bIsNumber) {
    return 1;
  }

  return a.localeCompare(b);
};

describe("OCR pipeline integration with real zip", () => {
  let tempDir: string;
  let extractedImages: string[];

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ocr-integration-"));
    extractedImages = await extractImagesFromZip(zipPath, tempDir);
  }, 60_000);

  afterAll(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it(
    "deduplicates decimal frames into paragraphs for the provided dataset",
    async () => {
      expect(extractedImages.length).toBeGreaterThan(0);

      const frames: FrameInput[] = extractedImages.map((fullPath, index) => {
        const filename = path.basename(fullPath);
        const baseKey = getBaseKeyFromFilename(filename);

        return {
          filename,
          baseKey,
          index,
          text: `Paragraph ${index}`,
        };
      });

      const uniqueKeys = new Map<string, FrameInput[]>();
      for (const frame of frames) {
        const bucket = uniqueKeys.get(frame.baseKey) ?? [];
        bucket.push(frame);
        uniqueKeys.set(frame.baseKey, bucket);
      }

      const paragraphs = buildParagraphsFromFrames(frames);
      expect(paragraphs.length).toBe(uniqueKeys.size);

      const sortedKeys = Array.from(uniqueKeys.keys()).sort(sortKeys);

      const paragraphByKey = new Map<string, string>();
      sortedKeys.forEach((key, idx) => {
        paragraphByKey.set(key, paragraphs[idx]);
      });

      const multiFrameEntry = Array.from(uniqueKeys.entries()).find(
        ([, bucket]) => bucket.length > 1
      );
      expect(multiFrameEntry).toBeDefined();

      const [sampleKey, bucket] = multiFrameEntry!;
      const combinedParagraph = paragraphByKey.get(sampleKey);

      expect(combinedParagraph).toBeDefined();
      expect(bucket.length).toBeGreaterThan(1);
      bucket.forEach((frame) => {
        expect(combinedParagraph).toContain(frame.text);
      });
    },
    60_000
  );
});


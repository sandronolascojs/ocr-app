import { describe, expect, it } from "vitest";

import {
  canonicalizeImageEntry,
  validateProcessableImageEntry,
} from "@/lib/ocr";

const collectBases = (entries: string[]): string[] => {
  const used = new Set<string>();
  return entries
    .map((entry) => canonicalizeImageEntry(entry, used)?.baseName)
    .filter((value): value is string => Boolean(value));
};

describe("canonicalizeImageEntry", () => {
  it("keeps only the first variant per integer base, removing decimals and hyphenated duplicates", () => {
    const result = collectBases([
      "1.png",
      "1-1.png",
      "1.2.jpg",
      "2.jpeg",
      "5-1.png",
      "5.png",
      "7.1.png",
      "7-2.jpeg",
      "7.png",
    ]);

    expect(result).toEqual(["1", "2", "5", "7"]);
  });

  it("drops entries without leading integers or non-image extensions", () => {
    const result = collectBases([
      "abc.png",
      "thumb.jpg",
      "__MACOSX/1.png",
      "._hidden.jpeg",
      "not-image.txt",
      "9.png",
    ]);

    expect(result).toEqual(["9"]);
  });

  it("normalizes leading zeros to integers", () => {
    const result = collectBases(["001.png", "002.jpg", "001-1.jpeg"]);
    expect(result).toEqual(["1", "2"]);
  });
});

describe("validateProcessableImageEntry", () => {
  it("accepts all images starting with numbers (1, 1.1, 1.2, 2, etc.)", () => {
    const entries = [
      "1.png",
      "1.1.png",
      "1.2.jpg",
      "2.jpeg",
      "3.png",
      "10.1.png",
    ];

    const results = entries
      .map((entry) => validateProcessableImageEntry(entry))
      .filter((value) => value !== null);

    expect(results).toHaveLength(6);
    expect(results.map((r) => r?.baseName)).toEqual([
      "1",
      "1",
      "1",
      "2",
      "3",
      "10",
    ]);
  });

  it("indicates which images should be included in ZIP (only pure integers)", () => {
    const entries = [
      "1.png",
      "1.1.png",
      "1.2.jpg",
      "2.jpeg",
      "3.png",
      "10.1.png",
    ];

    const results = entries
      .map((entry) => validateProcessableImageEntry(entry))
      .filter((value) => value !== null);

    const zipIncluded = results.filter((r) => r?.shouldIncludeInZip);
    const zipExcluded = results.filter((r) => !r?.shouldIncludeInZip);

    expect(zipIncluded.map((r) => r?.originalName)).toEqual([
      "1.png",
      "2.jpeg",
      "3.png",
    ]);
    expect(zipExcluded.map((r) => r?.originalName)).toEqual([
      "1.1.png",
      "1.2.jpg",
      "10.1.png",
    ]);
  });

  it("rejects entries without leading integers or non-image extensions", () => {
    const entries = [
      "abc.png",
      "thumb.jpg",
      "__MACOSX/1.png",
      "._hidden.jpeg",
      "not-image.txt",
    ];

    const results = entries.map((entry) =>
      validateProcessableImageEntry(entry)
    );

    expect(results.every((r) => r === null)).toBe(true);
  });

  it("preserves original filename in result", () => {
    const result1 = validateProcessableImageEntry("1.2.png");
    const result2 = validateProcessableImageEntry("5.png");

    expect(result1?.originalName).toBe("1.2.png");
    expect(result1?.baseName).toBe("1");
    expect(result1?.shouldIncludeInZip).toBe(false);

    expect(result2?.originalName).toBe("5.png");
    expect(result2?.baseName).toBe("5");
    expect(result2?.shouldIncludeInZip).toBe(true);
  });
});


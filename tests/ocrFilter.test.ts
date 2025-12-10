import { describe, expect, it } from "vitest";

import { canonicalizeImageEntry } from "@/lib/ocr";

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


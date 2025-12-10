import { describe, expect, it } from "vitest";
import { buildParagraphsFromFrames } from "@/lib/ocr/paragraphs";

describe("buildParagraphsFromFrames", () => {
  it("merges decimal variants into a single paragraph", () => {
    const paragraphs = buildParagraphsFromFrames([
      { filename: "5.png", baseKey: "5", index: 4, text: "Hello" },
      { filename: "5.1.png", baseKey: "5", index: 5, text: "world" },
      { filename: "6.png", baseKey: "6", index: 6, text: "Next" },
    ]);

    expect(paragraphs).toEqual(["Hello world", "Next"]);
  });

  it("preserves order within grouped paragraphs (1, 1.1, 1.2 as single paragraph)", () => {
    const paragraphs = buildParagraphsFromFrames([
      { filename: "1.png", baseKey: "1", index: 0, text: "First" },
      { filename: "1.1.png", baseKey: "1", index: 1, text: "second" },
      { filename: "1.2.png", baseKey: "1", index: 2, text: "third" },
      { filename: "2.png", baseKey: "2", index: 3, text: "Second" },
      { filename: "3.png", baseKey: "3", index: 4, text: "Third" },
    ]);

    expect(paragraphs).toEqual([
      "First second third",
      "Second",
      "Third",
    ]);
  });

  it("preserves order even when frames are not in sequential index order", () => {
    const paragraphs = buildParagraphsFromFrames([
      { filename: "1.2.png", baseKey: "1", index: 2, text: "third" },
      { filename: "1.png", baseKey: "1", index: 0, text: "First" },
      { filename: "1.1.png", baseKey: "1", index: 1, text: "second" },
      { filename: "2.png", baseKey: "2", index: 3, text: "Second" },
    ]);

    expect(paragraphs).toEqual([
      "First second third",
      "Second",
    ]);
  });

  it("derives the base key when it is missing or blank", () => {
    const paragraphs = buildParagraphsFromFrames([
      { filename: "10.png", baseKey: "", index: 1, text: "First" },
      { filename: "10.1.png", baseKey: "", index: 2, text: "follow up" },
    ]);

    expect(paragraphs).toEqual(["First follow up"]);
  });

  it("sorts numeric keys before lexicographic keys", () => {
    const paragraphs = buildParagraphsFromFrames([
      { filename: "A.png", baseKey: "A", index: 1, text: "Alpha" },
      { filename: "2.png", baseKey: "2", index: 1, text: "Two" },
      { filename: "12.png", baseKey: "12", index: 1, text: "Twelve" },
    ]);

    expect(paragraphs).toEqual(["Two", "Twelve", "Alpha"]);
  });
});


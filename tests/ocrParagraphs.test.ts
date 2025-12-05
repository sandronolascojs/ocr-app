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


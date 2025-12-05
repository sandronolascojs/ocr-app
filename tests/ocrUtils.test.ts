import { describe, expect, it } from "vitest";
import {
  compareImageFilenames,
  getBaseKeyFromFilename,
} from "@/lib/ocr/utils";

describe("getBaseKeyFromFilename", () => {
  it("extracts the integer prefix", () => {
    expect(getBaseKeyFromFilename("5.1.png")).toBe("5");
    expect(getBaseKeyFromFilename("05.jpeg")).toBe("5");
    expect(getBaseKeyFromFilename("12-2.PNG")).toBe("12");
  });

  it("falls back to the raw stem when no digits exist", () => {
    expect(getBaseKeyFromFilename("intro.png")).toBe("intro");
  });
});

describe("compareImageFilenames", () => {
  it("sorts numerically when prefixes are numbers", () => {
    const files = ["10.png", "2.png", "2.1.png", "1.png"];
    files.sort(compareImageFilenames);
    expect(files).toEqual(["1.png", "2.png", "2.1.png", "10.png"]);
  });

  it("keeps lexical order when names are non numeric", () => {
    const files = ["beta.png", "alpha.png"];
    files.sort(compareImageFilenames);
    expect(files).toEqual(["alpha.png", "beta.png"]);
  });
});


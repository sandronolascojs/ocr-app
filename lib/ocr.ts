import path from "node:path";

type CanonicalImageResult = {
  baseName: string;
};

type ProcessableImageResult = {
  baseName: string;
  originalName: string;
  shouldIncludeInZip: boolean;
};

/**
 * Filters and canonicalizes image entry names for ZIP processing.
 * Rules:
 * - Only accepts png/jpg/jpeg.
 * - Must start with an integer prefix (e.g., 1, 2, 10). Anything else is dropped.
 * - Only the first occurrence per integer base is kept; subsequent variants (decimals,
 *   hyphenated, duplicates) are discarded.
 * - Filters out macOS metadata (__MACOSX/, ._ prefix).
 */
export const canonicalizeImageEntry = (
  entryName: string,
  usedBases: Set<string>
): CanonicalImageResult | null => {
  // Filter macOS metadata directories
  if (entryName.startsWith("__MACOSX/")) return null;

  const base = path.basename(entryName);
  // Filter AppleDouble files
  if (base.startsWith("._")) return null;

  const ext = path.extname(base);
  if (!/\.(png|jpe?g)$/i.test(ext)) return null;

  const nameWithoutExt = path.basename(base, ext);
  // Only allow pure integer names (e.g., "5", "0003"). Anything with hyphens, dots, or extra chars is dropped.
  if (!/^\d+$/.test(nameWithoutExt)) return null;

  const parsed = Number.parseInt(nameWithoutExt, 10);
  if (Number.isNaN(parsed)) return null;

  const baseName = String(parsed);
  if (usedBases.has(baseName)) {
    return null;
  }

  usedBases.add(baseName);
  return { baseName };
};

/**
 * Validates if an image entry should be processed (for OCR).
 * Accepts images that start with a number (e.g., "1", "1.1", "1.2", "2", "10-1").
 * All valid images are processed for OCR, but only pure integer names go to the final ZIP.
 * Rules:
 * - Only accepts png/jpg/jpeg.
 * - Must start with an integer prefix (e.g., 1, 1.1, 1.2, 2, 10-1). Anything else is dropped.
 * - Filters out macOS metadata (__MACOSX/, ._ prefix).
 * - Returns baseName (first integer), originalName, and whether it should be included in ZIP.
 */
export const validateProcessableImageEntry = (
  entryName: string
): ProcessableImageResult | null => {
  // Filter macOS metadata directories
  if (entryName.startsWith("__MACOSX/")) return null;

  const base = path.basename(entryName);
  // Filter AppleDouble files
  if (base.startsWith("._")) return null;

  const ext = path.extname(base);
  if (!/\.(png|jpe?g)$/i.test(ext)) return null;

  const nameWithoutExt = path.basename(base, ext);
  
  // Must start with at least one digit
  const match = nameWithoutExt.match(/^(\d+)/);
  if (!match) return null;

  const baseName = String(Number.parseInt(match[1], 10));
  
  // Only pure integer names (e.g., "1", "2", "10") should be included in the final ZIP
  // Names like "1.1", "1.2", "2-1" are processed but not included in ZIP
  const shouldIncludeInZip = /^\d+$/.test(nameWithoutExt);

  return {
    baseName,
    originalName: base,
    shouldIncludeInZip,
  };
};


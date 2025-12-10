import path from "node:path";

type CanonicalImageResult = {
  baseName: string;
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


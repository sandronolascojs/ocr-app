import * as fs from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import sharp from "sharp";

type FilenameToken = number | string;

const tokenizeFilename = (input: string): FilenameToken[] => {
  const name = input.toLowerCase().replace(/\.[^.]+$/, "");
  const rawTokens = name.match(/\d+|[^\d]+/g);

  if (!rawTokens) {
    return [name];
  }

  return rawTokens
    .map((token) => (/\d+/.test(token) ? Number(token) : token))
    .filter((token) => token !== "");
};

export const compareImageFilenames = (a: string, b: string): number => {
  const tokensA = tokenizeFilename(a);
  const tokensB = tokenizeFilename(b);
  const maxLength = Math.max(tokensA.length, tokensB.length);

  for (let index = 0; index < maxLength; index++) {
    const tokenA = tokensA[index];
    const tokenB = tokensB[index];

    if (tokenA === undefined) return -1;
    if (tokenB === undefined) return 1;

    if (typeof tokenA === "number" && typeof tokenB === "number") {
      if (tokenA !== tokenB) return tokenA - tokenB;
      continue;
    }

    if (typeof tokenA === "number") return -1;
    if (typeof tokenB === "number") return 1;

    if (tokenA !== tokenB) {
      return tokenA.localeCompare(tokenB);
    }
  }

  return 0;
};

/**
 * Extrae solo imágenes (png/jpg/jpeg) de un zip al directorio destino,
 * ignorando basura de macOS (__MACOSX y archivos que empiezan por ._).
 */
export async function extractImagesFromZip(
  zipPath: string,
  destDir: string
): Promise<string[]> {
  await fs.mkdir(destDir, { recursive: true });

  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  const result: string[] = [];

  // Para evitar sobrescribir si hay nombres repetidos reales
  const usedNames = new Set<string>();

  for (const entry of entries) {
    if (entry.isDirectory) continue;

    const entryName = entry.entryName;

    // Ignorar carpeta de metadata de macOS
    if (entryName.startsWith("__MACOSX/")) continue;

    const base = path.basename(entryName);

    // Ignorar AppleDouble: archivos que empiezan con "._"
    if (base.startsWith("._")) continue;

    if (!/\.(png|jpe?g)$/i.test(base)) continue;

    // Normalizar nombre y evitar colisiones si hubiera duplicados de verdad
    const ext = path.extname(base);
    const nameWithoutExt = path.basename(base, ext);

    let finalBase = base;
    let counter = 1;
    while (usedNames.has(finalBase.toLowerCase())) {
      finalBase = `${nameWithoutExt}-${counter}${ext}`;
      counter++;
    }
    usedNames.add(finalBase.toLowerCase());

    const outPath = path.join(destDir, finalBase);
    const data = entry.getData();
    await fs.writeFile(outPath, data);
    result.push(outPath);
  }

  result.sort((a, b) => {
    const filenameCompare = compareImageFilenames(
      path.basename(a),
      path.basename(b)
    );
    if (filenameCompare !== 0) {
      return filenameCompare;
    }
    return a.localeCompare(b);
  });

  return result;
}

/**
 * Normaliza una imagen a 1280x720.
 * Si no es 16:9, hace contain con barras negras para NO cortar texto.
 */
export async function normalizeTo1280x720(
  inputPath: string,
  outputPath: string
): Promise<void> {
  const image = sharp(inputPath);
  const meta = await image.metadata();

  const targetW = 1280;
  const targetH = 720;
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  if (!width || !height) {
    await image.resize(targetW, targetH, { fit: "contain" }).toFile(outputPath);
    return;
  }

  const aspect = width / height;
  const targetAspect = targetW / targetH;

  if (Math.abs(aspect - targetAspect) < 0.01) {
    await image.resize(targetW, targetH).toFile(outputPath);
  } else {
    await image
      .resize(targetW, targetH, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      })
      .toFile(outputPath);
  }
}

/**
 * Recorta una franja inferior (subtítulos) y la guarda como PNG en destPath.
 * Retorna info básica del recorte.
 */
export async function cropSubtitleToFile(
  normalizedPath: string,
  destPath: string
): Promise<{
  cropPath: string;
  width: number;
  height: number;
  top: number;
  roiHeight: number;
}> {
  const image = sharp(normalizedPath);
  const meta = await image.metadata();

  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  if (!width || !height) {
    // fallback: guardamos la imagen completa
    await image.png().toFile(destPath);
    return {
      cropPath: destPath,
      width,
      height,
      top: 0,
      roiHeight: height,
    };
  }

  // Heurística simple: ~32% inferior → subtítulos
  const roiHeight = Math.floor(height * 0.32);
  const top = Math.max(0, height - roiHeight);

  await image
    .extract({ left: 0, top, width, height: roiHeight })
    .png()
    .toFile(destPath);

  return {
    cropPath: destPath,
    width,
    height,
    top,
    roiHeight,
  };
}

/**
 * Lee un archivo de imagen y lo convierte a data URL PNG base64.
 */
export async function imageFileToDataUrl(pngPath: string): Promise<string> {
  const buf = await fs.readFile(pngPath);
  const base64 = buf.toString("base64");
  return `data:image/png;base64,${base64}`;
}

/**
 * Devuelve la "clave base" numérica de un filename.
 * 3.png → "3", 3-1.png → "3", 3_2.jpeg → "3", 12-3.png → "12".
 */
export function getBaseKeyFromFilename(filename: string): string {
  const name = filename.replace(/\.[^.]+$/, "");
  const match = name.match(/^(\d+)/);
  if (!match) return name;
  return String(parseInt(match[1], 10));
}
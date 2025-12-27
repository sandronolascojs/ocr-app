import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatBytes(
  bytes: number | null,
  opts?: {
    /**
     * Unit base:
     * - 1000 => decimal (KB/MB/GB) matches what most users expect in UIs
     * - 1024 => binary (KiB/MiB/GiB)
     */
    base?: 1000 | 1024;
    decimals?: number;
    fixed?: boolean;
  }
): string {
  if (bytes === null || bytes <= 0) return "0 B";

  const base = opts?.base ?? 1000;
  const decimals = opts?.decimals ?? 2;
  const fixed = opts?.fixed ?? true;

  const sizes = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(base)),
    sizes.length - 1
  );

  if (unitIndex <= 0) {
    return `${bytes} B`;
  }

  const value = bytes / Math.pow(base, unitIndex);
  const formatted = fixed
    ? value.toFixed(decimals)
    : String(Number(value.toFixed(decimals)));

  return `${formatted} ${sizes[unitIndex]}`;
}

export function downloadSignedUrl(url: string) {
  // Use a temporary anchor to trigger a single, direct download without double navigation.
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.target = "_self"
  anchor.rel = "noopener noreferrer"
  anchor.download = ""
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
}

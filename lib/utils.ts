import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === 0 || bytes < 0) return "0 B"
  
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB"]
  
  // Calculate the appropriate unit index
  const logK = Math.log(k)
  const i = Math.min(
    Math.floor(Math.log(bytes) / logK),
    sizes.length - 1
  )
  
  // Ensure index is non-negative
  const unitIndex = Math.max(0, i)
  const divisor = Math.pow(k, unitIndex)
  const value = bytes / divisor
  
  // Format to 2 decimal places and remove trailing zeros
  const formatted = parseFloat(value.toFixed(2))
  
  return `${formatted} ${sizes[unitIndex]}`
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

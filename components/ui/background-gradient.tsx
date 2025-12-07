"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

type Variant = "redCorners" | "redOpposite" | "redTopLeft" | "redBottomRight"
type Noise = "low" | "medium" | "high"

interface Props {
  className?: string
  asOverlay?: boolean
  variant?: Variant
  noise?: Noise
  darkVignette?: boolean
}

const noiseOpacityByLevel: Record<Noise, { l1: number; l2: number; l3: number }> = {
  low: { l1: 0.32, l2: 0.22, l3: 0.16 },
  medium: { l1: 0.44, l2: 0.33, l3: 0.22 },
  high: { l1: 0.56, l2: 0.42, l3: 0.28 },
}

export const BackgroundGradient = ({
  className,
  asOverlay = false,
  variant = "redCorners",
  noise = "medium",
  darkVignette = true,
}: Props) => {
  const containerClass = asOverlay
    ? "absolute inset-0 overflow-hidden"
    : "relative w-full h-full overflow-hidden"

  const noiseOpacity = noiseOpacityByLevel[noise]

  return (
    <div className={cn(containerClass, className)}>
      {/* Base using app background (dark) */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(140deg, hsl(var(--background) / 0.98) 0%, hsl(var(--background) / 0.96) 35%, hsl(var(--background) / 0.94) 55%, hsl(var(--background) / 1) 100%)",
        }}
      />

      {/* Primary red blobs by variant */}
      {variant === "redCorners" && (
        <>
          <div className="absolute -top-40 -left-28 h-[42rem] w-[42rem] rounded-full bg-primary/55 blur-[120px]" />
          <div className="absolute bottom-[-8rem] -right-24 h-[40rem] w-[40rem] rounded-full bg-primary/50 blur-[120px]" />
        </>
      )}
      {variant === "redOpposite" && (
        <>
          <div className="absolute -top-40 -right-28 h-[42rem] w-[42rem] rounded-full bg-primary/55 blur-[120px]" />
          <div className="absolute bottom-[-8rem] -left-24 h-[40rem] w-[40rem] rounded-full bg-primary/50 blur-[120px]" />
        </>
      )}
      {variant === "redTopLeft" && (
        <div className="absolute -top-40 -left-28 h-[46rem] w-[46rem] rounded-full bg-primary/55 blur-[120px]" />
      )}
      {variant === "redBottomRight" && (
        <div className="absolute bottom-[-8rem] -right-24 h-[46rem] w-[46rem] rounded-full bg-primary/50 blur-[120px]" />
      )}

      {darkVignette && (
        <div className="absolute inset-0 bg-gradient-to-br from-transparent to-black/25" />
      )}

      {/* Brushed metal streaks */}
      <div
        className="pointer-events-none absolute inset-0 opacity-20 mix-blend-overlay"
        style={{
          backgroundImage:
            "repeating-linear-gradient(100deg, rgba(255,255,255,0.06) 0px, rgba(255,255,255,0.06) 1px, rgba(0,0,0,0) 3px, rgba(0,0,0,0) 9px)",
        }}
      />

      {/* Conic sheen */}
      <div
        className="pointer-events-none absolute inset-0 opacity-20 mix-blend-soft-light"
        style={{
          backgroundImage:
            "conic-gradient(from 220deg at 60% 20%, rgba(255,255,255,0.12), rgba(255,255,255,0) 35%)",
        }}
      />

      {/* Noise layers (coarse/medium/fine) */}
      <div
        className="absolute inset-0 mix-blend-hard-light"
        style={{
          opacity: noiseOpacity.l1,
          backgroundImage:
            "url('data:image/svg+xml;utf8,\
<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'>\
  <filter id='n'><feTurbulence type='fractalNoise' baseFrequency='4.5' numOctaves='5' stitchTiles='stitch'/></filter>\
  <rect width='100%' height='100%' filter='url(%23n)' opacity='0.31'/>\
</svg>')",
          backgroundRepeat: "repeat",
          filter: "grayscale(1) contrast(150%)",
        }}
      />
      <div
        className="absolute inset-0 mix-blend-overlay"
        style={{
          opacity: noiseOpacity.l2,
          backgroundImage:
            "url('data:image/svg+xml;utf8,\
<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'>\
  <filter id='n2'><feTurbulence type='fractalNoise' baseFrequency='2.2' numOctaves='4' stitchTiles='stitch'/></filter>\
  <rect width='100%' height='100%' filter='url(%23n2)' opacity='0.27'/>\
</svg>')",
          backgroundRepeat: "repeat",
        }}
      />
      <div
        className="absolute inset-0 mix-blend-soft-light"
        style={{
          opacity: noiseOpacity.l3,
          backgroundImage:
            "url('data:image/svg+xml;utf8,\
<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'>\
  <filter id='n3'><feTurbulence type='fractalNoise' baseFrequency='1.1' numOctaves='2' stitchTiles='stitch'/></filter>\
  <rect width='100%' height='100%' filter='url(%23n3)' opacity='0.25'/>\
</svg>')",
          backgroundRepeat: "repeat",
        }}
      />

      {/* Vignette & blur */}
      <div className="absolute inset-0 backdrop-blur-2xl [mask-image:radial-gradient(transparent,black_58%)]" />
    </div>
  )
}



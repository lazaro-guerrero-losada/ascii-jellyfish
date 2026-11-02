"use client";

import { useEffect, useRef } from "react";
import { JellyfishEngine } from "./engine";
import type { JellySpec } from "./species";

/** Glyphs come from the canvas's font-family, so give it (or a parent) a monospace font. */
export function AsciiJellyfish({ className, jellies }: { className?: string; jellies?: JellySpec[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new JellyfishEngine(canvas, jellies);
    return () => engine.destroy();
    // The roster is fixed for the life of the canvas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className={`ascii-jellyfish ${className ?? ""}`} />;
}

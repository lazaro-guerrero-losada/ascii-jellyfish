import { JellyfishEngine, JELLY_KINDS, type JellySpec } from "./src";

declare global {
  interface Window {
    __JELLY_DEMO__?: boolean;
  }
}

if (!window.__JELLY_DEMO__) {
  window.__JELLY_DEMO__ = true;
  const kinds = new URLSearchParams(location.search).get("jellies")?.split(",").filter(Boolean);
  const jellies: JellySpec[] | undefined = kinds?.map((kind, i) => ({
    kind: JELLY_KINDS.includes(kind) ? kind : "compass",
    size: 1 - i * 0.1,
  }));

  const canvas = document.querySelector<HTMLCanvasElement>("canvas");
  if (canvas) {
    new JellyfishEngine(canvas, jellies);
  }
}

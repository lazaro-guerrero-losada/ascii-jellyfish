import { clamp, hash3 } from "./math";
import {
  TENTACLE_NODES,
  JELLY_SHAPES,
  JELLY_KINDS,
  JELLY_TINTS,
  type JellyShape,
} from "./species";
import type { JellyAgent, PlanktonAgent, JellyWorld } from "./world";

export const ALPHA_LEVELS = 6;
export const AMBIENT_ALPHAS = [0.3, 0.45, 0.6, 0.75, 0.9];
export const ACCENTS = ["#e0892c", "#e03a32", "#b44ae0", "#33c8cc", "#3cb54a", "#3150e8", "#d9c14a"];
export const SKIN_RAMP = ":;t%SX8#@";
export const FIN_GLYPHS = "%;tS:";
export const RIDGE_GLYPHS = "@8%";
export const EDGE_HEAVY = ":;";
export const EDGE_LIGHT = ".',`";
export const MARK_GLYPHS = "#%@";

export const FLAG_BODY = 1;
export const FLAG_EDGE = 2;
export const FLAG_FIN = 3;
export const FLAG_RIDGE = 4;
export const FLAG_EYE = 5;
export const FLAG_MARK = 6;
export const FLAG_WHITE_PATCH = 7;
export const FLAG_WHITE_SPOT = 8;

export const SUBSAMPLES = [0.25, 0.3, 0.75, 0.3, 0.25, 0.72, 0.75, 0.72];

export class BaseAsciiRenderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  bg: HTMLCanvasElement;
  kinds: string[];
  tints: Record<string, [number, number, number]>;
  dpr = 1;
  width = 0;
  height = 0;
  cols = 0;
  rows = 0;
  cw = 8;
  ch = 12;
  font = "";
  cellFlag: Uint8Array = new Uint8Array(0);
  cellShade: Float32Array = new Float32Array(0);
  cellKey: Uint32Array = new Uint32Array(0);
  cellDepth: Float32Array = new Float32Array(0);
  cellKind: Uint8Array = new Uint8Array(0);
  ambientStamp: Uint32Array = new Uint32Array(0);
  ambientBuckets: number[][] = [];
  ambientGlyph = ".";
  ambientGlyphs: string[] | null = null;
  hitFlag = 0;
  hitShade = 0;
  hitDist = 0;
  hitS = 0;
  hitV = 0;

  constructor(canvas: HTMLCanvasElement, kinds: string[], tints: Record<string, [number, number, number]>) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D canvas unavailable");
    this.canvas = canvas;
    this.ctx = ctx;
    this.bg = document.createElement("canvas");
    this.kinds = kinds;
    this.tints = tints;
    for (let i = 0; i < AMBIENT_ALPHAS.length; i++) this.ambientBuckets.push([]);
  }

  resize(width: number, height: number, dpr: number) {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);

    const baseCw = clamp(Math.round(width / 135), 7, 10);
    this.cw = baseCw;
    this.ch = Math.round(baseCw * 1.5);
    this.cols = Math.ceil(width / this.cw);
    this.rows = Math.ceil(height / this.ch);

    const n = this.cols * this.rows;
    if (this.cellFlag.length < n) {
      this.cellFlag = new Uint8Array(n);
      this.cellShade = new Float32Array(n);
      this.cellKey = new Uint32Array(n);
      this.cellDepth = new Float32Array(n);
      this.cellKind = new Uint8Array(n);
      this.ambientStamp = new Uint32Array(n);
    }

    const fs = Math.round(this.ch * 0.95);
    this.font = `600 ${fs}px "Geist Mono", "SF Mono", Monaco, Consolas, monospace`;

    this.renderBackgroundGrid();
  }

  renderBackgroundGrid() {
    const { bg, width, height, dpr, cw, ch, cols, rows } = this;
    bg.width = Math.round(width * dpr);
    bg.height = Math.round(height * dpr);
    const bctx = bg.getContext("2d")!;
    bctx.scale(dpr, dpr);
    bctx.fillStyle = "#fafbfe";
    bctx.fillRect(0, 0, width, height);

    bctx.font = this.font;
    bctx.textAlign = "center";
    bctx.textBaseline = "middle";

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * cw + cw / 2;
        const y = r * ch + ch / 2 + 1;
        const h = hash3(c, r, 101);
        if (h < 0.04) {
          bctx.fillStyle = "rgba(148, 163, 184, 0.40)";
          bctx.fillText("·", x, y);
        } else if (h < 0.09) {
          bctx.fillStyle = "rgba(203, 213, 225, 0.35)";
          bctx.fillText(".", x, y);
        }
      }
    }
  }

  cellIndex(x: number, y: number): number {
    const c = Math.floor(x / this.cw);
    const r = Math.floor(y / this.ch);
    if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) return -1;
    return r * this.cols + c;
  }
}


export class JellyRenderer extends BaseAsciiRenderer {
    constructor(canvas) {
      super(canvas, JELLY_KINDS, JELLY_TINTS);
      this.ambientGlyph = "·";
      this.curJel = null;
      this.curShape = JELLY_SHAPES.moon;
      // Soft rose-lavender wake dots to match the gray-pink / purple-gray jellyfish palette
      this.dotStyles = [];
      for (let l = 0; l < ALPHA_LEVELS; l++) {
        const a = (0.34 * (l + 1)) / ALPHA_LEVELS;
        this.dotStyles.push(`rgba(192, 108, 168, ${a.toFixed(3)})`);
      }
    }

    render(world, dt) {
      const { ctx, dpr, cols, ch } = this;
      if (cols === 0) return;
      const t = world.time;

      this.consumeEvents(world);
      this.rasterizeJellies(world.jellies, t);
      this.depositWake(world);
      this.diffuse(dt);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.bg, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      this.markAmbient(world.plankton);
      this.drawDots();

      ctx.font = `600 ${Math.round(ch * 0.74)}px ${this.fontFamily}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      this.drawHeat();
      this.drawAmbient(["-", "·", "°"]);
      this.drawCells(t);
    }

    depositWake(world) {
      const { energy } = this;
      for (const p of world.plankton) {
        const i = this.cellIndex(p.x, p.y);
        if (i >= 0) energy[i] = Math.min(1.6, energy[i] + 0.008 + p.alarm * 0.025);
      }
      for (const jel of world.jellies) {
        for (const ch of jel.chains) {
          for (let k = TENTACLE_NODES - 4; k < TENTACLE_NODES; k++) {
            const i = this.cellIndex(ch.nodes[k * 2], ch.nodes[k * 2 + 1]);
            if (i >= 0) energy[i] = Math.min(1.6, energy[i] + 0.026 + jel.speed * 0.001);
          }
        }
      }
      if (world.pointer.active) {
        this.stamp(energy, world.pointer.x, world.pointer.y, 1, 0.08);
      }
    }

    sampleJelly(px, py) {
      const jel = this.curJel;
      const shape = this.curShape;
      const L = jel.length;
      const fx = Math.cos(jel.heading);
      const fy = Math.sin(jel.heading);
      const nx = -fy;
      const ny = fx;

      // 1. Check Bell / Umbrella Dome with Fluent Travelling Wave Profile
      // Keep the contracted shape sleek, and when waving outward (expandOut > 0) make the head bigger, deeper & rounder!
      const expandOut = Math.max(0, -jel.contract);
      const contractIn = Math.max(0, jel.contract);
      const curBellLen = L * shape.bellLen * (1 + 0.12 * contractIn + 0.32 * expandOut);
      const curBellRad = L * shape.bellRad * (1 - 0.16 * contractIn + 0.03 * expandOut);
      const relX = px - jel.x;
      const relY = py - jel.y;
      const u = -(relX * fx + relY * fy);
      const v = relX * nx + relY * ny;
      const a = Math.abs(v);

      const sBell = u / (curBellLen || 1);
      if (sBell >= -0.02 && sBell <= 1.15) {
        const sClamped = clamp(sBell, 0, 1);
        // Travelling peristaltic wave propagating down the lower skirt (s > 0.55), keeping the upper crown big & round!
        const waveAlongBell = Math.sin(jel.pulsePhase - sClamped * 2.15);
        const waveFlare = 1 - 0.07 * waveAlongBell * smoothstep(0.55, 0.98, sClamped);
        const effDomePower = shape.domePower + 0.22 * expandOut;

        let domeProfile;
        if (sClamped < 0.74) {
          domeProfile = Math.pow(Math.sin(((sClamped / 0.74) * Math.PI) / 2), effDomePower) * waveFlare;
        } else {
          const k = (sClamped - 0.74) / 0.26;
          domeProfile = (1 - (0.05 + 0.08 * contractIn) * k * k) * waveFlare;
        }
        const domeW = curBellRad * domeProfile;
        const across = a / (domeW || 1);

        // Full, deep subumbrella arch + scalloped lappet rim so the head never looks flat in the center
        const lappetWave = 0.034 * Math.cos(across * shape.lobes * Math.PI + jel.pulsePhase * 0.5);
        const rimS = (0.88 + 0.04 * expandOut) + (0.12 - 0.04 * expandOut) * Math.pow(clamp(across, 0, 1), 1.45) + lappetWave;

        if (a <= domeW && sBell >= 0 && sBell <= rimS) {
          this.hitDist = 0;
          this.hitS = sClamped * 0.35;
          this.hitV = v;

          const facing = (nx * -0.6 + ny * -0.8) * (v / (curBellRad || 1));
          let shade = 0.58 - across * across * 0.36 + (1 - sClamped) * 0.18 + facing * 0.20 + waveAlongBell * 0.06;
          let flag = FLAG_BODY;

          const canalWave = Math.abs(Math.sin(across * shape.canals * Math.PI * 0.5));
          const ringR = Math.hypot((sClamped - 0.40) * 2.2, across * 1.35);

          if (sBell > rimS - 0.14 || across > 0.85) {
            flag = FLAG_FIN;
            shade = 0.36 + 0.24 * (1 - across);
          } else if (shape.gonadRing && ringR > 0.26 && ringR < 0.52 && across < 0.58) {
            flag = FLAG_RIDGE;
            shade = 0.92;
          } else if (shape.compassMarks && canalWave > 0.86 && sClamped > 0.10 && sClamped < 0.75) {
            flag = FLAG_MARK;
            shade = 0.88;
          } else if (canalWave > 0.93 && sClamped > 0.14 && sClamped < 0.76) {
            flag = FLAG_RIDGE;
            shade = 0.88;
          } else if (sClamped < 0.14 && across < 0.45) {
            shade = Math.max(shade, 0.74);
          }

          this.hitFlag = flag;
          this.hitShade = clamp(shade, 0, 1);
          return true;
        }
      }

      // 2. Check Iconic Oral Arms & Marginal Tentacles (well-spaced & minimum-width protected so they never vanish)
      let bestDist = Infinity;
      const isMini = (jel.size || 1) < 0.56;
      const minOralPx = isMini ? Math.max(3.6, this.ch * 0.25) : Math.max(4.8, this.ch * 0.34);
      const minTentPx = isMini ? Math.max(3.2, this.ch * 0.22) : Math.max(4.1, this.ch * 0.29);

      for (let cIdx = 0; cIdx < jel.chains.length; cIdx++) {
        const ch = jel.chains[cIdx];
        const nodes = ch.nodes;
        const baseW = L * (ch.isOral ? shape.oralWidth : shape.tentacleWidth);

        for (let k = 0; k < TENTACLE_NODES - 1; k++) {
          const ax = nodes[k * 2];
          const ay = nodes[k * 2 + 1];
          const bx = nodes[(k + 1) * 2];
          const by = nodes[(k + 1) * 2 + 1];
          const abx = bx - ax;
          const aby = by - ay;
          const ab2 = abx * abx + aby * aby || 1e-6;
          const apx = px - ax;
          const apy = py - ay;
          const t = clamp((apx * abx + apy * aby) / ab2, 0, 1);
          const qx = ax + abx * t;
          const qy = ay + aby * t;
          const d = Math.hypot(px - qx, py - qy);
          if (d < bestDist) bestDist = d;

          const sChain = (k + t) / (TENTACLE_NODES - 1);
          let w;
          if (ch.isOral) {
            const frill = 0.85 + 0.22 * Math.sin(sChain * 12 - jel.pulsePhase + cIdx * 1.5);
            w = Math.max(minOralPx * (1 - 0.22 * sChain), baseW * (1 - 0.40 * Math.pow(sChain, 0.95)) * frill);
          } else {
            w = Math.max(minTentPx * (1 - 0.18 * sChain), baseW * (1 - 0.28 * sChain));
          }

          if (d <= w) {
            const across = d / (w || 1);
            this.hitDist = 0;
            this.hitS = 0.35 + sChain * 0.65;
            this.hitV = (abx * apy - aby * apx >= 0 ? d : -d) + cIdx * 12;
            if (ch.isOral) {
              this.hitFlag = across < 0.56 ? FLAG_BODY : FLAG_FIN;
              this.hitShade = (0.68 - 0.20 * sChain) * (1 - across * 0.28);
            } else {
              this.hitFlag = across < 0.46 ? FLAG_BODY : FLAG_FIN;
              this.hitShade = 0.52 + 0.22 * (1 - sChain) * (1 - across * 0.25);
            }
            return true;
          }
        }
      }

      this.hitDist = Math.min(bestDist, Math.hypot(relX, relY));
      return false;
    }

    rasterizeJellies(jellies, t) {
      const { cellFlag, cellShade, cellKey, cellDepth, cellKind, cw, ch, cols, rows } = this;
      cellFlag.fill(0);

      for (const jel of jellies) {
        this.curJel = jel;
        this.curShape = JELLY_SHAPES[jel.kind] || JELLY_SHAPES.moon;
        const kindIndex = Math.max(0, JELLY_KINDS.indexOf(jel.kind));
        const L = jel.length;

        const pad = L * 0.38;
        let minX = jel.x - pad;
        let maxX = jel.x + pad;
        let minY = jel.y - pad;
        let maxY = jel.y + pad;
        for (const chain of jel.chains) {
          const n = chain.nodes;
          for (let k = 0; k < TENTACLE_NODES; k++) {
            const nx = n[k * 2];
            const ny = n[k * 2 + 1];
            if (nx < minX) minX = nx;
            if (nx > maxX) maxX = nx;
            if (ny < minY) minY = ny;
            if (ny > maxY) maxY = ny;
          }
        }
        const reach = L * 0.09 + 16;
        const c0 = Math.max(0, Math.floor((minX - reach) / cw));
        const c1 = Math.min(cols - 1, Math.floor((maxX + reach) / cw));
        const r0 = Math.max(0, Math.floor((minY - reach) / ch));
        const r1 = Math.min(rows - 1, Math.floor((maxY + reach) / ch));
        if (c0 > c1 || r0 > r1) continue;

        const skipBeyond = L * 0.09 + Math.hypot(cw, ch);

        for (let r = r0; r <= r1; r++) {
          for (let c = c0; c <= c1; c++) {
            const x = c * cw;
            const y = r * ch;
            const centerHit = this.sampleJelly(x + cw / 2, y + ch / 2);
            if (!centerHit && this.hitDist > skipBeyond) continue;

            let bestFlag = centerHit ? this.hitFlag : 0;
            let bestShade = centerHit ? this.hitShade : 0;
            let bestS = centerHit ? this.hitS : 0;
            let bestV = centerHit ? this.hitV : 0;

            let hits = centerHit ? 1 : 0;
            for (let k = 0; k < SUBSAMPLES.length; k += 2) {
              if (this.sampleJelly(x + SUBSAMPLES[k] * cw, y + SUBSAMPLES[k + 1] * ch)) {
                hits++;
                if (!bestFlag || this.hitShade > bestShade) {
                  bestFlag = this.hitFlag;
                  bestShade = this.hitShade;
                  bestS = this.hitS;
                  bestV = this.hitV;
                }
              }
            }
            if (hits === 0) continue;
            const coverage = hits / 5;

            const i = r * cols + c;
            const key = (hash3(Math.round(bestS * 52), Math.round(bestV / (cw * 0.9)), jel.id) * 4294967295) >>> 0;
            cellKey[i] = key;
            cellDepth[i] = jel.depth;
            cellKind[i] = kindIndex;

            // Keep tails (bestS >= 0.35) solid even when angled/horizontal so tentacles never break up or vanish!
            const isTail = bestS >= 0.35;
            if ((centerHit && coverage >= 0.4) || (isTail && (hits >= 2 || bestShade > 0.44)) || coverage >= 0.6) {
              cellFlag[i] = bestFlag || FLAG_FIN;
              const flicker = (hash3(c, r, Math.floor(t * 4)) - 0.5) * 0.05;
              cellShade[i] = clamp(bestShade + flicker, 0, 1);
            } else {
              cellFlag[i] = FLAG_EDGE;
              cellShade[i] = coverage;
            }
          }
        }
      }
    }

    drawCells(t) {
      const { ctx, cols, rows, cw, ch, cellFlag, cellShade, cellKey, cellDepth, cellKind, kinds, tints } = this;
      const n = cols * rows;
      for (let i = 0; i < n; i++) {
        const flag = cellFlag[i];
        if (!flag) continue;
        const col = i % cols;
        const row = (i / cols) | 0;
        const x = col * cw;
        const y = row * ch;
        const key = cellKey[i];
        const shade = cellShade[i];
        const dim = 0.80 + 0.20 * cellDepth[i];
        const kindName = kinds[cellKind[i]] || kinds[0];
        const [tr, tg, tb] = tints[kindName] || [1.06, 0.72, 1.02];

        const tick = Math.floor(t * 2.0 + (key % 997) / 97);
        const roll = hash3(key, tick, 7);

        if (flag === FLAG_EDGE) {
          const set = shade >= 0.5 ? EDGE_HEAVY : EDGE_LIGHT;
          const glyph = set[(key >>> 8) % set.length];
          ctx.fillStyle = roll < 0.06 ? JELLY_ACCENTS[key % JELLY_ACCENTS.length] : "rgba(146, 86, 134, 0.74)";
          ctx.fillText(glyph, x + cw / 2, y + ch / 2 + 1);
          continue;
        }

        let bgLevel;
        let glyph;
        // Boost pink/purple vividness slightly on internal gonad rings & radial markings while staying gray-pink
        let satR = tr;
        let satG = tg;
        let satB = tb;

        if (flag === FLAG_RIDGE) {
          bgLevel = 116;
          satR = tr * 1.06;
          satG = tg * 0.84;
          satB = tb * 1.05;
          glyph = RIDGE_GLYPHS[(key >>> 8) % RIDGE_GLYPHS.length];
        } else if (flag === FLAG_MARK) {
          bgLevel = 126;
          satR = tr * 1.08;
          satG = tg * 0.82;
          satB = tb * 1.02;
          glyph = MARK_GLYPHS[(key >>> 8) % MARK_GLYPHS.length];
        } else if (flag === FLAG_FIN) {
          bgLevel = 196 - shade * 58;
          glyph = FIN_GLYPHS[(key >>> 8) % FIN_GLYPHS.length];
        } else {
          bgLevel = 218 - shade * 92;
          const jitter = ((key >>> 4) % 3) - 1;
          glyph = SKIN_RAMP[clamp(Math.floor(shade * 8.99) + jitter, 0, SKIN_RAMP.length - 1)];
        }

        bgLevel *= dim;
        const r = clamp(Math.round(bgLevel * satR), 0, 255);
        const g = clamp(Math.round(bgLevel * satG), 0, 255);
        const b = clamp(Math.round(bgLevel * satB), 0, 255);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x + 1, y + 1, cw - 1, ch - 1);

        let glyphColor;
        if (flag === FLAG_MARK) {
          glyphColor = "#fdf2f8";
        } else if (roll < 0.065) {
          glyphColor = JELLY_ACCENTS[key % JELLY_ACCENTS.length];
        } else if (roll < 0.11) {
          glyphColor = "#ffffff";
        } else if (bgLevel < 145) {
          glyphColor = "#fdf4ff";
        } else {
          glyphColor = "#3b1c38";
        }
        ctx.fillStyle = glyphColor;
        ctx.fillText(glyph, x + cw / 2, y + ch / 2 + 1);
      }
    }
  }


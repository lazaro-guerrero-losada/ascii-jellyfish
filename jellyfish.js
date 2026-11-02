(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    var exports = factory();
    root.JellyfishEngine = exports.JellyfishEngine;
    root.JellyWorld = exports.JellyWorld;
    root.JellyRenderer = exports.JellyRenderer;
    root.JELLY_SHAPES = exports.JELLY_SHAPES;
    root.JELLY_KINDS = exports.JELLY_KINDS;
  }
}(typeof self !== 'undefined' ? self : this, function () {
  "use strict";

  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);

  function smoothstep(e0, e1, x) {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function angleDiff(a, b) {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  }

  function hash3(x, y, z) {
    let h =
      Math.imul(x | 0, 374761393) ^
      Math.imul(y | 0, 668265263) ^
      Math.imul(z | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  const K1 = 1 / 260;
  const K2 = 1 / 310;
  const K3 = 1 / 190;
  const CURRENT_SCALE = 3400;

  function flowCurrent(x, y, t, out) {
    const a = x * K1 + t * 0.07;
    const b = y * K2 - t * 0.05;
    const c = (x + y) * K3 + t * 0.11;
    out.x = (-K2 * Math.sin(a) * Math.sin(b) + 0.5 * K3 * Math.cos(c)) * CURRENT_SCALE;
    out.y = (-K1 * Math.cos(a) * Math.cos(b) - 0.5 * K3 * Math.cos(c)) * CURRENT_SCALE;
    return out;
  }

  // Exact same ASCII constants & palette as sharks.js
  const ALPHA_LEVELS = 6;
  const AMBIENT_ALPHAS = [0.3, 0.45, 0.6, 0.75, 0.9];
  const ACCENTS = ["#e0892c", "#e03a32", "#b44ae0", "#33c8cc", "#3cb54a", "#3150e8", "#d9c14a"];
  const SKIN_RAMP = ":;t%SX8#@";
  const FIN_GLYPHS = "%;tS:";
  const RIDGE_GLYPHS = "@8%";
  const EDGE_HEAVY = ":;";
  const EDGE_LIGHT = ".',`";
  const MARK_GLYPHS = "#%@";

  const FLAG_BODY = 1;
  const FLAG_EDGE = 2;
  const FLAG_FIN = 3;
  const FLAG_RIDGE = 4;
  const FLAG_EYE = 5;
  const FLAG_MARK = 6;
  const FLAG_WHITE_PATCH = 7;
  const FLAG_WHITE_SPOT = 8;

  const SUBSAMPLES = [0.25, 0.3, 0.75, 0.3, 0.25, 0.72, 0.75, 0.72];
  const STEP = 1 / 60;
  const MAX_STEPS = 4;

  // ── SHARED BASE ASCII RENDERER ───────────────────────────────────────────

  class BaseAsciiRenderer {
    constructor(canvas, kinds, tints) {
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) throw new Error("2D canvas unavailable");
      this.canvas = canvas;
      this.ctx = ctx;
      this.bg = document.createElement("canvas");
      this.kinds = kinds;
      this.tints = tints;

      this.dpr = 1;
      this.width = 0;
      this.height = 0;
      this.cw = 12;
      this.ch = 18;
      this.cols = 0;
      this.rows = 0;
      this.fontFamily = "ui-monospace, Menlo, monospace";

      this.energy = new Float32Array(0);
      this.energyTmp = new Float32Array(0);
      this.heat = new Float32Array(0);
      this.dotStyles = [];

      this.cellFlag = new Uint8Array(0);
      this.cellShade = new Float32Array(0);
      this.cellKey = new Uint32Array(0);
      this.cellDepth = new Float32Array(0);
      this.cellKind = new Uint8Array(0);

      this.ambientStamp = new Uint32Array(0);
      this.frameId = 0;
      this.ambientBuckets = AMBIENT_ALPHAS.map(() => []);
      this.ambientGlyph = "-";

      this.hitFlag = 0;
      this.hitShade = 0;
      this.hitS = 0;
      this.hitV = 0;
      this.hitDist = 0;

      for (let l = 0; l < ALPHA_LEVELS; l++) {
        const a = (0.35 * (l + 1)) / ALPHA_LEVELS;
        this.dotStyles.push(`rgba(14, 165, 233, ${a.toFixed(3)})`);
      }
    }

    get cellWidth() { return this.cw; }
    get cellHeight() { return this.ch; }

    setFontFamily(family) {
      if (family) this.fontFamily = family;
    }

    resize(width, height, dpr) {
      const prevCols = this.cols;
      const prevRows = this.rows;
      this.width = width;
      this.height = height;
      this.dpr = dpr;
      this.cw = clamp(Math.round(width / 124), 8, 13);
      this.ch = Math.round(this.cw * 1.45);
      this.cols = Math.ceil(width / this.cw);
      this.rows = Math.ceil(height / this.ch);

      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
      this.bg.width = this.canvas.width;
      this.bg.height = this.canvas.height;

      const n = this.cols * this.rows;
      if (this.cols !== prevCols || this.rows !== prevRows) {
        this.energy = new Float32Array(n);
        this.energyTmp = new Float32Array(n);
        this.heat = new Float32Array(n);
        this.cellFlag = new Uint8Array(n);
        this.cellShade = new Float32Array(n);
        this.cellKey = new Uint32Array(n);
        this.cellDepth = new Float32Array(n);
        this.cellKind = new Uint8Array(n);
        this.ambientStamp = new Uint32Array(n);
      }

      this.paintBackground();
    }

    paintBackground() {
      const g = this.bg.getContext("2d");
      if (!g) return;
      const { width: W, height: H, dpr, cw, ch } = this;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = "#fafbfe";
      g.fillRect(0, 0, W, H);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.strokeStyle = "rgba(0, 0, 0, 0.035)";
      g.lineWidth = 1;
      g.beginPath();
      for (let c = 0; c <= Math.ceil(W / cw); c++) {
        const x = Math.round(c * cw * dpr) + 0.5;
        g.moveTo(x, 0);
        g.lineTo(x, H * dpr);
      }
      for (let r = 0; r <= Math.ceil(H / ch); r++) {
        const y = Math.round(r * ch * dpr) + 0.5;
        g.moveTo(0, y);
        g.lineTo(W * dpr, y);
      }
      g.stroke();
    }

    cellIndex(x, y) {
      const c = Math.floor(x / this.cw);
      const r = Math.floor(y / this.ch);
      if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
      return r * this.cols + c;
    }

    stamp(field, x, y, radius, amount) {
      const c0 = Math.floor(x / this.cw);
      const r0 = Math.floor(y / this.ch);
      for (let r = r0 - radius; r <= r0 + radius; r++) {
        for (let c = c0 - radius; c <= c0 + radius; c++) {
          if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
          const d = Math.hypot(c - c0, (r - r0) * 1.4);
          if (d > radius + 0.5) continue;
          const i = r * this.cols + c;
          field[i] = Math.min(1.6, field[i] + amount * (1 - d / (radius + 1)));
        }
      }
    }

    consumeEvents(world) {
      for (const e of world.events) {
        if (e.kind === "eat" || e.kind === "divide") {
          this.stamp(this.heat, e.x, e.y, e.kind === "divide" ? 3 : 2, 1);
          this.stamp(this.energy, e.x, e.y, e.kind === "divide" ? 5 : 3, 1.0);
        } else if (e.kind === "pulse") {
          this.stamp(this.energy, e.x, e.y, 4, 0.7);
        } else {
          this.stamp(this.energy, e.x, e.y, 6, 1.4);
        }
      }
      world.events.length = 0;
    }

    diffuse(dt) {
      const { cols, rows, energy, energyTmp: tmp, heat } = this;
      const decay = Math.exp(-dt * 1.5);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          const l = c > 0 ? energy[i - 1] : energy[i];
          const rt = c < cols - 1 ? energy[i + 1] : energy[i];
          const u = r > 0 ? energy[i - cols] : energy[i];
          const d = r < rows - 1 ? energy[i + cols] : energy[i];
          tmp[i] = (energy[i] * 4 + l + rt + u + d) * 0.125 * decay;
        }
      }
      this.energy = tmp;
      this.energyTmp = energy;
      const heatDecay = Math.exp(-dt * 2.2);
      for (let i = 0; i < heat.length; i++) heat[i] *= heatDecay;
    }

    drawDots() {
      const { ctx, cols, rows, cw, ch, energy, cellFlag } = this;
      const n = cols * rows;
      for (let i = 0; i < n; i++) {
        const e = energy[i];
        if (cellFlag[i] || e < 0.42) continue;
        const col = i % cols;
        const row = (i / cols) | 0;
        const level = clamp(Math.floor((e - 0.42) * 6), 0, ALPHA_LEVELS - 1);
        ctx.fillStyle = this.dotStyles[level];
        const size = Math.max(2, Math.round(cw * 0.22));
        ctx.fillRect(
          Math.round(col * cw + cw * 0.66 - size / 2),
          Math.round(row * ch + ch * 0.64 - size / 2),
          size,
          size
        );
      }
    }

    drawHeat() {
      const { ctx, heat, cols, cw, ch } = this;
      for (let i = 0; i < heat.length; i++) {
        const h = heat[i];
        if (h < 0.08) continue;
        const col = i % cols;
        const row = (i / cols) | 0;
        ctx.fillStyle = h > 0.5 ? `rgba(255,120,60,${h.toFixed(2)})` : `rgba(220,40,40,${(h * 1.6).toFixed(2)})`;
        ctx.fillText(h > 0.6 ? "*" : "·", col * cw + cw / 2, row * ch + ch / 2 + 1);
      }
    }

    markAmbient(particles) {
      const { ambientStamp, ambientBuckets, cellFlag } = this;
      const frame = ++this.frameId;
      for (const bucket of ambientBuckets) bucket.length = 0;
      for (let pass = 0; pass < 2; pass++) {
        for (const p of particles) {
          if (!p.alive || (p.depth > 0.78 ? 0 : 1) !== pass) continue;
          const i = this.cellIndex(p.x, p.y);
          if (i < 0 || ambientStamp[i] === frame || cellFlag[i]) continue;
          ambientStamp[i] = frame;
          const glint = clamp(Math.abs(p.turn || 0) / 3.5, 0, 1);
          const v = 0.3 + (0.4 * (p.depth - 0.55)) / 0.45 + 0.3 * Math.max(glint, p.alarm || 0);
          ambientBuckets[clamp(Math.floor(v * AMBIENT_ALPHAS.length), 0, AMBIENT_ALPHAS.length - 1)].push(i);
        }
      }
    }

    drawAmbient(customGlyphs) {
      const { ctx, cw, ch, cols, ambientBuckets } = this;
      for (let b = 0; b < ambientBuckets.length; b++) {
        const bucket = ambientBuckets[b];
        if (!bucket.length) continue;
        const a = AMBIENT_ALPHAS[b];
        ctx.fillStyle = `rgba(51, 65, 85, ${a * 0.75})`;
        for (const i of bucket) {
          const chGlyph = customGlyphs ? customGlyphs[(i + b) % customGlyphs.length] : this.ambientGlyph;
          ctx.fillText(chGlyph, (i % cols) * cw + cw / 2, ((i / cols) | 0) * ch + ch / 2 + 1);
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
        const dim = 0.78 + 0.22 * cellDepth[i];
        const kindName = kinds[cellKind[i]] || kinds[0];
        const [tr, tg, tb] = tints[kindName] || [0.94, 0.97, 1.03];

        const tick = Math.floor(t * 2.4 + (key % 997) / 97);
        const roll = hash3(key, tick, 7);

        if (flag === FLAG_EDGE) {
          const set = shade >= 0.5 ? EDGE_HEAVY : EDGE_LIGHT;
          const glyph = set[(key >>> 8) % set.length];
          ctx.fillStyle = roll < 0.07 ? ACCENTS[key % ACCENTS.length] : "rgba(100, 116, 139, 0.65)";
          ctx.fillText(glyph, x + cw / 2, y + ch / 2 + 1);
          continue;
        }

        let bgLevel;
        let glyph;
        if (flag === FLAG_RIDGE) {
          bgLevel = 100;
          glyph = RIDGE_GLYPHS[(key >>> 8) % RIDGE_GLYPHS.length];
        } else if (flag === FLAG_EYE) {
          bgLevel = 36;
          glyph = "o";
        } else if (flag === FLAG_MARK) {
          bgLevel = 115;
          glyph = MARK_GLYPHS[(key >>> 8) % MARK_GLYPHS.length];
        } else if (flag === FLAG_FIN) {
          bgLevel = 190 - shade * 65;
          glyph = FIN_GLYPHS[(key >>> 8) % FIN_GLYPHS.length];
        } else {
          bgLevel = 224 - shade * 105;
          const jitter = ((key >>> 4) % 3) - 1;
          glyph = SKIN_RAMP[clamp(Math.floor(shade * 8.99) + jitter, 0, SKIN_RAMP.length - 1)];
        }

        bgLevel *= dim;
        const r = Math.min(255, Math.round(bgLevel * tr));
        const g = Math.min(255, Math.round(bgLevel * tg));
        const b = Math.min(255, Math.round(bgLevel * tb + 3));
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x + 1, y + 1, cw - 1, ch - 1);

        let glyphColor;
        if (flag === FLAG_EYE) {
          glyphColor = "#ffffff";
        } else if (flag === FLAG_MARK) {
          glyphColor = "#0f172a";
        } else if (roll < 0.08) {
          glyphColor = ACCENTS[key % ACCENTS.length];
        } else if (roll < 0.12) {
          glyphColor = "#ffffff";
        } else if (bgLevel < 138) {
          glyphColor = "#f8fafc";
        } else {
          glyphColor = "#1e293b";
        }
        ctx.fillStyle = glyphColor;
        ctx.fillText(glyph, x + cw / 2, y + ch / 2 + 1);
      }
    }
  }

  // ── SHARED ENGINE LOOP WRAPPER ───────────────────────────────────────────

  class BaseLoopEngine {
    constructor(canvas, world, renderer) {
      this.canvas = canvas;
      this.world = world;
      this.renderer = renderer;
      this.renderer.setFontFamily(getComputedStyle(canvas).fontFamily);
      this.raf = 0;
      this.last = 0;
      this.acc = 0;
      this.disposed = false;

      this.onResize = () => this.resize();
      window.addEventListener("pointermove", this.onPointerMove, { passive: true });
      window.addEventListener("pointerdown", this.onPointerDown, { passive: true });
      document.documentElement.addEventListener("pointerleave", this.onPointerLeave);
      window.addEventListener("pointerleave", this.onPointerLeave);
      window.addEventListener("blur", this.onPointerLeave);
      window.addEventListener("resize", this.onResize);

      this.resizeObserver = new ResizeObserver(this.onResize);
      this.resizeObserver.observe(canvas);

      this.resize();
      this.schedule();
    }

    destroy() {
      this.disposed = true;
      cancelAnimationFrame(this.raf);
      if (this.resizeObserver) this.resizeObserver.disconnect();
      window.removeEventListener("pointermove", this.onPointerMove);
      window.removeEventListener("pointerdown", this.onPointerDown);
      document.documentElement.removeEventListener("pointerleave", this.onPointerLeave);
      window.removeEventListener("pointerleave", this.onPointerLeave);
      window.removeEventListener("blur", this.onPointerLeave);
      window.removeEventListener("resize", this.onResize);
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      const w = rect.width > 10 ? rect.width : window.innerWidth;
      const h = rect.height > 10 ? rect.height : window.innerHeight;
      if (w < 1 || h < 1) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.renderer.resize(w, h, dpr);
      this.world.resize(w, h, this.renderer.cellWidth, this.renderer.cellHeight);
    }

    schedule() {
      cancelAnimationFrame(this.raf);
      if (this.disposed) return;
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }

    frame = (now) => {
      if (this.disposed) return;
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.acc += dt;
      let steps = 0;
      while (this.acc >= STEP && steps < MAX_STEPS) {
        this.world.step(STEP);
        this.acc -= STEP;
        steps++;
      }
      if (steps === MAX_STEPS) this.acc = 0;
      this.renderer.render(this.world, dt);
      this.raf = requestAnimationFrame(this.frame);
    };

    toLocal(e) {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const inside = x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;
      return { x, y, inside };
    }

    onPointerMove = (e) => {
      const { x, y, inside } = this.toLocal(e);
      const p = this.world.pointer;
      p.x = x;
      p.y = y;
      p.active = inside;
    };

    onPointerDown = (e) => {
      if (
        e.target &&
        e.target !== this.canvas &&
        e.target.closest &&
        e.target.closest(".focus-card, .modal-backdrop, .floating-pill, button, input, select, a")
      ) {
        return;
      }
      const { x, y, inside } = this.toLocal(e);
      if (inside) this.world.splash(x, y);
    };

    onPointerLeave = () => {
      this.world.pointer.active = false;
    };
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // 1. PULSING JELLYFISH ENGINE ("jellyfish")
  // ═══════════════════════════════════════════════════════════════════════════

  const TENTACLE_NODES = 18;
  const JELLY_ACCENTS = ["#db2777", "#c026d3", "#9333ea", "#ec4899", "#a855f7", "#e11d48"];
  const JELLY_SHAPES = {
    moon: {
      bellLen: 0.36,
      bellRad: 0.28,
      domePower: 0.70,
      lobes: 8,
      canals: 8,
      // 5 well-spaced tails (3 central frilled oral arms + 2 outer long marginal tentacles)
      chainFracs: [-0.80, -0.38, 0.0, 0.38, 0.80],
      chainOral: [false, true, true, true, false],
      oralWidth: 0.025,
      tentacleWidth: 0.018,
      gonadRing: true,
      tint: [1.05, 0.73, 1.06], // Orchid / mauve gray-pink
    },
    compass: {
      bellLen: 0.37,
      bellRad: 0.27,
      domePower: 0.72,
      lobes: 10,
      canals: 6,
      chainFracs: [-0.82, -0.40, 0.0, 0.40, 0.82],
      chainOral: [false, true, true, true, false],
      oralWidth: 0.026,
      tentacleWidth: 0.018,
      compassMarks: true,
      tint: [1.11, 0.72, 0.92], // Dusty rose gray-pink
    },
    lion: {
      bellLen: 0.35,
      bellRad: 0.29,
      domePower: 0.68,
      lobes: 12,
      canals: 10,
      // 6 well-spaced tails across the wide lion's mane bell
      chainFracs: [-0.84, -0.48, -0.16, 0.16, 0.48, 0.84],
      chainOral: [false, true, true, true, true, false],
      oralWidth: 0.025,
      tentacleWidth: 0.018,
      gonadRing: true,
      tint: [1.14, 0.69, 0.96], // Vivid magenta-rose gray-pink
    },
    crystal: {
      bellLen: 0.38,
      bellRad: 0.26,
      domePower: 0.76,
      lobes: 8,
      canals: 6,
      chainFracs: [-0.76, -0.26, 0.26, 0.76],
      chainOral: [false, true, true, false],
      oralWidth: 0.025,
      tentacleWidth: 0.018,
      tint: [0.95, 0.72, 1.13], // Amethyst lavender gray-purple
    },
  };
  const JELLY_KINDS = Object.keys(JELLY_SHAPES);
  const JELLY_TINTS = {};
  for (const k of JELLY_KINDS) JELLY_TINTS[k] = JELLY_SHAPES[k].tint;

  const DEFAULT_JELLIES = [
    { kind: "compass", size: 1.0 },
    { kind: "moon", size: 0.92 },
    { kind: "lion", size: 0.94 },
    { kind: "crystal", size: 0.84 },
  ];

  class JellyWorld {
    constructor(specs = DEFAULT_JELLIES) {
      this.specs = specs;
      this.width = 0;
      this.height = 0;
      this.time = 0;
      this.jellies = [];
      this.plankton = [];
      this.events = [];
      this.pointer = { x: 0, y: 0, active: false };
      this.tmp = { x: 0, y: 0 };
    }

    resize(width, height) {
      const first = this.width === 0;
      this.width = width;
      this.height = height;
      if (first || this.jellies.length === 0) {
        this.seed();
        return;
      }
      for (const p of this.plankton) {
        p.x = clamp(p.x, 0, width);
        p.y = clamp(p.y, 0, height);
      }
    }

    seed() {
      const { width: W, height: H } = this;
      const minSide = Math.min(W, H) || 600;
      const baseLength = clamp(minSide * 0.42, 195, 380);
      const count = this.specs.length;
      const isSwarm = count > 6;

      this.jellies = [];
      for (let i = 0; i < count; i++) {
        const { kind, size } = this.specs[i];
        const shape = JELLY_SHAPES[kind] || JELLY_SHAPES.moon;
        const length = baseLength * size;
        // Distinct orbital lanes scaled so both 4-jelly and 22-mini-jelly blooms fit inside the screen
        const orbitRadius = isSwarm
          ? minSide * (0.20 + (i % 7) * 0.042 + rand(-0.012, 0.012))
          : minSide * (0.24 + i * 0.052 + rand(-0.015, 0.015));
        const a = (i / count) * TAU + rand(-0.18, 0.18);
        const orbitDir = i % 2 === 0 ? 1 : -1;
        const x = W / 2 + Math.cos(a) * orbitRadius * (W / minSide) * 0.88;
        const y = H / 2 + Math.sin(a) * orbitRadius;
        const heading = a + (orbitDir * Math.PI) / 2;

        const pulsePhase = (i / count) * TAU;
        const initContract = Math.sin(pulsePhase);
        const initExpandOut = Math.max(0, -initContract);
        const initContractIn = Math.max(0, initContract);
        const initBellLen = length * shape.bellLen * (1 + 0.12 * initContractIn + 0.32 * initExpandOut);
        const initBellRad = length * shape.bellRad * (1 - 0.16 * initContractIn + 0.03 * initExpandOut);
        const chains = [];
        // Mini jellyfish (< 0.56 size) use 3 well-spaced tails so tails never crowd on a small bell
        const isMini = size < 0.56;
        const fracs = isMini ? [-0.72, 0.0, 0.72] : shape.chainFracs || [-0.80, -0.36, 0.0, 0.36, 0.80];
        const orals = isMini ? [false, true, false] : shape.chainOral || [false, true, true, true, false];
        for (let c = 0; c < fracs.length; c++) {
          const isOral = orals[c];
          const frac = fracs[c];
          const chainLen = length * (isOral ? rand(0.56, 0.65) : rand(0.70, 0.84));
          const seg = chainLen / (TENTACLE_NODES - 1);
          const nodes = new Float32Array(TENTACLE_NODES * 2);
          const nx = -Math.sin(heading);
          const ny = Math.cos(heading);
          const attachDist = initBellLen * 0.84;
          const baseX = x - Math.cos(heading) * attachDist + nx * frac * initBellRad;
          const baseY = y - Math.sin(heading) * attachDist + ny * frac * initBellRad;
          // Staggered phase per tail so adjacent tails ripple in a harmonious wave without merging
          const phaseOff = c * 0.65;
          const trailAngle = heading + Math.PI + frac * 0.10;
          nodes[0] = baseX;
          nodes[1] = baseY;
          for (let n = 1; n < TENTACLE_NODES; n++) {
            const s = n / (TENTACLE_NODES - 1);
            const travelWave = Math.sin(pulsePhase - 1.3 - s * 4.2 + phaseOff);
            const waveAmp = (isOral ? 0.42 : 0.48) * Math.pow(s, 0.65);
            const ang = trailAngle + travelWave * waveAmp;
            nodes[n * 2] = nodes[(n - 1) * 2] + Math.cos(ang) * seg;
            nodes[n * 2 + 1] = nodes[(n - 1) * 2 + 1] + Math.sin(ang) * seg;
          }
          chains.push({
            isOral,
            frac,
            length: chainLen,
            nodes,
            trailAngle,
            phaseOff,
          });
        }

        this.jellies.push({
          id: i + 1,
          kind,
          size,
          length,
          x,
          y,
          heading,
          speed: isMini ? 9 : 11,
          pulsePhase,
          pulseRate: rand(0.74, 0.96), // Slow, hypnotic wave-swimming cadence
          contract: Math.sin(pulsePhase),
          turn: 0,
          wander: 0,
          orbitDir,
          orbitRadius,
          depth: clamp(0.72 + size * 0.28, 0.78, 1.0),
          chains,
          lastPulseEmit: 0,
        });
      }
      this.jellies.sort((a, b) => a.length - b.length);

      const pTotal = clamp(Math.round((W * H) / 5200), 75, 260);
      this.plankton = [];
      for (let i = 0; i < pTotal; i++) {
        const dir = rand(0, TAU);
        const spd = rand(6, 18);
        this.plankton.push({
          x: rand(0, W),
          y: rand(0, H),
          vx: Math.cos(dir) * spd,
          vy: Math.sin(dir) * spd,
          alarm: 0,
          alive: true,
          turn: 0,
          depth: rand(0.55, 1),
          phase: rand(0, TAU),
        });
      }
    }

    splash(x, y) {
      this.events.push({ kind: "splash", x, y });
      const r = 240;
      for (const p of this.plankton) {
        const dx = p.x - x;
        const dy = p.y - y;
        const d = Math.hypot(dx, dy);
        if (d > r || d < 1e-3) continue;
        const k = (1 - d / r) * 200;
        p.vx += (dx / d) * k;
        p.vy += (dy / d) * k;
        p.alarm = 1;
      }
    }

    step(dt) {
      this.time += dt;
      this.stepPlankton(dt);
      this.stepJellies(dt);
    }

    stepPlankton(dt) {
      const { plankton, jellies, pointer, width: W, height: H, time, tmp: cur } = this;
      const calm = Math.exp(-dt * 0.8);
      for (const p of plankton) {
        p.alarm *= calm;
        flowCurrent(p.x, p.y, time, cur);
        let ax = cur.x * 0.38 - p.vx * 0.65 + Math.cos(time * 0.7 + p.phase) * 6;
        let ay = cur.y * 0.38 - p.vy * 0.65 + Math.sin(time * 0.6 + p.phase) * 6;

        for (const jel of jellies) {
          const dx = p.x - jel.x;
          const dy = p.y - jel.y;
          const r = jel.length * 0.38 + 32;
          const d = Math.hypot(dx, dy);
          if (d < r && d > 1e-3) {
            const w = (1 - d / r) ** 2;
            ax += (dx / d) * 320 * w;
            ay += (dy / d) * 320 * w;
            p.alarm = Math.max(p.alarm, w * 0.7);
          }
        }

        if (pointer.active) {
          const dx = p.x - pointer.x;
          const dy = p.y - pointer.y;
          const d = Math.hypot(dx, dy);
          if (d < 130 && d > 1e-3) {
            const w = (1 - d / 130) ** 2;
            ax += (dx / d) * 650 * w;
            ay += (dy / d) * 650 * w;
            p.alarm = Math.max(p.alarm, w * 0.8);
          }
        }

        const before = Math.atan2(p.vy, p.vx);
        p.vx += ax * dt;
        p.vy += ay * dt;
        const spd = Math.hypot(p.vx, p.vy);
        const maxSpd = 34 + p.alarm * 65;
        if (spd > maxSpd) {
          p.vx *= maxSpd / spd;
          p.vy *= maxSpd / spd;
        }
        p.turn = angleDiff(before, Math.atan2(p.vy, p.vx)) / dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.x < -20) p.x = W + 20;
        else if (p.x > W + 20) p.x = -20;
        if (p.y < -20) p.y = H + 20;
        else if (p.y > H + 20) p.y = -20;
      }
    }

    stepJellies(dt) {
      const { jellies, pointer, width: W, height: H, time, tmp: cur } = this;
      const minSide = Math.min(W, H) || 1;
      const cxW = W / 2;
      const cyW = H / 2;

      for (const jel of jellies) {
        const L = jel.length;
        const shape = JELLY_SHAPES[jel.kind] || JELLY_SHAPES.moon;

        // Continuous, slow sinusoidal swimming wave (no sudden turbo/propeller jump)
        jel.pulsePhase = (jel.pulsePhase + dt * jel.pulseRate) % TAU;
        jel.contract = Math.sin(jel.pulsePhase);
        // Smooth wave thrust lags the apex contraction as the wave travels down the bell margin
        const waveThrust = Math.pow(0.5 + 0.5 * Math.sin(jel.pulsePhase - 0.55), 1.35);

        if (jel.contract > 0.85 && time - jel.lastPulseEmit > 2.6) {
          jel.lastPulseEmit = time;
          const rimX = jel.x - Math.cos(jel.heading) * L * shape.bellLen * 0.85;
          const rimY = jel.y - Math.sin(jel.heading) * L * shape.bellLen * 0.85;
          this.events.push({ kind: "pulse", x: rimX, y: rimY });
        }

        const fx0 = Math.cos(jel.heading);
        const fy0 = Math.sin(jel.heading);
        const nx0 = -fy0;
        const ny0 = fx0;

        let dx = fx0 * 1.4;
        let dy = fy0 * 1.4;
        jel.wander = clamp(jel.wander + (Math.random() - 0.5) * dt * 0.9, -0.55, 0.55);
        dx += Math.cos(jel.heading + jel.wander) * 0.24;
        dy += Math.sin(jel.heading + jel.wander) * 0.24;

        const rx = (jel.x - cxW) / (W / minSide);
        const ry = jel.y - cyW;
        const rDist = Math.hypot(rx, ry) || 1;
        const targetR = jel.orbitRadius * (1 + 0.14 * Math.sin(time * 0.03 + jel.id));
        const radial = clamp((targetR - rDist) / targetR, -1, 1);
        dx += ((-ry / rDist) * jel.orbitDir + (rx / rDist) * radial * 0.75) * 0.48;
        dy += ((rx / rDist) * jel.orbitDir + (ry / rDist) * radial * 0.75) * 0.48;

        // Pointer avoidance: steer laterally so it glides aside rather than flipping 180 deg
        if (pointer.active) {
          const pdx = jel.x - pointer.x;
          const pdy = jel.y - pointer.y;
          const pd = Math.hypot(pdx, pdy);
          const pRange = L * 0.75 + 70;
          if (pd < pRange && pd > 1e-3) {
            const pw = (1 - pd / pRange) * 1.6;
            const side = pdx * nx0 + pdy * ny0 >= 0 ? 1 : -1;
            dx += nx0 * side * pw;
            dy += ny0 * side * pw;
          }
        }

        // Predictive Path-Crossing Radar (Closest Point of Approach) & Non-Sticking Avoidance:
        // 1. Amplified radar anticipates future path intersections up to 6.5s ahead and steers
        //    smoothly along a stable lateral side while gently modulating speed so one jellyfish
        //    glides ahead and the other yields behind.
        // 2. Any close-contact cushion is strictly lateral (perpendicular to heading), NEVER
        //    opposing forward swimming velocity so jellyfish can never get stuck in place!
        let latSlide = 0;
        let speedMod = 1.0;
        let radarUrgency = 0;

        for (const other of jellies) {
          if (other === jel) continue;
          const otherShape = JELLY_SHAPES[other.kind] || JELLY_SHAPES.moon;

          // Vector from jel to other
          const toX = other.x - jel.x;
          const toY = other.y - jel.y;
          const curDist = Math.hypot(toX, toY) || 1;

          // Relative velocity for Closest Point of Approach (CPA) prediction
          const ovx = Math.cos(other.heading) * other.speed;
          const ovy = Math.sin(other.heading) * other.speed;
          const rvx = ovx - fx0 * jel.speed;
          const rvy = ovy - fy0 * jel.speed;
          const rv2 = rvx * rvx + rvy * rvy;
          const tCPA = rv2 > 1e-2 ? clamp(-(toX * rvx + toY * rvy) / rv2, 0, 6.5) : 0;
          const cpaX = toX + rvx * tCPA;
          const cpaY = toY + rvy * tCPA;
          const cpaDist = Math.hypot(cpaX, cpaY);
          const effDist = Math.min(curDist, cpaDist * 0.92 + curDist * 0.08);

          // Amplified predictive radar radius (compact for mini-jellyfish swarm so 22 jellies share the screen)
          const radarRadius = (L + other.length) * (jellies.length > 6 ? 0.65 : 1.18);
          if (effDist < radarRadius) {
            const ahead = (toX / curDist) * fx0 + (toY / curDist) * fy0;
            if (ahead > -0.35) {
              const proximity = Math.pow(1 - effDist / radarRadius, 1.25);
              radarUrgency = Math.max(radarUrgency, proximity);

              // Stable lateral pass side: use lateral offset at CPA, with deterministic tie-breaker by id
              const latOffset = -(cpaX * nx0 + cpaY * ny0);
              const passSide = Math.abs(latOffset) > L * 0.14
                ? (latOffset > 0 ? 1 : -1)
                : (jel.id < other.id ? 1 : -1);

              const steerW = proximity * 2.35 * (0.55 + 0.45 * Math.max(0, ahead));
              dx += nx0 * passSide * steerW;
              dy += ny0 * passSide * steerW;

              // Gentle speed yield/boost so crossing paths naturally stagger instead of meeting simultaneously
              if (ahead > 0.15) {
                speedMod *= jel.id < other.id ? 1 + 0.16 * proximity : 1 - 0.14 * proximity;
              }
            }
          }

          // Purely lateral soft slide if bells or upper tentacles get close (NEVER opposes forward speed!)
          const oMidX = other.x - Math.cos(other.heading) * other.length * 0.26;
          const oMidY = other.y - Math.sin(other.heading) * other.length * 0.26;
          for (const [oxP, oyP, rScale] of [[other.x, other.y, 1.0], [oMidX, oMidY, 0.82]]) {
            const cx = jel.x - oxP;
            const cy = jel.y - oyP;
            const cd = Math.hypot(cx, cy);
            const contactDist = (L * shape.bellRad + other.length * otherShape.bellRad) * 1.12 * rScale;
            if (cd < contactDist && cd > 1e-3) {
              const push = (1 - cd / contactDist) * 18;
              const latProj = (cx / cd) * nx0 + (cy / cd) * ny0;
              const slideSign = Math.abs(latProj) > 0.08 ? Math.sign(latProj) : (jel.id < other.id ? 1 : -1);
              latSlide += slideSign * push;
            }
          }
        }

        // Wide, smooth boundary radar so jellyfish curve gracefully along screen edges without getting pinned
        const edgePad = 128;
        const over = Math.max(-jel.x + edgePad, jel.x - (W - edgePad), -jel.y + edgePad, jel.y - (H - edgePad));
        let edgeUrgency = 0;
        if (over > 0) {
          edgeUrgency = clamp(over / (edgePad * 0.85), 0, 1);
          const w = edgeUrgency * 2.4;
          const toX = cxW - jel.x;
          const toY = cyW - jel.y;
          const d = Math.hypot(toX, toY) || 1;
          const ux = toX / d;
          const uy = toY / d;
          const forwardDot = ux * fx0 + uy * fy0;
          if (forwardDot < 0) {
            const side = ux * nx0 + uy * ny0 >= 0 ? 1 : -1;
            dx += (nx0 * side * 0.90 + ux * 0.45) * w;
            dy += (ny0 * side * 0.90 + uy * 0.45) * w;
          } else {
            dx += ux * w;
            dy += uy * w;
          }
        }

        const desired = Math.atan2(dy, dx);
        // Smooth turn rate that gently adapts when anticipating a path crossing or curving near a border
        const urgency = Math.max(radarUrgency, edgeUrgency);
        const maxTurn = (0.24 + 0.22 * urgency) * dt;
        const turned = clamp(angleDiff(jel.heading, desired), -maxTurn, maxTurn);
        jel.heading += turned;
        jel.turn += (turned / dt - jel.turn) * Math.min(1, dt * 2.2);

        // Slow, serene wave-swimming speed with gentle crossing stagger
        const baseGlide = 6.2 + L * 0.008;
        const pulseBoost = (10.5 + L * 0.016) * waveThrust;
        const targetSpeed = (baseGlide + pulseBoost) * clamp(speedMod, 0.82, 1.18);
        jel.speed += (targetSpeed - jel.speed) * Math.min(1, dt * 2.0);

        flowCurrent(jel.x, jel.y, time, cur);
        const fx = Math.cos(jel.heading);
        const fy = Math.sin(jel.heading);
        const nx = -fy;
        const ny = fx;

        jel.x = clamp(jel.x + (fx * jel.speed + nx * latSlide + cur.x * 0.08) * dt, -10, W + 10);
        jel.y = clamp(jel.y + (fy * jel.speed + ny * latSlide + cur.y * 0.08) * dt, -10, H + 10);

        // Update trailing oral arms & marginal tentacles with a smooth, unified travelling wave
        // Bell length grows taller & rounder when waving outward so the head is never flat!
        const expandOut = Math.max(0, -jel.contract);
        const contractIn = Math.max(0, jel.contract);
        const curBellLen = L * shape.bellLen * (1 + 0.12 * contractIn + 0.32 * expandOut);
        const curBellRad = L * shape.bellRad * (1 - 0.16 * contractIn + 0.03 * expandOut);
        const attachDist = curBellLen * 0.84;

        for (const ch of jel.chains) {
          const nodes = ch.nodes;
          // Rim flare wave at the attachment point
          const rimWave = Math.sin(jel.pulsePhase - 1.55);
          const lat = ch.frac * curBellRad * (1 + 0.08 * rimWave);
          nodes[0] = jel.x - fx * attachDist + nx * lat;
          nodes[1] = jel.y - fy * attachDist + ny * lat;

          // Smoothly blend the chain's base trailing direction toward opposite of bell heading
          const targetTrail = jel.heading + Math.PI + ch.frac * (0.10 + 0.08 * rimWave);
          const trailDiff = angleDiff(ch.trailAngle, targetTrail);
          ch.trailAngle += trailDiff * Math.min(1, dt * 2.8);

          const seg = ch.length / (TENTACLE_NODES - 1);
          let prevAngle = ch.trailAngle;

          for (let k = 1; k < TENTACLE_NODES; k++) {
            const s = k / (TENTACLE_NODES - 1);
            const px = nodes[(k - 1) * 2];
            const py = nodes[(k - 1) * 2 + 1];

            // Slow travelling S-wave continuing seamlessly from the bell down the length of the tail
            const travelWave = Math.sin(jel.pulsePhase - 1.3 - s * 4.2 + ch.phaseOff);
            const waveAmp = (ch.isOral ? 0.42 : 0.48) * Math.pow(s, 0.65);
            const desiredSegAngle = ch.trailAngle + travelWave * waveAmp;

            // Blend existing segment orientation smoothly toward the travelling wave angle
            const curSegAngle = Math.atan2(nodes[k * 2 + 1] - py, nodes[k * 2] - px);
            let angle = curSegAngle + angleDiff(curSegAngle, desiredSegAngle) * Math.min(1, dt * 5.5);
            const maxBend = ch.isOral ? 0.25 : 0.28;
            angle = prevAngle + clamp(angleDiff(prevAngle, angle), -maxBend, maxBend);

            nodes[k * 2] = px + Math.cos(angle) * seg;
            nodes[k * 2 + 1] = py + Math.sin(angle) * seg;
            prevAngle = angle;
          }
        }
      }
    }
  }

  class JellyRenderer extends BaseAsciiRenderer {
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

  class JellyfishEngine extends BaseLoopEngine {
    constructor(canvas, specs) {
      const world = new JellyWorld(specs);
      const renderer = new JellyRenderer(canvas);
      super(canvas, world, renderer);
    }
  }



  return { JellyfishEngine, JellyWorld, JellyRenderer, JELLY_SHAPES, JELLY_KINDS };
}));

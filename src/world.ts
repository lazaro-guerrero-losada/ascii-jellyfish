import { TAU, clamp, rand, smoothstep, angleDiff, flowCurrent } from "./math";
import {
  TENTACLE_NODES,
  JELLY_SHAPES,
  JELLY_KINDS,
  DEFAULT_JELLIES,
  type JellyShape,
  type JellySpec,
} from "./species";

export interface JellyAgent {
  kind: string;
  shape: JellyShape;
  size: number;
  totalLen: number;
  bellLen: number;
  bellRad: number;
  tailLen: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading: number;
  targetHeading: number;
  pulsePhase: number;
  pulseFreq: number;
  pulseAmp: number;
  driftBias: number;
  glow: number;
  turnRate: number;
  turnDirection: number;
  chains: Array<{
    frac: number;
    oral: boolean;
    nodes: Array<{ x: number; y: number }>;
  }>;
}

export interface PlanktonAgent {
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  speed: number;
  brightness: number;
}

export interface RippleEvent {
  x: number;
  y: number;
  birth: number;
  strength: number;
}

export class JellyWorld {
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

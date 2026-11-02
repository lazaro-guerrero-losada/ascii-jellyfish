export interface JellyShape {
  bellLen: number;
  bellRad: number;
  domePower: number;
  lobes: number;
  canals: number;
  chainFracs: number[];
  chainOral: boolean[];
  oralWidth: number;
  tentacleWidth: number;
  gonadRing?: boolean;
  compassMarks?: boolean;
  tint: [number, number, number];
}

export interface JellySpec {
  kind: string;
  size: number;
}

export const TENTACLE_NODES = 18;
export const JELLY_ACCENTS = ["#db2777", "#c026d3", "#9333ea", "#ec4899", "#a855f7", "#e11d48"];

export const JELLY_SHAPES: Record<string, JellyShape> = {
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

export const JELLY_KINDS = Object.keys(JELLY_SHAPES);
export const JELLY_TINTS: Record<string, [number, number, number]> = {};
for (const k of JELLY_KINDS) JELLY_TINTS[k] = JELLY_SHAPES[k].tint;

export const DEFAULT_JELLIES: JellySpec[] = [
  { kind: "compass", size: 1.0 },
  { kind: "moon", size: 0.92 },
  { kind: "lion", size: 0.94 },
  { kind: "crystal", size: 0.84 },
];

export const noise2D = (x: number, y: number) => {
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;

    const hash = (rx: number, ry: number) => {
        const s = Math.sin(rx * 127.1 + ry * 311.7) * 43758.5453123;
        return s - Math.floor(s);
    };

    const a = hash(i, j);
    const b = hash(i + 1, j);
    const c = hash(i, j + 1);
    const d = hash(i + 1, j + 1);

    // Hermite interpolation (smoother than linear)
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);

    return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
};

export const fbm = (x: number, y: number, octaves = 4) => {
    let value = 0;
    let amplitude = 0.5;
    let frequency = 1;
    for (let i = 0; i < octaves; i++) {
        value += amplitude * noise2D(x * frequency, y * frequency);
        amplitude *= 0.5;
        frequency *= 2;
    }
    return value;
};

export const rand2 = (x: number, z: number, salt = 0) => {
    const s = Math.sin(x * 12.9898 + z * 78.233 + salt) * 43758.5453;
    return s - Math.floor(s);
};

export const quatYawPitch = (yaw: number, pitch: number) => {
    const cy = Math.cos(yaw / 2);
    const sy = Math.sin(yaw / 2);
    const cp = Math.cos(pitch / 2);
    const sp = Math.sin(pitch / 2);
    return {
        x: cy * sp,
        y: sy * cp,
        z: -sy * sp,
        w: cy * cp,
    };
};

export const computeHull = (pts: { x: number; z: number }[]) => {
    if (pts.length < 3) return pts;
    const sorted = [...pts].sort((a, b) => (a.x === b.x ? a.z - b.z : a.x - b.x));
    const cross = (o: any, a: any, b: any) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
    const lower: any[] = [];
    for (const p of sorted) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
        lower.push(p);
    }
    const upper: any[] = [];
    for (let i = sorted.length - 1; i >= 0; i--) {
        const p = sorted[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
        upper.push(p);
    }
    upper.pop();
    lower.pop();
    return lower.concat(upper);
};

export const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.max(0, Math.min(1, t));

export const smoothstep = (t: number) => {
    const x = Math.max(0, Math.min(1, t));
    return x * x * (3 - 2 * x);
};

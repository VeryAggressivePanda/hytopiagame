import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import GIFEncoder from 'gifencoder';
import gl from 'gl';
import { createCanvas } from 'canvas';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const [key, value] = process.argv[i].split('=');
  if (!key) continue;
  args.set(key.replace(/^--/, ''), value ?? true);
}

const size = Number(args.get('size') || 50);
const frames = Number(args.get('frames') || 12);
const outPath = args.get('out') || 'assets/ui/coin.gif';
const inputPath = args.get('in') || 'assets/environment/gameplay/coin.gltf';

const absInput = path.resolve(process.cwd(), inputPath);
const absOutput = path.resolve(process.cwd(), outPath);

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (typeof url === 'string' && url.startsWith('file://')) {
    const filePath = fileURLToPath(url);
    const data = await fs.promises.readFile(filePath);
    return new Response(data);
  }
  return originalFetch(url, options);
};

async function loadGLTF() {
  const loader = new GLTFLoader();
  const url = pathToFileURL(absInput).href;
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

function ensureDomCanvas(c) {
  if (!c.addEventListener) c.addEventListener = () => {};
  if (!c.removeEventListener) c.removeEventListener = () => {};
  return c;
}

function setupRenderer() {
  const canvas = ensureDomCanvas(createCanvas(size, size));
  const context = gl(size, size, { preserveDrawingBuffer: true, antialias: true });
  if (!globalThis.document) {
    globalThis.document = {
      createElementNS: (_ns, name) => {
        if (name === 'canvas') return ensureDomCanvas(createCanvas(size, size));
        return {};
      },
    };
  }
  if (!globalThis.window) {
    globalThis.window = { devicePixelRatio: 1 };
  }
  if (!globalThis.self) {
    globalThis.self = globalThis.window;
  }
  const renderer = new THREE.WebGLRenderer({ context, canvas });
  renderer.setSize(size, size, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return { renderer, canvas, gl: context };
}

function frameToCanvas(glContext, ctx2d) {
  const pixels = new Uint8Array(size * size * 4);
  glContext.readPixels(0, 0, size, size, glContext.RGBA, glContext.UNSIGNED_BYTE, pixels);

  const imageData = ctx2d.createImageData(size, size);
  const rowBytes = size * 4;
  for (let y = 0; y < size; y += 1) {
    const srcOffset = (size - y - 1) * rowBytes;
    const dstOffset = y * rowBytes;
    imageData.data.set(pixels.subarray(srcOffset, srcOffset + rowBytes), dstOffset);
  }
  ctx2d.putImageData(imageData, 0, 0);
}

if (!globalThis.document) {
  globalThis.document = {
    createElementNS: (_ns, name) => {
      if (name === 'canvas') return createCanvas(1, 1);
      return {};
    },
  };
}
if (!globalThis.window) {
  globalThis.window = { devicePixelRatio: 1 };
}
if (!globalThis.self) {
  globalThis.self = globalThis.window;
}

const THREE = await import('three');
const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');

const { renderer, canvas, gl: glContext } = setupRenderer();
const ctx2d = canvas.getContext('2d');

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);

const ambient = new THREE.AmbientLight(0xffffff, 0.8);
scene.add(ambient);
const dir = new THREE.DirectionalLight(0xffffff, 0.9);
dir.position.set(2, 3, 4);
scene.add(dir);

const gltf = await loadGLTF();
const model = gltf.scene;
scene.add(model);

const bounds = new THREE.Box3().setFromObject(model);
const center = bounds.getCenter(new THREE.Vector3());
model.position.sub(center);

const sphere = bounds.getBoundingSphere(new THREE.Sphere());
const radius = sphere.radius || 1;
camera.position.set(0, 0, radius * 2.4);
camera.lookAt(0, 0, 0);

const encoder = new GIFEncoder(size, size);
encoder.createReadStream().pipe(fs.createWriteStream(absOutput));
encoder.start();
encoder.setRepeat(0);
encoder.setDelay(100);
encoder.setQuality(10);

for (let i = 0; i < frames; i += 1) {
  const t = (i / frames) * Math.PI * 2;
  model.rotation.y = t;
  renderer.render(scene, camera);
  frameToCanvas(glContext, ctx2d);
  encoder.addFrame(ctx2d);
}

encoder.finish();
console.log(`Wrote ${absOutput}`);

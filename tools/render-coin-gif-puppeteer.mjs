import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import puppeteer from 'puppeteer';
import GIFEncoder from 'gifencoder';
import { createCanvas, loadImage } from 'canvas';

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
const absRoot = path.resolve(process.cwd());

const userDataDir = path.resolve(process.cwd(), `tools/.puppeteer-profile-${Date.now()}`);
await fs.mkdir(userDataDir, { recursive: true });

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let executablePath;
try {
  await fs.access(chromePath);
  executablePath = chromePath;
} catch (err) {
  executablePath = undefined;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const relPath = decodeURIComponent(url.pathname.replace(/^\//, ''));
    const filePath = path.resolve(absRoot, relPath || 'index.html');
    if (!filePath.startsWith(absRoot)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = {
      '.js': 'application/javascript',
      '.mjs': 'application/javascript',
      '.gltf': 'model/gltf+json',
      '.bin': 'application/octet-stream',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
    }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  } catch (err) {
    res.writeHead(404);
    res.end('Not found');
  }
});

await new Promise(resolve => server.listen(0, resolve));
const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}`;

const browser = await puppeteer.launch({
  headless: 'new',
  userDataDir,
  executablePath,
  env: {
    ...process.env,
    HOME: userDataDir,
    XDG_CONFIG_HOME: userDataDir,
    XDG_CACHE_HOME: userDataDir,
  },
  args: [
    '--allow-file-access-from-files',
    '--disable-web-security',
    '--disable-crash-reporter',
    '--disable-features=Crashpad',
    '--disable-crashpad',
    '--disable-breakpad',
    `--user-data-dir=${userDataDir}`,
    '--crashpad-handler-pid=0',
    '--no-zygote',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
  ],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  const html = `<!doctype html>
<html>
  <head><meta charset="utf-8"></head>
  <body>
    <script type="module">
      import * as THREE from '${baseUrl}/node_modules/three/build/three.module.js';
      import { GLTFLoader } from '${baseUrl}/node_modules/three/examples/jsm/loaders/GLTFLoader.js';

      window.renderFrames = async function(modelPath, frameCount, sizePx) {
        const renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: true,
          preserveDrawingBuffer: true,
        });
        renderer.setSize(sizePx, sizePx, false);
        renderer.setClearColor(0x000000, 0);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        document.body.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
        const ambient = new THREE.AmbientLight(0xffffff, 0.8);
        scene.add(ambient);
        const dir = new THREE.DirectionalLight(0xffffff, 0.9);
        dir.position.set(2, 3, 4);
        scene.add(dir);

        const loader = new GLTFLoader();
        const gltf = await new Promise((resolve, reject) => {
          loader.load('${baseUrl}/' + modelPath, resolve, undefined, reject);
        });
        const model = gltf.scene;
        scene.add(model);

        const bounds = new THREE.Box3().setFromObject(model);
        const center = bounds.getCenter(new THREE.Vector3());
        model.position.sub(center);

        const sphere = bounds.getBoundingSphere(new THREE.Sphere());
        const radius = sphere.radius || 1;
        camera.position.set(0, 0, radius * 2.4);
        camera.lookAt(0, 0, 0);

        const framesOut = [];
        for (let i = 0; i < frameCount; i += 1) {
          const t = (i / frameCount) * Math.PI * 2;
          model.rotation.y = t;
          renderer.render(scene, camera);
          framesOut.push(renderer.domElement.toDataURL('image/png'));
        }
        return framesOut;
      };
    </script>
  </body>
</html>`;
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.renderFrames', { timeout: 10000 });

  const frameDataUrls = await page.evaluate(
    async (modelPath, frameCount, sizePx) => {
      return window.renderFrames(modelPath, frameCount, sizePx);
    },
    inputPath,
    frames,
    size
  );

  const encoder = new GIFEncoder(size, size);
  await fs.mkdir(path.dirname(absOutput), { recursive: true });
  const outStream = (await import('node:fs')).createWriteStream(absOutput);
  encoder.createReadStream().pipe(outStream);
  encoder.start();
  encoder.setRepeat(0);
  encoder.setDelay(100);
  encoder.setQuality(10);

  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  for (const dataUrl of frameDataUrls) {
    const base64 = dataUrl.split(',')[1];
    const buffer = Buffer.from(base64, 'base64');
    const img = await loadImage(buffer);
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    encoder.addFrame(ctx);
  }

  encoder.finish();
  console.log(`Wrote ${absOutput}`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';

const source = resolve('node_modules/@ffmpeg/core/dist/esm');
const output = resolve('dist/clinical-case-video/ffmpeg');
const workerSource = resolve('node_modules/@ffmpeg/ffmpeg/dist/esm');
const siteOutput = resolve('dist/clinical-case-video');

await mkdir(output, { recursive: true });
for (const file of ['worker.js', 'const.js', 'errors.js']) {
  await copyFile(resolve(workerSource, file), resolve(siteOutput, file));
}
await copyFile(resolve(source, 'ffmpeg-core.js'), resolve(output, 'ffmpeg-core.js'));
await pipeline(
  createReadStream(resolve(source, 'ffmpeg-core.wasm')),
  createGzip({ level: 9 }),
  createWriteStream(resolve(output, 'ffmpeg-core.wasm')),
);

console.log('Prepared compressed FFmpeg assets for Cloudflare Pages.');

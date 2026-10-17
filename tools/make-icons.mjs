/**
 * Regenerates the PWA launcher icons as original artwork (no third-party assets).
 * Pure maths + a minimal PNG encoder, so the repo needs no image dependencies:
 *   node tools/make-icons.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const GOLD = [227, 179, 65];
const GOLD_LIGHT = [247, 221, 154];
const NAVY = [6, 9, 19];
const PANEL = [18, 29, 56];

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function png(size, pixelAt) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let o = 0;
  for (let y = 0; y < size; y += 1) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = pixelAt(x, y, size);
      raw[o++] = r; raw[o++] = g; raw[o++] = b; raw[o++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

/** Gold ring + centre pip over a navy rounded square, with a subtle diagonal sheen. */
function mark(x, y, size, { maskable = false } = {}) {
  const c = size / 2;
  const pad = maskable ? size * 0.16 : size * 0.055;
  const rad = maskable ? size * 0.02 : size * 0.22;
  // rounded-rect coverage
  const dx = Math.max(Math.abs(x - c) - (c - pad - rad), 0);
  const dy = Math.max(Math.abs(y - c) - (c - pad - rad), 0);
  const corner = Math.hypot(dx, dy);
  const inTile = corner <= rad + 0.5;
  if (!inTile) return [0, 0, 0, 0];
  const edge = Math.max(0, Math.min(1, (rad + 0.5 - corner) / 1.5));
  let bg = mix(PANEL, NAVY, Math.max(0, Math.min(1, (x + y) / (2 * size)) * 1.15 - 0.05));
  const rOut = size * (maskable ? 0.3 : 0.34);
  const rIn = size * (maskable ? 0.215 : 0.255);
  const d = Math.hypot(x - c, y - c);
  let col = bg;
  if (d > rIn && d < rOut) {
    const t = 1 - Math.abs((d - (rIn + rOut) / 2) / ((rOut - rIn) / 2));
    col = mix(bg, mix(GOLD, GOLD_LIGHT, 0.25 + 0.6 * t), 0.35 + 0.65 * Math.sin(Math.PI * t) ** 0.6);
  }
  const pip = size * 0.105;
  if (d < pip) col = mix(GOLD_LIGHT, GOLD, Math.min(1, d / pip));
  if (d < pip * 0.34) col = NAVY;
  // sheen highlight across the top-left
  const sheen = Math.max(0, 1 - Math.hypot(x - size * 0.3, y - size * 0.26) / (size * 0.5));
  col = mix(col, [255, 255, 255], sheen * 0.06);
  return [col[0], col[1], col[2], Math.round(255 * edge)];
}

const outDir = path.resolve('public/assets');
fs.mkdirSync(outDir, { recursive: true });
const jobs = [
  ['icon-192.png', 192, false], ['icon-512.png', 512, false],
  ['icon-maskable-192.png', 192, true], ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, true],
];
for (const [name, size, maskable] of jobs) {
  fs.writeFileSync(path.join(outDir, name), png(size, (x, y, s) => mark(x, y, s, { maskable })));
  console.log(`${name}  ${size}x${size}`);
}

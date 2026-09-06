/**
 * One-off icon generator — NOT part of any build.
 *
 * The app itself has no build step and no dependencies; this script exists only
 * so the PNG icons in the repo are reproducible. Run it by hand after editing
 * icon.svg so the raster icons stay in step:
 *
 *   node tools/make-icons.js
 *
 * Writes a PNG with nothing but Node's built-in zlib.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ----------------------------- PNG encoding ----------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

/** Encode an RGBA byte array as a PNG buffer. */
function encodePng(size, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // Each scanline is prefixed with a filter byte (0 = none).
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------- Drawing -------------------------------- */

const TEAL = [15, 118, 110];
const TEAL_DEEP = [10, 88, 82];
const LEATHER = [199, 58, 58];
const LEATHER_LIT = [225, 92, 88];
const RIM = [128, 33, 33];
const SEAM = [255, 244, 232];

const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/**
 * A cricket ball, lit from the top left, on a teal ground.
 *
 * At 32px in a browser tab there is room for exactly one idea, so the ball
 * fills most of the frame and the seam is a single bold curve rather than the
 * two fine dashed ones a larger rendering can afford.
 */
function sample(x, y, size) {
  const cx = size * 0.5;
  const cy = size * 0.5;
  const dx = x - cx;
  const dy = y - cy;

  // Background: a soft diagonal so the tile does not read as a flat block.
  const wash = Math.min(1, Math.max(0, (x + y) / (size * 2)));
  const ground = mix(TEAL, TEAL_DEEP, wash);

  const radius = size * 0.40;
  const distance = Math.hypot(dx, dy);
  if (distance > radius) return ground;

  // Leather, shaded from a highlight at the upper left to a darker lower right.
  const light = Math.min(1, Math.max(0, 0.5 - (dx + dy) / (radius * 3.2)));
  let colour = mix(LEATHER, LEATHER_LIT, light);

  // A single seam: the right-hand flank of an ellipse, stopped short of the
  // poles, stitched. One clear curve survives being shrunk to a favicon.
  const a = radius * 0.46;
  const b = radius * 0.94;
  const ellipse = Math.hypot(dx / a, dy / b);
  const onSeam = Math.abs(ellipse - 1) < 0.13 && dx > -radius * 0.1 && Math.abs(dy) < b * 0.82;
  const stitch = Math.floor((dy / size) * 15);
  if (onSeam && stitch % 2 === 0) return SEAM;

  // Darken the edge so the ball keeps its shape against the teal.
  if (distance > radius * 0.9) {
    colour = mix(colour, RIM, (distance - radius * 0.9) / (radius * 0.1));
  }
  return colour;
}

/** Render at `size`, supersampled for smooth edges. */
function render(size, samplesPerAxis = 3) {
  const rgba = Buffer.alloc(size * size * 4);
  const step = 1 / samplesPerAxis;
  const total = samplesPerAxis * samplesPerAxis;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < samplesPerAxis; sy += 1) {
        for (let sx = 0; sx < samplesPerAxis; sx += 1) {
          const [pr, pg, pb] = sample(x + (sx + 0.5) * step, y + (sy + 0.5) * step, size);
          r += pr;
          g += pg;
          b += pb;
        }
      }
      const offset = (y * size + x) * 4;
      rgba[offset] = Math.round(r / total);
      rgba[offset + 1] = Math.round(g / total);
      rgba[offset + 2] = Math.round(b / total);
      rgba[offset + 3] = 255;
    }
  }
  return rgba;
}

for (const size of [192, 512]) {
  const file = join(OUT_DIR, `icon-${size}.png`);
  writeFileSync(file, encodePng(size, render(size)));
  console.log(`wrote icon-${size}.png`);
}

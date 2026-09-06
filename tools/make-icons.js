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

const TEAL = [17, 124, 116];
const TEAL_DEEP = [8, 78, 73];
const WILLOW = [244, 231, 202];
const WILLOW_SHADE = [214, 194, 156];
const GRIP = [42, 38, 34];
const LEATHER = [228, 72, 63];
const LEATHER_LIT = [246, 118, 106];
const SEAM = [255, 246, 236];

const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

// The bat lies along one diagonal. Everything is a fraction of the icon size,
// so the geometry is identical at every resolution.
const ANGLE = (50 * Math.PI) / 180;
const COS = Math.cos(ANGLE);
const SIN = Math.sin(ANGLE);

// Up-and-right along the bat, from the toe of the blade to the top of the grip.
const AXIS = [Math.sin(ANGLE), -Math.cos(ANGLE)];

/** Signed distance to a rounded rectangle; negative inside. */
function roundedRect(px, py, halfW, halfH, radius) {
  const qx = Math.abs(px) - (halfW - radius);
  const qy = Math.abs(py) - (halfH - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - radius;
}

/** Rotate a point into the bat's own frame, where its length runs along y. */
function toBatFrame(dx, dy) {
  return [dx * COS + dy * SIN, -dx * SIN + dy * COS];
}

/**
 * A cricket bat on the diagonal with the ball in the corner it leaves open.
 *
 * Two masses either side of one diagonal is about all a 16px tab icon can
 * carry, so there is no outline and no shadow — a cream blade, a dark grip and
 * a red ball, each big enough to survive the shrink. The blade and grip are
 * deliberately given overlapping lengths: a hairline gap between them reads as
 * two unrelated blobs rather than one bat.
 */
function sample(x, y, size) {
  const cx = size * 0.5;
  const cy = size * 0.5;

  // Ground: a soft diagonal wash so the tile is not a flat block of teal.
  const wash = Math.min(1, Math.max(0, (x + y) / (size * 2)));
  let colour = mix(TEAL, TEAL_DEEP, wash);

  // Lay the bat out from the toe of the blade upward along the axis.
  const toeX = cx - size * 0.230;
  const toeY = cy + size * 0.195;
  const bladeLength = size * 0.455;
  const gripLength = size * 0.265;
  const overlap = size * 0.030;

  const along = (distance) => [toeX + AXIS[0] * distance, toeY + AXIS[1] * distance];

  const [bladeCx, bladeCy] = along(bladeLength / 2);
  const [blx, bly] = toBatFrame(x - bladeCx, y - bladeCy);
  if (roundedRect(blx, bly, size * 0.094, bladeLength / 2, size * 0.042) < 0) {
    // Shade across the face so it reads as a blade rather than a flat stripe.
    const across = Math.min(1, Math.max(0, (blx / (size * 0.094)) * 0.5 + 0.5));
    colour = mix(WILLOW, WILLOW_SHADE, across);
  }

  const [gripCx, gripCy] = along(bladeLength + gripLength / 2 - overlap);
  const [gx, gy] = toBatFrame(x - gripCx, y - gripCy);
  if (roundedRect(gx, gy, size * 0.040, gripLength / 2, size * 0.034) < 0) {
    colour = GRIP;
  }

  // Ball, in the corner the bat leaves open.
  const ddx = x - size * 0.268;
  const ddy = y - size * 0.282;
  const radius = size * 0.152;
  if (Math.hypot(ddx, ddy) < radius) {
    const light = Math.min(1, Math.max(0, 0.5 - (ddx + ddy) / (radius * 3)));
    colour = mix(LEATHER, LEATHER_LIT, light);
    // One short seam arc, dropped below 64px where it would only smear.
    if (size >= 64) {
      const a = radius * 0.44;
      const b = radius * 0.90;
      const ellipse = Math.hypot(ddx / a, ddy / b);
      const onSeam = Math.abs(ellipse - 1) < 0.15
        && ddx > -radius * 0.15
        && Math.abs(ddy) < b * 0.78;
      if (onSeam && Math.floor((ddy / size) * 17) % 2 === 0) colour = SEAM;
    }
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

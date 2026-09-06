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

/**
 * The icon has to sit on a light tab strip, a dark one, and whatever colour a
 * phone home screen happens to be. So the palette is deliberately all
 * mid-tones: nothing near white (which disappears on light) and nothing near
 * black (which disappears on dark), with a dark outline to hold the shapes
 * together against a pale background.
 */
const TEAL = [17, 124, 116];
const TEAL_DEEP = [8, 78, 73];
const WILLOW = [226, 179, 104];
const WILLOW_SHADE = [196, 146, 72];
const GRIP = [122, 79, 42];
const LEATHER = [226, 68, 60];
const LEATHER_LIT = [244, 112, 100];
const SEAM = [255, 246, 236];
const OUTLINE = [74, 44, 20];
const BALL_OUTLINE = [124, 30, 26];

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

// The drawing's own centre, and how far it is enlarged to fill the tile.
const DESIGN_CX = 0.478;
const DESIGN_CY = 0.440;
const ZOOM = 1.26;

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
 * Returns null for a transparent pixel. `opaque` fills the tile with the teal
 * ground instead, which is what a maskable home-screen icon needs — the
 * operating system crops those to its own shape and a transparent one would
 * come out looking broken.
 *
 * The blade and grip are given overlapping lengths on purpose: a hairline gap
 * between them reads as two unrelated shapes rather than one bat.
 */
function sample(tileX, tileY, size, opaque) {
  const cx = size * 0.5;
  const cy = size * 0.5;

  let colour = null;
  if (opaque) {
    const wash = Math.min(1, Math.max(0, (tileX + tileY) / (size * 2)));
    colour = mix(TEAL, TEAL_DEEP, wash);
  }

  // Without a background tile the padding is just wasted space, so the artwork
  // is scaled up about its own centre of mass to fill the frame. This matters
  // most at 16px, where every pixel spent on margin is one the bat does not get.
  const x = size * DESIGN_CX + (tileX - cx) / ZOOM;
  const y = size * DESIGN_CY + (tileY - cy) / ZOOM;

  const stroke = size * 0.028;

  // Lay the bat out from the toe of the blade upward along the axis.
  const toeX = cx - size * 0.230;
  const toeY = cy + size * 0.195;
  const bladeLength = size * 0.455;
  const gripLength = size * 0.265;
  const overlap = size * 0.030;
  const along = (distance) => [toeX + AXIS[0] * distance, toeY + AXIS[1] * distance];

  const [bladeCx, bladeCy] = along(bladeLength / 2);
  const [blx, bly] = toBatFrame(x - bladeCx, y - bladeCy);
  const blade = roundedRect(blx, bly, size * 0.094, bladeLength / 2, size * 0.042);

  const [gripCx, gripCy] = along(bladeLength + gripLength / 2 - overlap);
  const [gx, gy] = toBatFrame(x - gripCx, y - gripCy);
  const grip = roundedRect(gx, gy, size * 0.040, gripLength / 2, size * 0.034);

  // Outline the whole bat first, so the grip does not get a seam down its side
  // where it overlaps the blade.
  if (Math.min(blade, grip) < stroke) colour = OUTLINE;
  if (blade < 0) {
    // Shade across the face so it reads as a blade rather than a flat stripe.
    const across = Math.min(1, Math.max(0, (blx / (size * 0.094)) * 0.5 + 0.5));
    colour = mix(WILLOW, WILLOW_SHADE, across);
  }
  if (grip < 0) colour = GRIP;

  // Ball, in the corner the bat leaves open.
  const ddx = x - size * 0.268;
  const ddy = y - size * 0.282;
  const radius = size * 0.152;
  const distance = Math.hypot(ddx, ddy);
  if (distance < radius + stroke) colour = BALL_OUTLINE;
  if (distance < radius) {
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

/**
 * Render at `size`, supersampled for smooth edges. Colour is averaged weighted
 * by coverage, so edge pixels do not pick up a dark fringe from the
 * transparent samples around them.
 */
function render(size, opaque, samplesPerAxis = 4) {
  const rgba = Buffer.alloc(size * size * 4);
  const step = 1 / samplesPerAxis;
  const total = samplesPerAxis * samplesPerAxis;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let covered = 0;
      for (let sy = 0; sy < samplesPerAxis; sy += 1) {
        for (let sx = 0; sx < samplesPerAxis; sx += 1) {
          const hit = sample(x + (sx + 0.5) * step, y + (sy + 0.5) * step, size, opaque);
          if (hit === null) continue;
          r += hit[0];
          g += hit[1];
          b += hit[2];
          covered += 1;
        }
      }
      const offset = (y * size + x) * 4;
      if (covered > 0) {
        rgba[offset] = Math.round(r / covered);
        rgba[offset + 1] = Math.round(g / covered);
        rgba[offset + 2] = Math.round(b / covered);
        rgba[offset + 3] = Math.round((covered / total) * 255);
      }
    }
  }
  return rgba;
}

const OUTPUTS = [
  { file: 'icon-192.png', size: 192, opaque: false },
  { file: 'icon-512.png', size: 512, opaque: false },
  // Maskable icons are cropped to the platform's own shape, so they must be
  // full-bleed rather than transparent.
  { file: 'icon-maskable-512.png', size: 512, opaque: true },
];

for (const { file, size, opaque } of OUTPUTS) {
  writeFileSync(join(OUT_DIR, file), encodePng(size, render(size, opaque)));
  console.log(`wrote ${file}`);
}

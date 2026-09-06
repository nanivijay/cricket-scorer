/**
 * Cricket Over Counter — QR codes.
 *
 * A minimal QR encoder: byte mode, error correction level L, versions 1-40.
 * Enough to put a handover link on screen so the next scorer can point a phone
 * at it — no network, no third-party image service, and the link is never
 * displayed as text that could be copied out of a screenshot.
 *
 * Level L is the right trade here: the code is read off a bright screen from
 * a few inches away, so 7% recovery is ample, and the extra capacity keeps the
 * module count (and therefore the size of each square) comfortable.
 *
 * The specification tables below were generated from a reference encoder
 * rather than transcribed by hand. tools/qr-verify.py then checks every module
 * of the output against python-qrcode across versions 1-32 and all eight mask
 * patterns.
 *
 * One deliberate difference from that reference: when choosing a mask we score
 * the finished symbol, format information included, as Nayuki's reference
 * implementation does. python-qrcode scores each candidate with placeholder
 * format bits instead, so the two occasionally settle on different masks. Both
 * are valid — the chosen mask is recorded in the format information, so every
 * one of the eight decodes — and the penalty *scoring* itself is verified to
 * agree with that reference exactly.
 *
 * Pure: no DOM. `toSvg` returns a string.
 */

/* ------------------------------------------------------------------ *
 * Specification tables
 * ------------------------------------------------------------------ */

// [ecCodewordsPerBlock, group1Blocks, group1DataWords, group2Blocks, group2DataWords]
const EC_L = [
  null,
  [7, 1, 19, 0, 0], [10, 1, 34, 0, 0], [15, 1, 55, 0, 0], [20, 1, 80, 0, 0],
  [26, 1, 108, 0, 0], [18, 2, 68, 0, 0], [20, 2, 78, 0, 0], [24, 2, 97, 0, 0],
  [30, 2, 116, 0, 0], [18, 2, 68, 2, 69], [20, 4, 81, 0, 0], [24, 2, 92, 2, 93],
  [26, 4, 107, 0, 0], [30, 3, 115, 1, 116], [22, 5, 87, 1, 88], [24, 5, 98, 1, 99],
  [28, 1, 107, 5, 108], [30, 5, 120, 1, 121], [28, 3, 113, 4, 114], [28, 3, 107, 5, 108],
  [28, 4, 116, 4, 117], [28, 2, 111, 7, 112], [30, 4, 121, 5, 122], [30, 6, 117, 4, 118],
  [26, 8, 106, 4, 107], [28, 10, 114, 2, 115], [30, 8, 122, 4, 123], [30, 3, 117, 10, 118],
  [30, 7, 116, 7, 117], [30, 5, 115, 10, 116], [30, 13, 115, 3, 116], [30, 17, 115, 0, 0],
  [30, 17, 115, 1, 116], [30, 13, 115, 6, 116], [30, 12, 121, 7, 122], [30, 6, 121, 14, 122],
  [30, 17, 122, 4, 123], [30, 4, 122, 18, 123], [30, 20, 117, 4, 118], [30, 19, 118, 6, 119],
];

// Centres of the alignment patterns, by version.
const ALIGNMENT = [
  null, [],
  [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62],
  [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82],
  [6, 30, 58, 86], [6, 34, 62, 90],
  [6, 28, 50, 72, 94], [6, 26, 50, 74, 98], [6, 30, 54, 78, 102], [6, 28, 54, 80, 106],
  [6, 32, 58, 84, 110], [6, 30, 58, 86, 114], [6, 34, 62, 90, 118],
  [6, 26, 50, 74, 98, 122], [6, 30, 54, 78, 102, 126], [6, 26, 52, 78, 104, 130],
  [6, 30, 56, 82, 108, 134], [6, 34, 60, 86, 112, 138], [6, 30, 58, 86, 114, 142],
  [6, 34, 62, 90, 118, 146],
  [6, 30, 54, 78, 102, 126, 150], [6, 24, 50, 76, 102, 128, 154], [6, 28, 54, 80, 106, 132, 158],
  [6, 32, 58, 84, 110, 136, 162], [6, 26, 54, 82, 110, 138, 166], [6, 30, 58, 86, 114, 142, 170],
];

/** Total data codewords available at a version, error level L. */
function dataCapacity(version) {
  const [, g1Blocks, g1Words, g2Blocks, g2Words] = EC_L[version];
  return g1Blocks * g1Words + g2Blocks * g2Words;
}

/** The character-count indicator is 8 bits up to version 9, 16 bits after. */
const countBits = (version) => (version <= 9 ? 8 : 16);

/** The largest payload this encoder can carry, in bytes. */
export const MAX_BYTES = dataCapacity(40) - 3;

/* ------------------------------------------------------------------ *
 * Galois field GF(256), primitive polynomial 0x11d
 * ------------------------------------------------------------------ */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();

const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** The generator polynomial for `count` error-correction codewords. */
function generatorPoly(count) {
  let poly = [1];
  for (let i = 0; i < count; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** Reed-Solomon remainder — the error-correction codewords for one block. */
function ecCodewords(data, count) {
  const gen = generatorPoly(count);
  const buffer = new Uint8Array(data.length + count);
  buffer.set(data);
  for (let i = 0; i < data.length; i += 1) {
    const factor = buffer[i];
    if (factor === 0) continue;
    for (let j = 0; j < gen.length; j += 1) buffer[i + j] ^= mul(gen[j], factor);
  }
  return buffer.subarray(data.length);
}

/* ------------------------------------------------------------------ *
 * Bit stream
 * ------------------------------------------------------------------ */

class Bits {
  constructor() {
    this.bytes = [];
    this.length = 0;
  }

  push(value, width) {
    for (let i = width - 1; i >= 0; i -= 1) {
      const bit = (value >> i) & 1;
      const index = this.length >> 3;
      if (index === this.bytes.length) this.bytes.push(0);
      if (bit) this.bytes[index] |= 0x80 >> (this.length & 7);
      this.length += 1;
    }
  }
}

/* ------------------------------------------------------------------ *
 * Codewords
 * ------------------------------------------------------------------ */

/** The smallest version that can hold `byteLength` bytes at level L. */
function chooseVersion(byteLength) {
  for (let version = 1; version <= 40; version += 1) {
    const bits = 4 + countBits(version) + byteLength * 8;
    if (Math.ceil(bits / 8) <= dataCapacity(version)) return version;
  }
  return null;
}

function buildCodewords(bytes, version) {
  const capacity = dataCapacity(version);
  const bits = new Bits();
  bits.push(0b0100, 4);                       // byte mode
  bits.push(bytes.length, countBits(version));
  for (const byte of bytes) bits.push(byte, 8);

  // Terminator: up to four zero bits, but never past the capacity.
  bits.push(0, Math.min(4, capacity * 8 - bits.length));
  // Pad to a whole byte, then with the two prescribed filler codewords.
  if (bits.length & 7) bits.push(0, 8 - (bits.length & 7));
  const data = bits.bytes.slice();
  for (let i = 0; data.length < capacity; i += 1) data.push(i % 2 === 0 ? 0xec : 0x11);

  // Split into blocks, error-correct each, then interleave both sets.
  const [ecCount, g1Blocks, g1Words, g2Blocks, g2Words] = EC_L[version];
  const blocks = [];
  let at = 0;
  for (let i = 0; i < g1Blocks; i += 1) {
    blocks.push(Uint8Array.from(data.slice(at, at + g1Words)));
    at += g1Words;
  }
  for (let i = 0; i < g2Blocks; i += 1) {
    blocks.push(Uint8Array.from(data.slice(at, at + g2Words)));
    at += g2Words;
  }
  const ecBlocks = blocks.map((block) => ecCodewords(block, ecCount));

  const out = [];
  const longest = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < longest; i += 1) {
    for (const block of blocks) if (i < block.length) out.push(block[i]);
  }
  for (let i = 0; i < ecCount; i += 1) {
    for (const block of ecBlocks) out.push(block[i]);
  }
  return Uint8Array.from(out);
}

/* ------------------------------------------------------------------ *
 * Matrix
 * ------------------------------------------------------------------ */

function blankMatrix(size) {
  return {
    size,
    modules: Array.from({ length: size }, () => new Array(size).fill(0)),
    reserved: Array.from({ length: size }, () => new Array(size).fill(false)),
  };
}

function setFunction(m, row, col, value) {
  m.modules[row][col] = value;
  m.reserved[row][col] = true;
}

function placeFinder(m, row, col) {
  for (let r = -1; r <= 7; r += 1) {
    for (let c = -1; c <= 7; c += 1) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || rr >= m.size || cc < 0 || cc >= m.size) continue;
      const inRing = (r >= 0 && r <= 6 && (c === 0 || c === 6))
        || (c >= 0 && c <= 6 && (r === 0 || r === 6));
      const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      setFunction(m, rr, cc, inRing || inCore ? 1 : 0);
    }
  }
}

function placeAlignment(m, version) {
  const centres = ALIGNMENT[version];
  const last = centres.length - 1;
  for (let i = 0; i < centres.length; i += 1) {
    for (let j = 0; j < centres.length; j += 1) {
      // The three finder corners have no alignment pattern.
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      const row = centres[i];
      const col = centres[j];
      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          const edge = Math.max(Math.abs(r), Math.abs(c));
          setFunction(m, row + r, col + c, edge === 1 ? 0 : 1);
        }
      }
    }
  }
}

function placeFunctionPatterns(m, version) {
  placeFinder(m, 0, 0);
  placeFinder(m, 0, m.size - 7);
  placeFinder(m, m.size - 7, 0);

  for (let i = 8; i < m.size - 8; i += 1) {
    const value = i % 2 === 0 ? 1 : 0;
    setFunction(m, 6, i, value);
    setFunction(m, i, 6, value);
  }

  if (version >= 2) placeAlignment(m, version);

  // Always-dark module, just above the lower-left format strip.
  setFunction(m, m.size - 8, 8, 1);

  // Reserve the format information areas; the values go in after masking.
  for (let i = 0; i <= 8; i += 1) {
    if (!m.reserved[8][i]) setFunction(m, 8, i, 0);
    if (!m.reserved[i][8]) setFunction(m, i, 8, 0);
  }
  for (let i = 0; i < 8; i += 1) {
    if (!m.reserved[8][m.size - 1 - i]) setFunction(m, 8, m.size - 1 - i, 0);
    if (!m.reserved[m.size - 1 - i][8]) setFunction(m, m.size - 1 - i, 8, 0);
  }

  if (version >= 7) placeVersionInfo(m, version);
}

/** BCH(18,6) version information, for versions 7 and up. */
function placeVersionInfo(m, version) {
  let value = version;
  for (let i = 0; i < 12; i += 1) {
    value = (value << 1) ^ ((value >> 11) * 0x1f25);
  }
  const bits = (version << 12) | value;

  for (let i = 0; i < 18; i += 1) {
    const bit = (bits >> i) & 1;
    const row = Math.floor(i / 3);
    const col = m.size - 11 + (i % 3);
    setFunction(m, row, col, bit);
    setFunction(m, col, row, bit);
  }
}

/** BCH(15,5) format information, XORed with the fixed mask pattern. */
function placeFormatInfo(m, mask) {
  const ecBits = 0b01;                       // level L
  let value = (ecBits << 3) | mask;
  let rest = value;
  for (let i = 0; i < 10; i += 1) {
    rest = (rest << 1) ^ ((rest >> 9) * 0x537);
  }
  const bits = (((value << 10) | rest) ^ 0x5412);

  // First copy: bits 0-5 run down column 8, then the corner, then bits 9-14
  // run left along row 8. (Getting these two axes the wrong way round yields a
  // symmetric-looking code that no scanner can read.)
  for (let i = 0; i <= 5; i += 1) m.modules[i][8] = (bits >> i) & 1;
  m.modules[7][8] = (bits >> 6) & 1;
  m.modules[8][8] = (bits >> 7) & 1;
  m.modules[8][7] = (bits >> 8) & 1;
  for (let i = 9; i < 15; i += 1) m.modules[8][14 - i] = (bits >> i) & 1;

  // Second copy: bits 0-7 along row 8 from the right edge, bits 8-14 up
  // column 8 from the bottom.
  for (let i = 0; i < 8; i += 1) m.modules[8][m.size - 1 - i] = (bits >> i) & 1;
  for (let i = 8; i < 15; i += 1) m.modules[m.size - 15 + i][8] = (bits >> i) & 1;

  m.modules[m.size - 8][8] = 1;
}

/** Lay the codeword bits out in the two-column zigzag, skipping function modules. */
function placeData(m, codewords) {
  let bit = 0;
  const total = codewords.length * 8;
  let upward = true;

  for (let right = m.size - 1; right >= 1; right -= 2) {
    // Column 6 is the vertical timing pattern; the zigzag steps over it.
    if (right === 6) right = 5;
    for (let step = 0; step < m.size; step += 1) {
      const row = upward ? m.size - 1 - step : step;
      for (let c = 0; c < 2; c += 1) {
        const col = right - c;
        if (m.reserved[row][col]) continue;
        let value = 0;
        if (bit < total) {
          value = (codewords[bit >> 3] >> (7 - (bit & 7))) & 1;
          bit += 1;
        }
        m.modules[row][col] = value;
      }
    }
    upward = !upward;
  }
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function applyMask(m, mask) {
  const fn = MASKS[mask];
  for (let row = 0; row < m.size; row += 1) {
    for (let col = 0; col < m.size; col += 1) {
      if (m.reserved[row][col]) continue;
      if (fn(row, col)) m.modules[row][col] ^= 1;
    }
  }
}

/** The four penalty rules; the mask with the lowest total wins. */
function penalty(m) {
  const { size, modules } = m;
  let score = 0;

  // Rule 1 — runs of five or more of the same colour.
  const runs = (get) => {
    for (let a = 0; a < size; a += 1) {
      let run = 1;
      for (let b = 1; b < size; b += 1) {
        if (get(a, b) === get(a, b - 1)) {
          run += 1;
        } else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
  };
  runs((a, b) => modules[a][b]);
  runs((a, b) => modules[b][a]);

  // Rule 2 — 2x2 blocks of one colour.
  for (let row = 0; row < size - 1; row += 1) {
    for (let col = 0; col < size - 1; col += 1) {
      const v = modules[row][col];
      if (v === modules[row][col + 1] && v === modules[row + 1][col] && v === modules[row + 1][col + 1]) {
        score += 3;
      }
    }
  }

  // Rule 3 — finder-like 1:1:3:1:1 patterns with four light modules beside them.
  const A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const matches = (get, a, start, pattern) => {
    for (let i = 0; i < 11; i += 1) if (get(a, start + i) !== pattern[i]) return false;
    return true;
  };
  for (const get of [(a, b) => modules[a][b], (a, b) => modules[b][a]]) {
    for (let a = 0; a < size; a += 1) {
      for (let start = 0; start <= size - 11; start += 1) {
        if (matches(get, a, start, A)) score += 40;
        if (matches(get, a, start, B)) score += 40;
      }
    }
  }

  // Rule 4 — how far the dark proportion strays from half.
  let dark = 0;
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) dark += modules[row][col];
  }
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

/**
 * Encode text as a QR code.
 * Returns { version, size, modules } where modules[row][col] is 0 or 1.
 * Pass `mask` to force one of the eight patterns; otherwise the best is chosen.
 */
export function encodeQr(text, options = {}) {
  const bytes = new TextEncoder().encode(String(text));
  const version = chooseVersion(bytes.length);
  if (version === null) {
    throw new Error(`Too much data for a QR code: ${bytes.length} bytes, limit ${MAX_BYTES}.`);
  }

  const codewords = buildCodewords(bytes, version);
  const size = 17 + version * 4;

  const build = (mask) => {
    const m = blankMatrix(size);
    placeFunctionPatterns(m, version);
    placeData(m, codewords);
    applyMask(m, mask);
    placeFormatInfo(m, mask);
    return m;
  };

  if (typeof options.mask === 'number') {
    const m = build(options.mask);
    return { version, size, modules: m.modules };
  }

  let best = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask += 1) {
    const candidate = build(mask);
    const score = penalty(candidate);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return { version, size, modules: best.modules };
}

/**
 * The masking penalty for a finished symbol. Exposed for tools/qr-verify.py,
 * which checks it against a reference implementation's scoring.
 */
export function penaltyScore(qr) {
  return penalty({ size: qr.size, modules: qr.modules });
}

/**
 * Render a QR code as an SVG string. `quiet` is the light margin in modules —
 * the specification asks for four, and scanners genuinely need it.
 */
export function toSvg(qr, { quiet = 4, dark = '#000000', light = '#ffffff' } = {}) {
  const total = qr.size + quiet * 2;
  const parts = [];
  for (let row = 0; row < qr.size; row += 1) {
    for (let col = 0; col < qr.size; col += 1) {
      if (qr.modules[row][col]) parts.push(`M${col + quiet} ${row + quiet}h1v1h-1z`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" `
    + `shape-rendering="crispEdges" role="img">`
    + `<rect width="${total}" height="${total}" fill="${light}"/>`
    + `<path fill="${dark}" d="${parts.join('')}"/>`
    + `</svg>`;
}

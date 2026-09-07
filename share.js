/**
 * Cricket Scorer — shareable match links.
 *
 * Packs a whole match into a compact byte string so it can ride in a URL
 * fragment. Fragments are never sent to the server, so a shared match stays
 * between the people holding the link.
 *
 * A 20-over innings is ~120 deliveries at 2 bytes each, so a full match lands
 * around 400 characters of base64url — short enough for a text message.
 *
 * Pure: no DOM, no I/O. Tested in Node alongside the engine.
 */

import { battingTeamFor, wicketsAllowed } from './engine.js';

/** Bump only for an incompatible layout change; the decoder checks it. */
export const SHARE_FORMAT = 1;

const MAX_TEAM_NAME = 48;

// Index order is part of the wire format — append, never reorder.
const TYPES = ['legal', 'wide', 'noball'];
const EXTRA_KINDS = [null, 'bye', 'legbye'];

/* ------------------------------------------------------------------ *
 * base64url
 * ------------------------------------------------------------------ */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const LOOKUP = new Map([...ALPHABET].map((char, index) => [char, index]));

/** Bytes to unpadded base64url — URL-safe, so no escaping in a fragment. */
export function toBase64Url(bytes) {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += ALPHABET[(buffer >> bits) & 63];
    }
  }
  if (bits > 0) out += ALPHABET[(buffer << (6 - bits)) & 63];
  return out;
}

export function fromBase64Url(text) {
  const bytes = [];
  let buffer = 0;
  let bits = 0;
  for (const char of text) {
    const value = LOOKUP.get(char);
    if (value === undefined) throw new Error('That link contains characters we do not recognise.');
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(bytes);
}

/* ------------------------------------------------------------------ *
 * Deliveries — 16 bits each
 * ------------------------------------------------------------------ */

//  bits 0-1  type        bits 2-5  bat runs     bits 6-9  extra runs
//  bits 10-11 extra kind bit 12    wicket       bits 13-15 spare
function packDelivery(delivery) {
  const type = TYPES.indexOf(delivery.type);
  const kind = EXTRA_KINDS.indexOf(delivery.extraKind ?? null);
  if (type < 0) throw new Error('Unknown delivery type: ' + delivery.type);
  return (type & 3)
    | ((Math.min(15, delivery.batRuns) & 15) << 2)
    | ((Math.min(15, delivery.extraRuns) & 15) << 6)
    | ((Math.max(0, kind) & 3) << 10)
    | ((delivery.wicket ? 1 : 0) << 12);
}

function unpackDelivery(word) {
  return {
    type: TYPES[word & 3],
    batRuns: (word >> 2) & 15,
    extraRuns: (word >> 6) & 15,
    extraKind: EXTRA_KINDS[(word >> 10) & 3],
    wicket: ((word >> 12) & 1) === 1,
  };
}

/* ------------------------------------------------------------------ *
 * Checksum — so a truncated link fails loudly instead of decoding to junk
 * ------------------------------------------------------------------ */

function checksum(bytes) {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash & 0xff;
}

/* ------------------------------------------------------------------ *
 * Encode
 * ------------------------------------------------------------------ */

function writeString(bytes, text) {
  const encoded = new TextEncoder().encode(String(text ?? '').slice(0, MAX_TEAM_NAME));
  bytes.push(encoded.length);
  for (const byte of encoded) bytes.push(byte);
}

function writeU16(bytes, value) {
  bytes.push((value >> 8) & 0xff, value & 0xff);
}

/** Pack a match into a base64url string. */
export function encodeMatch(match) {
  const { config, innings } = match;
  const hasSecond = innings.length > 1;
  const toss = config.toss ?? null;

  const flags = (match.current === 1 ? 1 : 0)
    | (innings[0].closed ? 2 : 0)
    | (hasSecond && innings[1].closed ? 4 : 0)
    | (hasSecond ? 8 : 0)
    | (toss ? 16 : 0)
    | (config.battingFirst === 'B' ? 32 : 0)
    // Bit 6 was spare, so links made before single batting existed decode as
    // false — which is exactly the behaviour they were made under.
    | (config.lastBatterStands ? 64 : 0);

  const bytes = [
    SHARE_FORMAT,
    flags,
    Math.min(255, config.oversPerInnings),
    Math.min(255, config.playersPerSide),
    toss
      ? (toss.coin === 'tails' ? 1 : 0)
        | (toss.winner === 'B' ? 2 : 0)
        | (toss.decision === 'bowl' ? 4 : 0)
      : 0,
  ];

  writeString(bytes, config.teamA);
  writeString(bytes, config.teamB);

  for (let index = 0; index < (hasSecond ? 2 : 1); index += 1) {
    const deliveries = innings[index].deliveries;
    writeU16(bytes, deliveries.length);
    for (const delivery of deliveries) writeU16(bytes, packDelivery(delivery));
  }

  bytes.push(checksum(bytes));
  return toBase64Url(bytes);
}

/* ------------------------------------------------------------------ *
 * Decode
 * ------------------------------------------------------------------ */

/** Unpack a base64url string back into a match. Throws on anything malformed. */
export function decodeMatch(text) {
  const trimmed = String(text ?? '').trim();
  if (trimmed.length === 0) throw new Error('That link has no match in it.');

  const bytes = fromBase64Url(trimmed);
  if (bytes.length < 9) throw new Error('That link is too short to be a match.');

  const body = bytes.subarray(0, bytes.length - 1);
  if (checksum(body) !== bytes[bytes.length - 1]) {
    throw new Error('That link looks damaged — it may have been cut short when it was copied.');
  }

  let at = 0;
  const u8 = () => {
    if (at >= body.length) throw new Error('That link ended unexpectedly.');
    return body[at++];
  };
  const u16 = () => (u8() << 8) | u8();
  const str = () => {
    const length = u8();
    if (at + length > body.length) throw new Error('That link ended unexpectedly.');
    const value = new TextDecoder().decode(body.subarray(at, at + length));
    at += length;
    return value;
  };

  const format = u8();
  if (format !== SHARE_FORMAT) {
    throw new Error(`That link was made by a different version of the app (format ${format}).`);
  }

  const flags = u8();
  const hasSecond = (flags & 8) !== 0;
  const hasToss = (flags & 16) !== 0;

  const oversPerInnings = u8();
  const playersPerSide = u8();
  const tossByte = u8();

  const teamA = str();
  const teamB = str();

  const config = {
    teamA,
    teamB,
    oversPerInnings,
    playersPerSide,
    battingFirst: (flags & 32) !== 0 ? 'B' : 'A',
    lastBatterStands: (flags & 64) !== 0,
    toss: hasToss
      ? {
        coin: (tossByte & 1) !== 0 ? 'tails' : 'heads',
        winner: (tossByte & 2) !== 0 ? 'B' : 'A',
        decision: (tossByte & 4) !== 0 ? 'bowl' : 'bat',
      }
      : null,
  };

  if (config.oversPerInnings < 1 || wicketsAllowed(config) < 1) {
    throw new Error('That link describes a match that could not be played.');
  }

  const readInnings = (index, closed) => {
    const count = u16();
    // A delivery is two bytes; anything larger than the remaining buffer means
    // the link was truncated in a way the checksum happened not to catch.
    if (at + count * 2 > body.length) throw new Error('That link ended unexpectedly.');
    const deliveries = [];
    for (let i = 0; i < count; i += 1) deliveries.push(unpackDelivery(u16()));
    return { battingTeam: battingTeamFor(config, index), deliveries, closed };
  };

  const innings = [readInnings(0, (flags & 2) !== 0)];
  if (hasSecond) innings.push(readInnings(1, (flags & 4) !== 0));

  return {
    version: 1,
    config,
    innings,
    current: (flags & 1) !== 0 && hasSecond ? 1 : 0,
  };
}

/* ------------------------------------------------------------------ *
 * URLs
 * ------------------------------------------------------------------ */

/**
 * Build a shareable link. The match rides in the fragment, which browsers
 * never transmit — so the scorecard never reaches the host serving the app.
 */
export function shareUrl(match, baseUrl) {
  const url = new URL(baseUrl);
  url.hash = 'm=' + encodeMatch(match);
  return url.toString();
}

/** Pull the match payload out of a location hash, or null if there isn't one. */
export function payloadFromHash(hash) {
  const raw = String(hash ?? '').replace(/^#/, '');
  if (raw.length === 0) return null;
  const params = new URLSearchParams(raw);
  return params.get('m');
}

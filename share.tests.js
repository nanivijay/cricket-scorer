/**
 * Round-trip tests for share.js.
 *
 * A shared link is a one-way door — whoever opens it gets whatever we encoded,
 * with no way to check it against the original. So these assertions care about
 * two things: that a match survives the round trip exactly, and that a damaged
 * link fails loudly instead of quietly decoding into a wrong scorecard.
 */

import {
  applyDelivery,
  closeInnings,
  createMatch,
  summarizeInnings,
  targetFor,
} from './engine.js';

import {
  SHARE_FORMAT,
  decodeMatch,
  encodeMatch,
  fromBase64Url,
  payloadFromHash,
  shareUrl,
  toBase64Url,
} from './share.js';

const suite = [];
const test = (name, fn) => suite.push({ name, fn });

function eq(actual, expected, what = 'value') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what}: expected ${e}, got ${a}`);
}

function ok(condition, what = 'condition') {
  if (!condition) throw new Error(`${what}: expected truthy`);
}

function throws(fn, what = 'call') {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(`${what}: expected it to throw`);
}

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const bat = (batRuns) => ({ type: 'legal', batRuns });
const dot = bat(0);
const play = (m, ...specs) => specs.reduce((acc, spec) => applyDelivery(acc, spec), m);

/** A match with one of every kind of delivery in it. */
function busyMatch() {
  let m = createMatch({
    teamA: 'Riverside CC',
    teamB: 'Old Foresters',
    oversPerInnings: 12,
    playersPerSide: 11,
    battingFirst: 'B',
    toss: { coin: 'tails', winner: 'A', decision: 'bowl' },
  });
  return play(
    m,
    bat(1), bat(4), dot, bat(6), bat(2), bat(3),
    { type: 'wide' },
    { type: 'wide', extraRuns: 4 },
    { type: 'wide', extraRuns: 1, wicket: true },
    { type: 'noball' },
    { type: 'noball', batRuns: 6 },
    { type: 'noball', extraRuns: 2, extraKind: 'bye' },
    { type: 'noball', batRuns: 1, wicket: true },
    { type: 'legal', extraRuns: 2, extraKind: 'bye' },
    { type: 'legal', extraRuns: 3, extraKind: 'legbye' },
    { type: 'legal', extraRuns: 1, extraKind: 'legbye', wicket: true },
    { type: 'legal', wicket: true },
    { type: 'legal', batRuns: 2, wicket: true },
  );
}

/** Everything a viewer would see, so a round trip can be compared wholesale. */
function snapshot(match) {
  return {
    config: match.config,
    current: match.current,
    innings: match.innings.map((innings, index) => {
      const s = summarizeInnings(match, index);
      return {
        battingTeam: innings.battingTeam,
        closed: innings.closed,
        deliveries: innings.deliveries,
        runs: s.runs,
        wickets: s.wickets,
        extras: s.extras,
        overs: s.oversText,
      };
    }),
  };
}

const roundTrip = (match) => decodeMatch(encodeMatch(match));

/* ------------------------------------------------------------------ *
 * base64url
 * ------------------------------------------------------------------ */

test('base64url survives every byte value', () => {
  const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
  eq([...fromBase64Url(toBase64Url(bytes))], [...bytes], 'bytes');
});

test('base64url uses no characters that need escaping in a URL', () => {
  const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
  const text = toBase64Url(bytes);
  eq(encodeURIComponent(text), text, 'url-safe text');
});

test('base64url handles every input length remainder', () => {
  for (let length = 0; length <= 8; length += 1) {
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 37) & 0xff);
    eq([...fromBase64Url(toBase64Url(bytes))], [...bytes], `length ${length}`);
  }
});

/* ------------------------------------------------------------------ *
 * Round trips
 * ------------------------------------------------------------------ */

test('a fresh match survives the round trip', () => {
  const m = createMatch({ teamA: 'A', teamB: 'B', oversPerInnings: 5, playersPerSide: 8 });
  eq(snapshot(roundTrip(m)), snapshot(m), 'snapshot');
});

test('every kind of delivery survives the round trip', () => {
  const m = busyMatch();
  eq(snapshot(roundTrip(m)), snapshot(m), 'snapshot');
});

test('the decoded match scores identically', () => {
  const m = busyMatch();
  const decoded = roundTrip(m);
  const before = summarizeInnings(m, 0);
  const after = summarizeInnings(decoded, 0);
  eq([after.runs, after.wickets, after.extras, after.legalBalls],
     [before.runs, before.wickets, before.extras, before.legalBalls],
     'runs, wickets, extras, balls');
});

test('a match in its second innings survives, target and all', () => {
  let m = busyMatch();
  m = closeInnings(m);
  m = play(m, bat(4), { type: 'wide', extraRuns: 4 }, bat(1));
  const decoded = roundTrip(m);
  eq(decoded.current, 1, 'still in the chase');
  eq(decoded.innings.length, 2, 'both innings present');
  eq(targetFor(decoded), targetFor(m), 'target');
  eq(snapshot(decoded), snapshot(m), 'snapshot');
});

test('an innings closed by hand stays closed', () => {
  const m = closeInnings(play(createMatch({ oversPerInnings: 10 }), bat(4)));
  const decoded = roundTrip(m);
  eq(decoded.innings[0].closed, true, 'first innings closed');
  eq(decoded.current, 1, 'moved on');
});

test('the toss survives, including who won and what they chose', () => {
  for (const coin of ['heads', 'tails']) {
    for (const winner of ['A', 'B']) {
      for (const decision of ['bat', 'bowl']) {
        const m = createMatch({ toss: { coin, winner, decision } });
        eq(roundTrip(m).config.toss, { coin, winner, decision }, `${coin}/${winner}/${decision}`);
      }
    }
  }
});

test('a match with no toss decodes with no toss', () => {
  eq(roundTrip(createMatch({})).config.toss, null, 'toss');
});

test('who bats first survives both ways round', () => {
  for (const battingFirst of ['A', 'B']) {
    const m = createMatch({ teamA: 'Alpha', teamB: 'Beta', battingFirst });
    const decoded = roundTrip(m);
    eq(decoded.config.battingFirst, battingFirst, 'batting first');
    eq(decoded.innings[0].battingTeam, battingFirst === 'B' ? 'Beta' : 'Alpha', 'innings label');
  }
});

test('overs and squad size survive, including odd ones', () => {
  for (const [overs, players] of [[1, 2], [5, 8], [16, 11], [50, 15], [99, 3]]) {
    const decoded = roundTrip(createMatch({ oversPerInnings: overs, playersPerSide: players }));
    eq([decoded.config.oversPerInnings, decoded.config.playersPerSide], [overs, players], 'config');
  }
});

test('team names survive spaces, punctuation and non-ASCII', () => {
  const names = ['Riverside CC', "St. Mary's XI", 'Café XI', 'Mumbai इंडियंस', '⚡ Lightning'];
  for (const teamA of names) {
    const decoded = roundTrip(createMatch({ teamA, teamB: 'Other' }));
    eq(decoded.config.teamA, teamA, `name ${teamA}`);
  }
});

test('an over-long team name is truncated, not corrupted', () => {
  const decoded = roundTrip(createMatch({ teamA: 'x'.repeat(200) }));
  ok(decoded.config.teamA.length <= 48, 'name length capped');
  ok(decoded.config.teamA.startsWith('xxx'), 'name still readable');
});

/* ------------------------------------------------------------------ *
 * Size — a link nobody can send is no use
 * ------------------------------------------------------------------ */

test('a full 20-over innings fits comfortably in a URL', () => {
  let m = createMatch({ teamA: 'Riverside CC', teamB: 'Old Foresters', oversPerInnings: 20 });
  // 120 legal balls plus a scattering of extras, as a real innings would have.
  for (let i = 0; i < 120; i += 1) {
    m = applyDelivery(m, bat(i % 7));
    if (i % 10 === 0) m = applyDelivery(m, { type: 'wide', extraRuns: 1 });
  }
  const encoded = encodeMatch(m);
  ok(encoded.length < 800, `encoded length ${encoded.length} should be under 800 chars`);
  const url = shareUrl(m, 'https://nanivijay.github.io/cricket-scorer/');
  ok(url.length < 900, `url length ${url.length} should be under 900 chars`);
});

test('a completed two-innings match still fits', () => {
  let m = createMatch({ teamA: 'Riverside CC', teamB: 'Old Foresters', oversPerInnings: 20 });
  for (let i = 0; i < 120; i += 1) m = applyDelivery(m, bat(i % 7));
  for (let i = 0; i < 120; i += 1) m = applyDelivery(m, bat(i % 5));
  ok(encodeMatch(m).length < 1200, 'encoded length under 1200 chars');
});

/* ------------------------------------------------------------------ *
 * Damaged links must fail loudly
 * ------------------------------------------------------------------ */

test('an empty payload is rejected', () => {
  throws(() => decodeMatch(''), 'empty');
  throws(() => decodeMatch(null), 'null');
});

test('junk is rejected', () => {
  throws(() => decodeMatch('not a real payload!!'), 'junk with illegal characters');
  throws(() => decodeMatch('AAAA'), 'too short');
});

test('a truncated link is rejected rather than decoded as a shorter match', () => {
  const encoded = encodeMatch(busyMatch());
  for (const cut of [1, 3, 10, 25]) {
    throws(() => decodeMatch(encoded.slice(0, -cut)), `truncated by ${cut}`);
  }
});

test('a single flipped character is caught by the checksum', () => {
  const encoded = encodeMatch(busyMatch());
  let caught = 0;
  const positions = [0, 5, 12, 30, encoded.length - 2];
  for (const at of positions) {
    const swapped = encoded[at] === 'A' ? 'B' : 'A';
    const damaged = encoded.slice(0, at) + swapped + encoded.slice(at + 1);
    try {
      decodeMatch(damaged);
    } catch {
      caught += 1;
    }
  }
  ok(caught === positions.length, `caught ${caught} of ${positions.length} single-character changes`);
});

test('a link from a future format is refused with a clear reason', () => {
  const bytes = fromBase64Url(encodeMatch(createMatch({})));
  bytes[0] = SHARE_FORMAT + 1;
  // Re-checksum so it fails on the format check, not the checksum.
  let hash = 0x811c9dc5;
  for (const byte of bytes.subarray(0, bytes.length - 1)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  bytes[bytes.length - 1] = hash & 0xff;
  try {
    decodeMatch(toBase64Url(bytes));
    throw new Error('expected it to throw');
  } catch (error) {
    ok(/different version/i.test(error.message), `message was: ${error.message}`);
  }
});

/* ------------------------------------------------------------------ *
 * URLs
 * ------------------------------------------------------------------ */

test('the payload rides in the fragment, which never reaches the server', () => {
  const url = new URL(shareUrl(busyMatch(), 'https://example.test/cricket-scorer/'));
  ok(url.hash.startsWith('#m='), 'fragment carries the match');
  eq(url.search, '', 'query string stays empty');
  eq(url.pathname, '/cricket-scorer/', 'path untouched');
});

test('a share link decodes back to the same match', () => {
  const m = busyMatch();
  const url = new URL(shareUrl(m, 'https://example.test/app/'));
  eq(snapshot(decodeMatch(payloadFromHash(url.hash))), snapshot(m), 'snapshot');
});

test('a hash with no match in it yields nothing', () => {
  eq(payloadFromHash(''), null, 'empty');
  eq(payloadFromHash('#'), null, 'bare hash');
  eq(payloadFromHash('#other=1'), null, 'unrelated fragment');
});

test('the payload is found alongside other fragment parameters', () => {
  const m = createMatch({ teamA: 'Alpha' });
  const payload = encodeMatch(m);
  eq(decodeMatch(payloadFromHash(`#x=1&m=${payload}&y=2`)).config.teamA, 'Alpha', 'team name');
});

/* ------------------------------------------------------------------ *
 * Runner
 * ------------------------------------------------------------------ */

export function runShareTests() {
  return suite.map(({ name, fn }) => {
    try {
      fn();
      return { name, ok: true, error: null };
    } catch (error) {
      return { name, ok: false, error: error.message };
    }
  });
}

if (typeof window === 'undefined' && typeof process !== 'undefined') {
  const results = runShareTests();
  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n        ${r.error}`}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} passing`);
  if (failed.length > 0) process.exitCode = 1;
}

/**
 * Scoring-law tests for engine.js.
 *
 * Zero dependencies. Runs two ways:
 *   - in the browser, via tests.html
 *   - at a terminal, via `node tests.js`
 *
 * These assertions are the contract for the two bugs this app exists to fix:
 * extras that carry runs, and a configurable match length.
 */

import {
  BALLS_PER_OVER,
  applyDelivery,
  battingTeamFor,
  chaseState,
  closeInnings,
  createMatch,
  deliveryLabel,
  formatOvers,
  groupOvers,
  isMatchOver,
  makeDelivery,
  result,
  summarizeInnings,
  targetFor,
  undo,
  updateConfig,
  wicketsAllowed,
} from './engine.js';

/* ------------------------------------------------------------------ *
 * Tiny harness
 * ------------------------------------------------------------------ */

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

function close(actual, expected, what = 'value', tolerance = 0.005) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${what}: expected ~${expected}, got ${actual}`);
  }
}

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const match = (config) => createMatch({ oversPerInnings: 20, playersPerSide: 11, ...config });

/** Apply a list of delivery specs in order. */
const play = (m, ...specs) => specs.reduce((acc, spec) => applyDelivery(acc, spec), m);

const dot = { type: 'legal', batRuns: 0 };
const bat = (batRuns) => ({ type: 'legal', batRuns });

/** Summary of whichever innings is live. */
const live = (m) => summarizeInnings(m, m.current);
/** Summary of innings 0, regardless of where we are now. */
const first = (m) => summarizeInnings(m, 0);

/* ------------------------------------------------------------------ *
 * Runs off the bat and byes on a legal delivery
 * ------------------------------------------------------------------ */

test('four off the bat scores 4, no extras, one legal ball', () => {
  const s = live(play(match(), bat(4)));
  eq(s.runs, 4, 'runs');
  eq(s.extras, 0, 'extras');
  eq(s.legalBalls, 1, 'legal balls');
});

test('two byes score 2, all to extras, and still count as a legal ball', () => {
  const s = live(play(match(), { type: 'legal', extraRuns: 2, extraKind: 'bye' }));
  eq(s.runs, 2, 'runs');
  eq(s.extras, 2, 'extras');
  eq(s.legalBalls, 1, 'legal balls');
});

test('leg byes behave like byes for the team total', () => {
  const s = live(play(match(), { type: 'legal', extraRuns: 3, extraKind: 'legbye' }));
  eq(s.runs, 3, 'runs');
  eq(s.extras, 3, 'extras');
  eq(s.legalBalls, 1, 'legal balls');
});

/* ------------------------------------------------------------------ *
 * FLAW #1 — extras that carry runs
 * ------------------------------------------------------------------ */

test('a plain wide is 1 run and does not count as a ball', () => {
  const s = live(play(match(), { type: 'wide' }));
  eq(s.runs, 1, 'runs');
  eq(s.extras, 1, 'extras');
  eq(s.legalBalls, 0, 'legal balls');
});

test('a wide to the boundary is 5 runs, all extras, still no ball counted', () => {
  const s = live(play(match(), { type: 'wide', extraRuns: 4 }));
  eq(s.runs, 5, 'runs');
  eq(s.extras, 5, 'extras');
  eq(s.legalBalls, 0, 'legal balls');
});

test('a wide with two runs run is 3 runs', () => {
  const s = live(play(match(), { type: 'wide', extraRuns: 2 }));
  eq(s.runs, 3, 'runs');
  eq(s.extras, 3, 'extras');
});

test('no runs can be scored off the bat on a wide', () => {
  const delivery = makeDelivery({ type: 'wide', batRuns: 4 });
  eq(delivery.batRuns, 0, 'bat runs on a wide');
});

test('a plain no-ball is 1 run and does not count as a ball', () => {
  const s = live(play(match(), { type: 'noball' }));
  eq(s.runs, 1, 'runs');
  eq(s.extras, 1, 'extras');
  eq(s.legalBalls, 0, 'legal balls');
});

test('a no-ball hit for six is 7 runs, of which only 1 is an extra', () => {
  const s = live(play(match(), { type: 'noball', batRuns: 6 }));
  eq(s.runs, 7, 'runs');
  eq(s.extras, 1, 'extras');
  eq(s.legalBalls, 0, 'legal balls');
});

test('a no-ball with two byes is 3 runs, all of them extras', () => {
  const s = live(play(match(), { type: 'noball', extraRuns: 2, extraKind: 'bye' }));
  eq(s.runs, 3, 'runs');
  eq(s.extras, 3, 'extras');
  eq(s.legalBalls, 0, 'legal balls');
});

/* ------------------------------------------------------------------ *
 * Wickets
 * ------------------------------------------------------------------ */

test('a wicket on a legal ball takes a wicket and uses up the ball', () => {
  const s = live(play(match(), { type: 'legal', wicket: true }));
  eq(s.wickets, 1, 'wickets');
  eq(s.legalBalls, 1, 'legal balls');
});

test('a run out on a wide takes a wicket but does not use up a ball', () => {
  const s = live(play(match(), { type: 'wide', extraRuns: 1, wicket: true }));
  eq(s.wickets, 1, 'wickets');
  eq(s.runs, 2, 'runs');
  eq(s.legalBalls, 0, 'legal balls');
});

test('a run out on a no-ball still credits the runs completed', () => {
  const s = live(play(match(), { type: 'noball', batRuns: 1, wicket: true }));
  eq(s.wickets, 1, 'wickets');
  eq(s.runs, 2, 'runs');
  eq(s.legalBalls, 0, 'legal balls');
});

/* ------------------------------------------------------------------ *
 * Overs
 * ------------------------------------------------------------------ */

test('an over advances only after six legal balls, however many wides intervene', () => {
  const m = play(
    match(),
    { type: 'wide' }, { type: 'wide' }, { type: 'wide' },
    dot, dot, dot, dot, dot, dot,
  );
  const s = live(m);
  eq(s.legalBalls, 6, 'legal balls');
  eq(s.oversText, '1.0', 'overs text');
  eq(s.runs, 3, 'runs');
});

test('the over strip keeps every delivery, legal or not', () => {
  const overs = groupOvers([
    { type: 'wide', batRuns: 0, extraRuns: 0 },
    ...Array.from({ length: 6 }, () => ({ type: 'legal', batRuns: 1, extraRuns: 0 })),
    { type: 'legal', batRuns: 2, extraRuns: 0 },
  ]);
  eq(overs.length, 2, 'over count');
  eq(overs[0].length, 7, 'deliveries in over 1');
  eq(overs[1].length, 1, 'deliveries in over 2');
});

test('overs are formatted as completed.balls', () => {
  eq(formatOvers(0), '0.0', 'no balls');
  eq(formatOvers(7), '1.1', 'seven balls');
  eq(formatOvers(44), '7.2', 'forty-four balls');
});

/* ------------------------------------------------------------------ *
 * FLAW #2 — configurable match length
 * ------------------------------------------------------------------ */

test('match length comes from config, not a hardcoded 16 overs', () => {
  eq(live(match({ oversPerInnings: 5 })).totalBalls, 30, 'balls in a 5-over match');
  eq(live(match({ oversPerInnings: 16 })).totalBalls, 96, 'balls in a 16-over match');
  eq(live(match({ oversPerInnings: 50 })).totalBalls, 300, 'balls in a 50-over match');
});

test('a one-over innings ends after six legal balls', () => {
  const m = play(match({ oversPerInnings: 1 }), dot, dot, dot, dot, dot, bat(1));
  ok(first(m).isComplete, 'first innings complete');
  eq(m.current, 1, 'moved to the second innings');
});

/* ------------------------------------------------------------------ *
 * Player count drives when a side is all out
 * ------------------------------------------------------------------ */

test('eleven a side means all out at ten wickets', () => {
  eq(wicketsAllowed({ playersPerSide: 11 }), 10, 'wickets allowed');
});

test('a short side is all out sooner', () => {
  eq(wicketsAllowed({ playersPerSide: 8 }), 7, 'wickets allowed');
  eq(wicketsAllowed({ playersPerSide: 2 }), 1, 'wickets allowed');
});

test('the innings ends when the last wicket falls', () => {
  const out = { type: 'legal', wicket: true };
  const m = play(match({ playersPerSide: 3 }), out, out);
  ok(first(m).allOut, 'all out');
  eq(m.current, 1, 'moved to the second innings');
});

/* ------------------------------------------------------------------ *
 * Mid-match config changes
 * ------------------------------------------------------------------ */

test('cutting the overs mid-innings ends it immediately', () => {
  let m = play(match({ oversPerInnings: 20 }), dot, dot, dot, dot, dot, dot);
  eq(m.current, 0, 'still in the first innings');
  m = updateConfig(m, { oversPerInnings: 1 });
  ok(first(m).isComplete, 'first innings complete after the cut');
  eq(m.current, 1, 'moved to the second innings');
});

test('cutting the overs below balls already bowled leaves no balls remaining', () => {
  let m = play(match({ oversPerInnings: 20 }), ...Array.from({ length: 12 }, () => dot));
  m = updateConfig(m, { oversPerInnings: 1 });
  eq(first(m).ballsLeft, 0, 'balls left');
  eq(first(m).legalBalls, 12, 'balls actually bowled are not lost');
});

test('restoring the overs before the chase starts reopens the first innings', () => {
  let m = play(match({ oversPerInnings: 20 }), dot, dot, dot, dot, dot, dot);
  m = updateConfig(m, { oversPerInnings: 1 });
  eq(m.current, 1, 'in the second innings');
  m = updateConfig(m, { oversPerInnings: 20 });
  eq(m.current, 0, 'back in the first innings');
  eq(m.innings.length, 1, 'the empty second innings was discarded');
  eq(first(m).legalBalls, 6, 'deliveries survived the round trip');
});

test('restoring the overs after the chase has started does not rewind the match', () => {
  let m = play(match({ oversPerInnings: 20 }), dot, dot, dot, dot, dot, dot);
  m = updateConfig(m, { oversPerInnings: 1 });
  m = play(m, bat(1));
  m = updateConfig(m, { oversPerInnings: 20 });
  eq(m.current, 1, 'still in the second innings');
  ok(first(m).isComplete, 'the first innings stays closed');
  eq(summarizeInnings(m, 1).runs, 1, 'the chase is intact');
});

test('shrinking the side mid-innings can bowl it out on the spot', () => {
  const out = { type: 'legal', wicket: true };
  let m = play(match({ playersPerSide: 11 }), out, out, out, out, out);
  eq(m.current, 0, 'still batting');
  m = updateConfig(m, { playersPerSide: 6 });
  ok(first(m).allOut, 'all out at five wickets');
  eq(m.current, 1, 'moved to the second innings');
});

test('renaming a team relabels the innings', () => {
  let m = match({ teamA: 'Team A', teamB: 'Team B' });
  m = updateConfig(m, { teamA: 'Wanderers' });
  eq(m.innings[0].battingTeam, 'Wanderers', 'innings label');
  eq(battingTeamFor(m.config, 1), 'Team B', 'other side');
});

/* ------------------------------------------------------------------ *
 * Undo
 * ------------------------------------------------------------------ */

test('undo removes the last delivery', () => {
  const m = undo(play(match(), bat(4), bat(6)));
  eq(live(m).runs, 4, 'runs');
  eq(live(m).legalBalls, 1, 'legal balls');
});

test('undo steps back across an over boundary', () => {
  let m = play(match(), dot, dot, dot, dot, dot, bat(2));
  eq(live(m).oversText, '1.0', 'over completed');
  m = undo(m);
  eq(live(m).oversText, '0.5', 'back into the over');
  eq(live(m).runs, 0, 'the two runs are gone');
});

test('undo steps back across an innings boundary', () => {
  let m = play(match({ oversPerInnings: 1 }), dot, dot, dot, dot, dot, bat(3));
  eq(m.current, 1, 'in the second innings');
  m = undo(m);
  eq(m.current, 0, 'back in the first innings');
  eq(m.innings.length, 1, 'the second innings was discarded');
  eq(first(m).legalBalls, 5, 'the last ball was removed');
  eq(first(m).runs, 0, 'and so were its runs');
});

test('undo reverses an innings closed by hand', () => {
  let m = closeInnings(play(match(), bat(1)));
  eq(m.current, 1, 'moved on');
  m = undo(m);
  eq(m.current, 0, 'back in the first innings');
  ok(!first(m).isComplete, 'innings is live again');
  eq(first(m).runs, 1, 'the delivery is still there');
});

test('undo on an untouched match is harmless', () => {
  const m = undo(match());
  eq(m.current, 0, 'innings index');
  eq(live(m).runs, 0, 'runs');
});

/* ------------------------------------------------------------------ *
 * Chase and result
 * ------------------------------------------------------------------ */

test('the chase panel reports what is needed and at what rate', () => {
  let m = play(match({ oversPerInnings: 2 }), bat(6), bat(6), dot, dot, dot, dot);
  m = closeInnings(m); // first innings: 12
  m = play(m, bat(2));
  const chase = chaseState(m);
  eq(chase.target, 13, 'target');
  eq(chase.needed, 11, 'runs needed');
  eq(chase.ballsLeft, 11, 'balls left');
  close(chase.requiredRate, 6, 'required rate');
});

test('the side batting second wins by wickets, with balls to spare', () => {
  let m = play(match({ oversPerInnings: 2, playersPerSide: 11 }), bat(4));
  m = closeInnings(m);
  m = play(m, bat(4), bat(1));
  ok(isMatchOver(m), 'match over');
  eq(result(m), 'Team B won by 10 wickets (10 balls left)', 'result');
});

test('the side batting first wins by runs', () => {
  let m = play(match({ oversPerInnings: 1 }), bat(6), bat(6), dot, dot, dot, dot);
  m = play(m, bat(1), dot, dot, dot, dot, dot);
  ok(isMatchOver(m), 'match over');
  eq(result(m), 'Team A won by 11 runs', 'result');
});

test('level scores are a tie', () => {
  let m = play(match({ oversPerInnings: 1 }), bat(4), dot, dot, dot, dot, dot);
  m = play(m, bat(4), dot, dot, dot, dot, dot);
  ok(isMatchOver(m), 'match over');
  eq(result(m), 'Match tied', 'result');
});

test('the result is withheld while the match is live', () => {
  eq(result(play(match(), bat(4))), null, 'result');
});

test('the target is one more than the first innings total', () => {
  const m = play(match(), bat(4), { type: 'wide', extraRuns: 2 });
  eq(targetFor(m), 8, 'target');
});

/* ------------------------------------------------------------------ *
 * Presentation and purity
 * ------------------------------------------------------------------ */

test('deliveries render the way a scorer writes them', () => {
  const label = (spec) => deliveryLabel(makeDelivery(spec));
  eq(label({ type: 'legal', batRuns: 0 }), '·', 'dot ball');
  eq(label({ type: 'legal', batRuns: 4 }), '4', 'boundary');
  eq(label({ type: 'wide' }), 'WD', 'wide');
  eq(label({ type: 'wide', extraRuns: 4 }), 'WD+4', 'wide to the fence');
  eq(label({ type: 'noball' }), 'NB', 'no-ball');
  eq(label({ type: 'noball', batRuns: 6 }), '6NB', 'no-ball hit for six');
  eq(label({ type: 'legal', extraRuns: 2, extraKind: 'bye' }), '2B', 'byes');
  eq(label({ type: 'legal', extraRuns: 1, extraKind: 'legbye' }), '1LB', 'leg byes');
  eq(label({ type: 'legal', wicket: true }), 'W', 'wicket off a dot ball');
  eq(label({ type: 'legal', batRuns: 1, wicket: true }), '1+W', 'run out going for a second');
  eq(label({ type: 'wide', extraRuns: 1, wicket: true }), 'WD+1+W', 'run out off a wide');
});

test('the run rate follows the balls actually bowled', () => {
  const m = play(match(), bat(4), bat(2), dot, dot, dot, dot);
  close(live(m).runRate, 6, 'run rate');
});

test('recording a delivery leaves the previous match untouched', () => {
  const before = play(match(), bat(4));
  const after = applyDelivery(before, bat(6));
  eq(summarizeInnings(before, 0).runs, 4, 'original is unchanged');
  eq(summarizeInnings(after, 0).runs, 10, 'new match has both');
});

test('an over is six balls', () => {
  eq(BALLS_PER_OVER, 6, 'balls per over');
});

/* ------------------------------------------------------------------ *
 * Runner
 * ------------------------------------------------------------------ */

export function runTests() {
  return suite.map(({ name, fn }) => {
    try {
      fn();
      return { name, ok: true, error: null };
    } catch (error) {
      return { name, ok: false, error: error.message };
    }
  });
}

// Terminal runner: `node tests.js`
if (typeof window === 'undefined' && typeof process !== 'undefined') {
  const results = runTests();
  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n        ${r.error}`}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} passing`);
  if (failed.length > 0) process.exitCode = 1;
}

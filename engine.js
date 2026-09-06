/**
 * Cricket Scorer — scoring engine.
 *
 * The entire match is an append-only log of deliveries. Every number shown in the
 * UI is derived by folding that log against the current config, so:
 *   - Undo is just "drop the last delivery"
 *   - no two statistics can drift apart
 *   - config (overs, players per side) can be edited mid-match and everything
 *     simply re-derives, which is exactly what a rain-reduced game needs.
 *
 * No dependencies, no build step. Loaded as a plain ES module by index.html and
 * exercised directly by tests.html.
 */

export const BALLS_PER_OVER = 6;

const clone = (value) =>
  typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));

/* ------------------------------------------------------------------ *
 * Deliveries
 * ------------------------------------------------------------------ */

/**
 * Build one delivery.
 *
 *   type      'legal' | 'wide' | 'noball'
 *   batRuns   runs off the bat. Never possible on a wide (Law 22.4), so forced to 0.
 *   extraRuns byes/leg-byes on a legal or no-ball delivery, or the additional runs
 *             run (or the boundary) off a wide — all of which are extras.
 *   extraKind 'bye' | 'legbye' | null. Descriptive only; a wide's extra runs are
 *             still scored as wides, so this stays null for them.
 *   wicket    a dismissal occurred on this delivery.
 */
export function makeDelivery(spec = {}) {
  const type = spec.type ?? 'legal';
  if (type !== 'legal' && type !== 'wide' && type !== 'noball') {
    throw new Error('Unknown delivery type: ' + type);
  }
  return {
    type,
    // Nothing can be scored off the bat on a wide — by definition it was out of reach.
    batRuns: type === 'wide' ? 0 : Math.max(0, spec.batRuns ?? 0),
    extraRuns: Math.max(0, spec.extraRuns ?? 0),
    extraKind: spec.extraKind ?? null,
    wicket: Boolean(spec.wicket),
  };
}

/** Wides and no-balls are re-bowled: they never advance the over. */
export function isLegalDelivery(delivery) {
  return delivery.type === 'legal';
}

/** The one-run penalty carried by every wide and no-ball. */
function penaltyRuns(delivery) {
  return delivery.type === 'legal' ? 0 : 1;
}

/** Runs credited to the batting side for this delivery, from every source. */
export function deliveryRuns(delivery) {
  return penaltyRuns(delivery) + delivery.batRuns + delivery.extraRuns;
}

/** The portion of those runs that are extras rather than runs off the bat. */
export function deliveryExtras(delivery) {
  return penaltyRuns(delivery) + delivery.extraRuns;
}

/* ------------------------------------------------------------------ *
 * Match construction and config
 * ------------------------------------------------------------------ */

export const DEFAULT_CONFIG = {
  teamA: 'Team A',
  teamB: 'Team B',
  oversPerInnings: 20,
  playersPerSide: 11,
  battingFirst: 'A',
  // Optional record of the toss: { coin: 'heads'|'tails', winner: 'A'|'B',
  // decision: 'bat'|'bowl' }. Purely descriptive — battingFirst is what the
  // scoring actually uses, so a match can be started without tossing at all.
  toss: null,
};

/**
 * A side is all out one wicket short of its player count — the last batter has
 * no partner. Floored at 1 so a nonsense player count can't wedge the innings.
 */
export function wicketsAllowed(config) {
  return Math.max(1, (config.playersPerSide ?? 11) - 1);
}

/** The side batting in the given innings index (0 or 1). */
export function battingTeamFor(config, index) {
  const first = config.battingFirst === 'B' ? config.teamB : config.teamA;
  const second = config.battingFirst === 'B' ? config.teamA : config.teamB;
  return index === 0 ? first : second;
}

export function createMatch(config = {}) {
  const merged = { ...DEFAULT_CONFIG, ...config };
  return {
    version: 1,
    config: merged,
    innings: [{ battingTeam: battingTeamFor(merged, 0), deliveries: [], closed: false }],
    current: 0,
  };
}

/* ------------------------------------------------------------------ *
 * Derived statistics
 * ------------------------------------------------------------------ */

/** "7.2" — completed overs, then legal balls into the current one. */
export function formatOvers(legalBalls) {
  const completed = Math.floor(legalBalls / BALLS_PER_OVER);
  return completed + '.' + (legalBalls % BALLS_PER_OVER);
}

/**
 * Split a delivery list into overs. An over closes only once six *legal* balls
 * have been bowled in it, so a wide-strewn over can hold far more than six entries.
 */
export function groupOvers(deliveries) {
  const overs = [];
  let current = [];
  let legal = 0;

  for (const delivery of deliveries) {
    current.push(delivery);
    if (isLegalDelivery(delivery)) {
      legal += 1;
      if (legal === BALLS_PER_OVER) {
        overs.push(current);
        current = [];
        legal = 0;
      }
    }
  }
  if (current.length > 0) overs.push(current);
  return overs;
}

/**
 * Fold one innings into everything the UI displays.
 * `target` is the score needed to win, or null in the first innings.
 */
export function summarize(innings, config, target = null) {
  let runs = 0;
  let extras = 0;
  let wickets = 0;
  let legalBalls = 0;

  for (const delivery of innings.deliveries) {
    runs += deliveryRuns(delivery);
    extras += deliveryExtras(delivery);
    if (delivery.wicket) wickets += 1;
    if (isLegalDelivery(delivery)) legalBalls += 1;
  }

  const maxWickets = wicketsAllowed(config);
  const totalBalls = config.oversPerInnings * BALLS_PER_OVER;
  // Overs can be cut mid-match, so balls already bowled may exceed the new limit.
  const ballsLeft = Math.max(0, totalBalls - legalBalls);
  const oversUsed = legalBalls / BALLS_PER_OVER;

  const oversExhausted = legalBalls >= totalBalls;
  const allOut = wickets >= maxWickets;
  const targetReached = target !== null && runs >= target;

  return {
    runs,
    extras,
    wickets,
    maxWickets,
    legalBalls,
    ballsLeft,
    totalBalls,
    oversText: formatOvers(legalBalls),
    runRate: oversUsed > 0 ? runs / oversUsed : 0,
    oversExhausted,
    allOut,
    targetReached,
    isComplete: oversExhausted || allOut || targetReached || innings.closed === true,
    overGroups: groupOvers(innings.deliveries),
  };
}

/** The score the chasing side must reach to win. */
export function targetFor(match) {
  return summarize(match.innings[0], match.config).runs + 1;
}

/** Summarise the innings at `index`, wiring up the target automatically. */
export function summarizeInnings(match, index) {
  const target = index === 1 ? targetFor(match) : null;
  return summarize(match.innings[index], match.config, target);
}

/** Chase maths for the second innings, or null if we aren't in one. */
export function chaseState(match) {
  if (match.current !== 1 || match.innings.length < 2) return null;
  const target = targetFor(match);
  const second = summarizeInnings(match, 1);
  const needed = Math.max(0, target - second.runs);
  const ballsLeft = second.ballsLeft;
  return {
    target,
    needed,
    ballsLeft,
    wicketsLeft: second.maxWickets - second.wickets,
    requiredRate: ballsLeft > 0 ? needed / (ballsLeft / BALLS_PER_OVER) : 0,
  };
}

/* ------------------------------------------------------------------ *
 * Transitions
 * ------------------------------------------------------------------ */

/**
 * Open the second innings if the first has just finished. Called after every
 * mutation so the match state is always self-consistent.
 */
function advanceIfNeeded(match) {
  if (match.current !== 0) return match;
  if (!summarizeInnings(match, 0).isComplete) return match;

  match.innings[1] = match.innings[1] ?? {
    battingTeam: battingTeamFor(match.config, 1),
    deliveries: [],
    closed: false,
  };
  match.current = 1;
  return match;
}

/** Record a delivery. Returns a new match; the input is untouched. */
export function applyDelivery(match, spec) {
  if (isMatchOver(match)) return match;
  const next = clone(match);
  next.innings[next.current].deliveries.push(makeDelivery(spec));
  return advanceIfNeeded(next);
}

/** Declare / retire the current innings closed without bowling it out. */
export function closeInnings(match) {
  if (isMatchOver(match)) return match;
  const next = clone(match);
  next.innings[next.current].closed = true;
  return advanceIfNeeded(next);
}

/**
 * Change match settings mid-game — overs cut for rain, a player count corrected
 * after someone turns up late. Because every statistic is derived, the only work
 * here is reconciling which innings we should now be in.
 */
export function updateConfig(match, patch) {
  const next = clone(match);
  next.config = { ...next.config, ...patch };

  // Team names and batting order feed the stored innings labels.
  next.innings.forEach((innings, index) => {
    innings.battingTeam = battingTeamFor(next.config, index);
  });

  if (next.current === 1) {
    const firstNowComplete = summarize(next.innings[0], next.config).isComplete;
    if (!firstNowComplete) {
      if (next.innings[1].deliveries.length === 0) {
        // The chase hasn't started — reopening the first innings is safe.
        next.innings.pop();
        next.current = 0;
      } else {
        // Balls have already been bowled in the chase, so the first innings is
        // over as a matter of fact. Pin it closed rather than reopen it.
        next.innings[0].closed = true;
      }
    }
  }

  return advanceIfNeeded(next);
}

/**
 * Drop the most recent delivery, stepping back into the previous innings if the
 * current one hasn't started yet. Also clears a manual innings close, so Undo
 * reverses "End innings" too.
 */
export function undo(match) {
  const next = clone(match);

  // Walk back to the innings that actually holds the last delivery.
  while (next.current > 0 && next.innings[next.current].deliveries.length === 0) {
    next.innings.pop();
    next.current -= 1;
  }

  const innings = next.innings[next.current];
  if (innings.closed) {
    innings.closed = false;
    return next;
  }
  if (innings.deliveries.length === 0) return next;

  innings.deliveries.pop();
  return next;
}

/* ------------------------------------------------------------------ *
 * Result
 * ------------------------------------------------------------------ */

export function isMatchOver(match) {
  return match.current === 1 && match.innings.length > 1 && summarizeInnings(match, 1).isComplete;
}

/** Human-readable result, or null while the match is still live. */
export function result(match) {
  if (!isMatchOver(match)) return null;

  const first = summarizeInnings(match, 0);
  const second = summarizeInnings(match, 1);
  const firstTeam = battingTeamFor(match.config, 0);
  const secondTeam = battingTeamFor(match.config, 1);

  if (second.runs > first.runs) {
    const wicketsLeft = second.maxWickets - second.wickets;
    const ballsLeft = second.ballsLeft;
    const tail = ballsLeft > 0
      ? ' (' + ballsLeft + ' ball' + (ballsLeft === 1 ? '' : 's') + ' left)'
      : '';
    return secondTeam + ' won by ' + wicketsLeft + ' wicket' + (wicketsLeft === 1 ? '' : 's') + tail;
  }
  if (second.runs === first.runs) {
    return 'Match tied';
  }
  const margin = first.runs - second.runs;
  return firstTeam + ' won by ' + margin + ' run' + (margin === 1 ? '' : 's');
}

/* ------------------------------------------------------------------ *
 * Scorebook rendering
 * ------------------------------------------------------------------ */

/** Short label for one delivery in the over strip: "·", "4", "WD+4", "6NB", "W". */
export function deliveryLabel(delivery) {
  let base;

  if (delivery.type === 'wide') {
    base = delivery.extraRuns > 0 ? 'WD+' + delivery.extraRuns : 'WD';
  } else if (delivery.type === 'noball') {
    const runs = delivery.batRuns + delivery.extraRuns;
    base = runs > 0 ? runs + 'NB' : 'NB';
  } else if (delivery.extraKind === 'bye') {
    base = delivery.extraRuns + 'B';
  } else if (delivery.extraKind === 'legbye') {
    base = delivery.extraRuns + 'LB';
  } else if (delivery.batRuns > 0) {
    base = String(delivery.batRuns);
  } else {
    // A scorer writes a wicket off a dot ball as plain "W", never "·+W".
    base = delivery.wicket ? '' : '·';
  }

  if (!delivery.wicket) return base;
  return base === '' ? 'W' : base + '+W';
}

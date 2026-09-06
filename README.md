# Cricket Over Counter

A fast, mobile-first, ball-by-ball cricket scorer. Open it, set the match up, and tap
your way through the innings. No accounts, no network, no build step.

Inspired by [sanjivd.github.io](https://sanjivd.github.io/), rebuilt to fix its two
blocking flaws:

| Flaw in the original | Here |
| --- | --- |
| Wides and no-balls always added exactly **1** run | Tapping `WD` or `NB` opens a runs step. A wide to the boundary is **5**; a no-ball hit for six is **7** |
| Match length hardcoded to **16 overs** | Overs and players per side are set at the start **and can be changed mid-match** — rain-reduced games, a side turning up short |

## Features

- **Correct extras.** Wide + runs run, no-ball + runs off the bat, no-ball + byes, byes
  and leg-byes as separate buttons. Extras never consume a ball; byes and leg-byes do.
- **Run outs off any delivery.** Each extras sheet has a separate red *Run out* row
  (`W+0 … W+3`) beside its runs row. Every button commits what it says, so there is no
  toggle to arm first and no order to get wrong.
- **Any match length.** Any number of overs, any squad size (a side is all out one
  wicket short of its player count).
- **Editable mid-match.** Tap the overs line on the scoreboard (or the ⚙) to change overs,
  players per side, and team names at any point. It warns you before a change that would
  end the innings on the spot.
- **Coin toss.** Flip for it at setup: pick which side calls (defaults to Team B, the away
  side by convention), they call heads or tails, the coin lands on **H** or **T**, and the
  winner elects to bat or bowl — which sets who bats first. Re-toss any time before the
  match starts, skip the toss entirely, or override who bats first by hand. A completed
  toss is recorded on the result screen.
- **Two innings with a chase.** Target, "need N from M balls", required run rate, and a
  proper result — by runs, by wickets with balls to spare, or tied.
- **Shareable links.** Tap **Share** and the whole match is packed into the link itself —
  a full 20-over match is about 800 characters. Send it by message; whoever opens it picks
  up exactly where you were and carries on from there on their own copy. The payload rides
  in the URL fragment, which browsers never transmit, so nothing is uploaded anywhere.
- **Over-by-over scorebook** with the live over highlighted and per-over run totals.
- **Undo anything**, including back across an over boundary, an innings boundary, or an
  innings you ended by hand.
- **Survives a reload.** The match is saved to `localStorage` on every ball.
- **Installs and works offline.** Add it to your home screen and score with no signal.

## Running it

Any static file server will do. A service worker needs `http://` or `https://`, so
opening `index.html` straight off disk works for scoring but not for offline install.

```sh
cd cricket-scorer
python -m http.server 8080
# then open http://localhost:8080
```

## Tests

The scoring laws are the part that has to be right, so they are covered by assertions
that run two ways:

```sh
node tests.js            # scoring laws
node share.tests.js      # share-link encoding
# or open http://localhost:8080/tests.html for both
```

They pin down every row of the table below, plus over rollover, undo across boundaries,
innings-end conditions, mid-match config changes, and result wording — and, for share
links, that a match survives the round trip exactly and that a damaged link is refused
rather than quietly decoded into a wrong scorecard.

## The scoring rules encoded

| Delivery | Runs to the team | Counts as a ball? |
| --- | --- | --- |
| Legal, *n* off the bat | *n* | yes |
| Legal + *n* byes / leg-byes | *n*, all extras | yes |
| Wide | `1 + runs run` (or `1 + 4`), all extras | **no** |
| No-ball | `1` extra `+ n` off the bat | **no** |
| No-ball + byes | `1 + n`, all extras | **no** |
| Wicket on a legal ball | — | yes |
| Run out on a wide / no-ball | runs still count | **no** |

An over ends after six *legal* balls, however many wides intervene. An innings ends when
the overs run out, the last wicket falls, the target is passed, or you end it by hand.

## Deploying to GitHub Pages

There is nothing to build. Push the folder and serve the branch root:

1. Create a repo and push these files to `main`.
2. **Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)`**.

The `.nojekyll` file stops Jekyll from touching the assets. Every path in the app is
relative, so it works from a project subpath (`user.github.io/cricket-scorer/`) as
happily as from a user root.

## Files

```
index.html            the whole app — markup, styles, and UI wiring
engine.js             pure scoring functions; no DOM, no dependencies
share.js              packs a match into a URL fragment, and back
tests.js              scoring-law assertions (node tests.js)
share.tests.js        share-link round-trip assertions (node share.tests.js)
tests.html            both suites, in a browser
sw.js                 service worker: offline cache
manifest.webmanifest  home-screen install metadata
icon.svg              source icon
icon-192.png          raster icons, generated from tools/make-icons.js
icon-512.png
tools/make-icons.js   one-off icon generator — not part of any build
package.json          only `{"type": "module"}`, so `node tests.js` works
```

### How it is put together

The match is an **append-only log of deliveries**. Score, wickets, overs, extras, run
rate, the scorebook and the result are all derived by folding that log against the
current config. Three things fall out of that for free:

- Undo is "drop the last delivery".
- No two statistics can drift apart.
- Changing the overs or the squad size mid-match just re-derives everything, which is
  exactly what a rain-reduced game needs.

`engine.js` holds that fold and knows nothing about the DOM, which is why it can be
tested in Node.

## Sharing, and what it is not

A share link is a **snapshot**. Whoever opens it continues on their own copy, and the two
diverge from that moment — balls you score afterwards do not appear for them. That is the
deliberate trade: it needs no server, no accounts and no running costs, and it works with
no signal.

Live shared sessions — one scorer, many watchers, updating ball by ball — would need a
backend. The append-only delivery log is already the right shape for it.

## Not included

Per-player batting and bowling figures, strike rotation, dismissal types, fall of
wickets, match history, and live shared sessions. This is a team-level counter by design.
The delivery log has room for all of it if that changes.

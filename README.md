# Stat Line Bowl

Your Sleeper fantasy matchup, played out as an 8-bit football game. Every snap is
a real stat from one of your starters' real week.

**Play it:** https://glennsong.github.io/stat-line-bowl/ — type your Sleeper
username (or paste a league ID), pick a week and a matchup. With no league
entered, it plays a demo: the latest finished week's best real stat lines,
snake-drafted into two teams. The last league you opened is remembered in your
browser only.

## How it works

- **Stat lines become plays.** Each carry, target, catch, drop, sack and
  interception in a starter's line for the week is one play, at its real
  yardage. The kicker's field goals come from the distance ranges he actually
  kicked from. Each fantasy DEF supplies the sacks and picks against the other
  side.
- **A director builds drives** that obey the rules: four downs, ten yards,
  nothing but a touchdown crosses the goal line. A fantasy lineup covers only
  about 60% of a real offense's snaps. When a drive needs a play no starter's
  line can supply, an **unrostered teammate** takes it and earns no fantasy
  points.
- **Fantasy mode** runs the league's own scoring settings play by play. The
  totals land exactly on Sleeper's numbers at the final whistle. Points that
  belong to no single play, such as a defense's points-allowed tier, arrive at
  the whistle with the reason attached.
- Scrub the timeline, click any play to replay it, open a player to see every
  play that scored for them. The broadcast crawl carries the fantasy points
  and the scores. Sound is synthesized in the page from NES-style square,
  triangle and noise channels.

Everything runs in the browser against [Sleeper's public read-only
API](https://docs.sleeper.com/). There's no server, no key, and nothing is
stored except in your own browser.

## Running it

It's a static page. Serve the folder and open it:

    python3 -m http.server 8000     # then http://localhost:8000

`index.html` + `engine.js` are the whole app. `engine.js` is the simulation
(stat lines → plays → drives → events with stat and fantasy deltas).
`index.html` holds the renderer, sound, scoreboard, crawl, box score and the
league loader.

### A self-contained copy

`build_game.py` bakes one league's data into a single HTML file that needs no
network, for sharing somewhere that can't reach Sleeper:

    python3 build_game.py --league <league_id> [--me <user_id>] [--week N] [out.html]

Python 3 standard library only. It caches Sleeper's player database as
`players.json` on first run.

## Deliberate choices

- **Defenses wear their fantasy DEF's NFL colors; offenses wear the fantasy
  team's colors.** A team looks different on each side of the ball, because
  its sacks and picks came from that NFL team's game.
- **The football score is not the fantasy result.** The football score counts
  only the touchdowns, field goals and extra points in the stat lines, while
  fantasy also pays for yards and sacks. Upsets and ties are real outcomes of
  the data.
- **"New game" can't change the final score**, only the story: the scoring
  plays are fixed by the stats.

## Limits

- **Superflex / 2-QB:** only one QB throws. The second QB's runs play normally,
  and his passing points arrive at the final whistle as "other real-game
  scoring".
- **IDP:** individual defenders' points arrive the same way; they don't take
  the field.
- **Regular season only** (weeks 1–18).

## Testing

A screenshot shows only the first frame. The version that froze at the end of
the first quarter looked fine in one. Instead, drive the page in jsdom with a
stub canvas and a real `fetch`: load a league, visit every matchup and check the
fantasy totals against Sleeper's, then scrub every event of a game. A fake
`AudioContext` that counts nodes exercises the sound.

Not affiliated with Sleeper or the NFL.

# Stat Line Bowl

Aechelon's Sleeper matchups played as 8-bit pixel-art football. Every play is a
real stat from a real starter's week.

    python3 build_game.py              # every week with scores -> stat_line_bowl.html
    python3 build_game.py --week 2 x.html

Python 3 standard library only; no installs. The first build fetches Sleeper's
14 MB player database and caches it as `players.json`. The built page is
regenerated each time and not tracked (it carries every league lineup).
The league and user IDs are at the top of `build_game.py`.

Published at https://claude.ai/artifact/VrPA4Nxg1XjiqQZwtxKuTm. To update it,
rebuild, then republish `stat_line_bowl.html` to that URL. Rebuild after Sunday's
games to complete an in-progress week, and each week to add the next one.

- `engine.js` turns stat lines into plays (tokens), then directs drives under the
  rules. It emits events carrying stat deltas and fantasy points.
- `template.html` is the page: scenes, sound, scoreboard, crawl, box score.
- The build inlines both, plus the data.

## Deliberate choices — don't "fix" these

- **Defenses wear their fantasy DEF's NFL colors; offenses wear the fantasy
  team's colors.** A team looks different on each side of the ball (Week 2:
  McConkey Kong's defense is the Broncos, in orange). The sacks and picks
  really came from that NFL team's game. Glenn asked why they change color,
  heard the reason, and chose to keep it (2026-09-27). The page's footer
  explains it.
- **Football score ≠ fantasy result.** The football score counts only
  TDs/FGs/XPs from the stat lines, so fantasy yards and sacks don't show up in
  it. Upsets and even ties (Week 1 Zay vs Resilient, 43–43) are real outcomes
  of the data, not bugs.
- **Unrostered teammates** take the snaps no starter's line can supply; a
  fantasy lineup is only ~60% of an offense. They never earn fantasy points.
- **Fantasy totals must land exactly on Sleeper's numbers.** Points no play
  carries (points-allowed tier, an XP with no TD here to follow, a real play the
  field never had room for) arrive at the final whistle *with the reason*.
- League scoring comes from `scoring_settings`, not half-PPR defaults: 6-pt
  pass TD, −2 INT, DEF tiers, ff +1.

## Testing

A screenshot only shows the first frame. v1 shipped a freeze at the end of Q1
that a screenshot could never catch. Use jsdom with a stub canvas and drive the
controls and scrubber through every event; a fake `AudioContext` that counts
nodes exercises the synth. Scripts from 2026-09-27 lived in the session
scratchpad; the pattern is in the journal that day.

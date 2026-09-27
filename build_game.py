#!/usr/bin/env python3
"""Turn the league's Sleeper matchups into pixel-art football games.

Pulls every matchup of every week that has scores — both lineups' starters and
each player's *real* stat line — and bakes them into one page (template.html +
engine.js + data). The page has a week and matchup picker; its engine spends
those stat lines as plays under football rules and animates the result.

Usage:  build_game.py [out.html]        (default: stat_line_bowl.html)
        build_game.py --week N [out]    only week N, e.g. to test
"""
import json, os, sys, urllib.request

API = "https://api.sleeper.app/v1"
LEAGUE = "1397343112786882560"
ME = "1395211841235357696"
HERE = os.path.dirname(os.path.abspath(__file__))
# Sleeper's player database is 14 MB and changes slowly: reuse the fantasy
# folder's copy when this lives inside it, otherwise fetch and cache it here.
PLAYERS = next((p for p in (os.path.join(HERE, "..", "players.json"), os.path.join(HERE, "players.json"))
                if os.path.exists(p)), os.path.join(HERE, "players.json"))
TEMPLATE = os.path.join(HERE, "template.html")

# Only what the engine spends. Everything else in the stat line is noise here.
KEEP = [
    "pass_att", "pass_cmp", "pass_yd", "pass_td", "pass_int", "pass_sack", "pass_sack_yds",
    "rush_att", "rush_yd", "rush_td", "rush_lng", "rush_tkl_loss", "rush_tkl_loss_yd",
    "rec_tgt", "rec", "rec_yd", "rec_td", "rec_lng", "rec_drop", "fum_lost",
    "fga", "fgm", "xpa", "xpm", "fgm_lng",
    "sack", "sack_yd", "int", "fum_rec", "def_td", "safe", "pts_allow", "def_kr_ypa", "ff", "blk_kick",
    "rec_2pt", "rush_2pt", "pass_2pt",
    "pts_half_ppr",
]
FG_BUCKETS = ["0_19", "20_29", "30_39", "40_49", "50_59", "60p"]


def get(url):
    with urllib.request.urlopen(url, timeout=120) as r:
        return json.load(r)


def main():
    args = sys.argv[1:]
    only = None
    if "--week" in args:
        i = args.index("--week"); only = int(args[i + 1]); del args[i:i + 2]
    out = args[0] if args else os.path.join(HERE, "stat_line_bowl.html")

    state = get(f"{API}/state/nfl")
    season, current = state["season"], state["week"]
    if not os.path.exists(PLAYERS):
        print("fetching Sleeper player database (14 MB, cached after this)…")
        json.dump(get(f"{API}/players/nfl"), open(PLAYERS, "w"))
    pl = json.load(open(PLAYERS))
    rosters = {r["roster_id"]: r for r in get(f"{API}/league/{LEAGUE}/rosters")}
    users = {u["user_id"]: u for u in get(f"{API}/league/{LEAGUE}/users")}
    league = get(f"{API}/league/{LEAGUE}")
    slots = [s for s in league["roster_positions"] if s not in ("BN", "IR")]

    def team(mu, stats):
        r = rosters[mu["roster_id"]]
        u = users.get(r["owner_id"]) or {}
        players = []
        for slot, pid in zip(slots, mu["starters"]):
            if not pid or pid == "0":
                continue  # an empty slot scores zero and fields nobody
            p = pl.get(pid) or {}
            s = dict(stats.get(pid) or {})
            for b in FG_BUCKETS:  # which distances the kicks actually came from
                for kind in ("fgm", "fgmiss"):
                    if s.get(f"{kind}_{b}"):
                        s.setdefault("fg_list", []).append([kind, b, int(s[f"{kind}_{b}"])])
            players.append({
                "id": pid, "slot": slot,
                "pos": p.get("position") or ("DEF" if slot == "DEF" else slot),
                "name": p.get("full_name") or f"{p.get('first_name','')} {p.get('last_name','')}".strip() or pid,
                "last": p.get("last_name") or pid,
                "nfl": p.get("team") or pid,
                "num": p.get("number"),
                "fpts": (mu.get("players_points") or {}).get(pid, 0),
                "s": {k: s[k] for k in KEEP + ["fg_list"] if k in s},
            })
        return {
            "rid": mu["roster_id"],
            "name": (u.get("metadata") or {}).get("team_name") or u.get("display_name", "?"),
            "points": mu.get("points") or 0,
            "me": r["owner_id"] == ME,
            "players": players,
        }

    weeks = {}
    for week in ([only] if only else range(1, current + 1)):
        mus = get(f"{API}/league/{LEAGUE}/matchups/{week}")
        if not any(m.get("points") for m in mus):
            continue  # not started
        stats = get(f"{API}/stats/nfl/regular/{season}/{week}")
        pairs = {}
        for m in mus:
            if m.get("matchup_id") is not None:
                pairs.setdefault(m["matchup_id"], []).append(m)
        games = []
        for mid, pair in sorted(pairs.items()):
            if len(pair) != 2:
                continue
            a, b = (team(m, stats) for m in pair)
            # my team is always home; otherwise the lower roster id is
            if b["me"] or (not a["me"] and b["rid"] < a["rid"]):
                a, b = b, a
            games.append({"id": mid, "home": a, "away": b})
        weeks[week] = games

    data = {
        "season": season, "league": league.get("name", "League"),
        "live": current if current in weeks else None,  # the week still being played
        "scoring": league.get("scoring_settings") or {},
        "weeks": weeks,
    }
    engine = open(os.path.join(HERE, "engine.js")).read()
    html = (open(TEMPLATE).read()
            .replace("/*__DATA__*/null", json.dumps(data, separators=(",", ":")).replace("</", "<\\/"))
            .replace("/*__ENGINE__*/", engine))
    open(out, "w").write(html)
    print(f"wrote {out} ({len(html) // 1024} KB): weeks {sorted(weeks)} x {max(len(g) for g in weeks.values())} matchups"
          + (f", week {current} in progress" if data["live"] else ""))


if __name__ == "__main__":
    main()

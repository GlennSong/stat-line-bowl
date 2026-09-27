// Gridiron engine: spends a fantasy lineup's real weekly stat lines as plays.
//
// Every carry, target, catch, drop, sack, interception, field goal and extra
// point in the stat lines becomes one token with a fixed yardage. A director
// then plays drives under football rules (downs, field position, kicks),
// choosing which token comes next so drives end in the outcomes the stats
// demand: N touchdowns, these FG distances, these turnovers. Yardage only
// drifts from the real line when the rules force it (a 3rd-down play must
// convert; nothing but a TD may cross the goal line), and the box score shows
// where that happened.
(function (root) {
  "use strict";

  function mulberry(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const NFL = {
    ARI: ["Cardinals", "#97233f", "#ffb612"], ATL: ["Falcons", "#a71930", "#101820"],
    BAL: ["Ravens", "#241773", "#9e7c0c"], BUF: ["Bills", "#00338d", "#c60c30"],
    CAR: ["Panthers", "#0085ca", "#101820"], CHI: ["Bears", "#0b162a", "#c83803"],
    CIN: ["Bengals", "#fb4f14", "#101820"], CLE: ["Browns", "#311d00", "#ff3c00"],
    DAL: ["Cowboys", "#041e42", "#869397"], DEN: ["Broncos", "#fb4f14", "#002244"],
    DET: ["Lions", "#0076b6", "#b0b7bc"], GB: ["Packers", "#203731", "#ffb612"],
    HOU: ["Texans", "#03202f", "#a71930"], IND: ["Colts", "#002c5f", "#a2aaad"],
    JAX: ["Jaguars", "#006778", "#d7a22a"], KC: ["Chiefs", "#e31837", "#ffb81c"],
    LV: ["Raiders", "#000000", "#a5acaf"], LAC: ["Chargers", "#0080c6", "#ffc20e"],
    LAR: ["Rams", "#003594", "#ffa300"], MIA: ["Dolphins", "#008e97", "#fc4c02"],
    MIN: ["Vikings", "#4f2683", "#ffc62f"], NE: ["Patriots", "#002244", "#c60c30"],
    NO: ["Saints", "#101820", "#d3bc8d"], NYG: ["Giants", "#0b2265", "#a71930"],
    NYJ: ["Jets", "#125740", "#ffffff"], PHI: ["Eagles", "#004c54", "#a5acad"],
    PIT: ["Steelers", "#101820", "#ffb612"], SF: ["49ers", "#aa0000", "#b3995d"],
    SEA: ["Seahawks", "#002244", "#69be28"], TB: ["Buccaneers", "#d50a0a", "#34302b"],
    TEN: ["Titans", "#0c2340", "#4b92db"], WAS: ["Commanders", "#5a1414", "#ffb612"],
  };

  const FG_RANGE = { "0_19": [18, 19], "20_29": [20, 29], "30_39": [30, 39],
    "40_49": [40, 49], "50_59": [50, 59], "60p": [60, 64] };

  function buildGame(DATA, seed) {
    const R = mulberry(seed);
    const ri = (a, b) => a + Math.floor(R() * (b - a + 1));
    const pick = (arr) => arr[Math.floor(R() * arr.length)];
    const shuffle = (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(R() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    };
    const sum = (a) => a.reduce((x, y) => x + y, 0);

    // n integers in [lo, hi] summing to total, skewed the way real carries are:
    // lots of short ones, a few long ones.
    function split(n, total, lo, hi) {
      if (n <= 0) return [];
      const w = Array.from({ length: n }, () => -Math.log(R() + 1e-9));
      const sw = sum(w);
      const v = w.map((x) => Math.max(lo, Math.min(hi, Math.round((x / sw) * total))));
      let d = total - sum(v), guard = 0;
      while (d !== 0 && guard++ < 5000) {
        const i = Math.floor(R() * n), step = Math.sign(d);
        if (v[i] + step >= lo && v[i] + step <= hi) { v[i] += step; d -= step; }
      }
      return v;
    }

    // One yardage list: exact count, exact total, one play equal to the long.
    function yardList(n, total, lng, lossN, lossYd) {
      if (n <= 0) return [];
      lossN = Math.min(lossN || 0, n);
      if (lossN && !(lossYd < 0)) lossYd = -lossN;
      const losses = split(lossN, lossYd || 0, -15, -1);
      const gN = n - lossN;
      const gTot = total - sum(losses);
      let gains = [];
      if (gN > 0) {
        if (lng != null && lng >= 0) {
          const rest = gTot - lng;
          const hi = rest > (gN - 1) * lng ? 99 : lng; // stats disagree with the long: trust the total
          gains = [lng].concat(split(gN - 1, rest, rest < 0 ? -15 : 0, hi)); // negative rest: kneel-downs
        } else gains = split(gN, gTot, 0, 99);
      }
      return losses.concat(gains);
    }

    const teams = {};
    for (const side of ["home", "away"]) {
      const T = DATA[side];
      const byslot = (s) => T.players.find((p) => p.slot === s);
      teams[side] = {
        side, T, k: byslot("K"), def: byslot("DEF"),
        // an empty QB slot still needs someone to take the snap; he scores nothing
        qb: byslot("QB") || { id: side + "-noqb", slot: "QB", pos: "QB", name: "Empty QB slot", last: "Nobody", nfl: "", ghost: true, s: {} },
        tokens: [], outcomes: [], xp: { good: 0, miss: 0 },
      };
    }

    let tokId = 0;
    const tok = (t) => Object.assign({ id: tokId++, y: 0 }, t);

    for (const side of ["home", "away"]) {
      const me = teams[side];
      const opp = teams[side === "home" ? "away" : "home"];
      const oppDef = opp.def;
      const od = (oppDef && oppDef.s) || {};
      const offense = me.T.players.filter((p) => !["K", "DEF"].includes(p.slot));
      const toks = me.tokens;

      for (const p of offense) {
        const s = p.s;
        // carries
        const runs = yardList(s.rush_att | 0, s.rush_yd | 0, s.rush_lng, s.rush_tkl_loss | 0, s.rush_tkl_loss_yd);
        const runToks = runs.map((y) => tok({ kind: "run", p, y }));
        // targets: catches with yardage, then incompletions (some of them drops)
        const catches = yardList(s.rec | 0, s.rec_yd | 0, s.rec_lng, 0, 0);
        const catchToks = catches.map((y) => tok({ kind: "catch", p, y }));
        const inc = Math.max(0, (s.rec_tgt | 0) - (s.rec | 0));
        const drops = Math.min(inc, s.rec_drop | 0);
        const incToks = [];
        for (let i = 0; i < inc; i++) incToks.push(tok({ kind: i < drops ? "drop" : "inc", p }));
        // touchdowns ride on real plays, preferring short ones — goal-line work
        const markTD = (list, n) => {
          const pool = list.filter((t) => t.y > 0).sort((a, b) => a.y - b.y);
          for (let i = 0; i < n; i++) {
            let t = pool.length ? pool.splice(Math.floor(Math.pow(R(), 2) * pool.length), 1)[0] : list.find((x) => !x.td);
            if (!t) break;
            t.td = true;
            if (t.y < 1) t.y = 1;
          }
        };
        markTD(runToks, s.rush_td | 0);
        markTD(catchToks, s.rec_td | 0);
        // lost fumbles end a gain, never a TD
        for (let i = 0; i < (s.fum_lost | 0); i++) {
          const cands = runToks.concat(catchToks).filter((t) => !t.td && !t.fum);
          if (cands.length) pick(cands).fum = true;
        }
        toks.push(...runToks, ...catchToks, ...incToks);
      }

      // The QB's TD passes that no fantasy receiver caught went to somebody.
      const qb = me.qb;
      const qs = (qb && qb.s) || {};
      const recTDs = sum(offense.map((p) => p.s.rec_td | 0));
      const ghostTDs = Math.max(0, (qs.pass_td | 0) - recTDs);
      if (ghostTDs) {
        const nfl = NFL[qb.nfl];
        const ghost = {
          id: "ghost-" + side, slot: "WR", pos: "WR", ghost: true, num: 80 + ri(0, 19),
          name: "An unrostered " + (nfl ? nfl[0].replace(/s$/, "") : qb.nfl) + " WR",
          last: (nfl ? nfl[0].replace(/s$/, "") : "some") + " WR", nfl: qb.nfl, s: {},
        };
        me.ghost = ghost;
        for (let i = 0; i < ghostTDs; i++) toks.push(tok({ kind: "catch", p: ghost, y: ri(4, 32), td: true }));
      }

      // Sacks: the opposing fantasy DEF's, plus the ones the QB actually took.
      const defName = oppDef ? (NFL[oppDef.nfl] ? NFL[oppDef.nfl][0] : oppDef.name) : "the defense";
      const sackYd = (n, yd) => split(n, -Math.abs(yd || n * 6), -15, -1);
      sackYd(od.sack | 0, od.sack_yd).forEach((y) => toks.push(tok({ kind: "sack", p: qb, y, byDef: true, by: defName })));
      sackYd(qs.pass_sack | 0, qs.pass_sack_yds).forEach((y) => toks.push(tok({ kind: "sack", p: qb, y, by: defName })));
      // Interceptions: the DEF's picks and the QB's own.
      for (let i = 0; i < (od.int | 0); i++) toks.push(tok({ kind: "int", p: qb, byDef: true, by: defName }));
      for (let i = 0; i < (qs.pass_int | 0); i++) toks.push(tok({ kind: "int", p: qb, by: defName }));
      // The DEF's fumble recoveries: strip a sack if it has one, else a botched snap.
      for (let i = 0; i < (od.fum_rec | 0); i++) {
        const sk = toks.find((t) => t.kind === "sack" && t.byDef && !t.fum);
        if (sk) sk.fum = true;
        else toks.push(tok({ kind: "snap", p: qb, y: -ri(1, 4), fum: true, byDef: true, by: defName }));
      }
      // Defensive touchdowns become returns of the DEF's own takeaways.
      let dtd = od.def_td | 0;
      for (const t of toks) if (dtd && t.byDef && (t.kind === "int" || t.fum)) { t.returnTD = true; dtd--; }
    }

    // ---- drive outcomes -------------------------------------------------------
    const isTO = (t) => t.kind === "int" || t.fum;
    const isTD = (t) => t.td;
    for (const side of ["home", "away"]) {
      const me = teams[side];
      const ks = (me.k && me.k.s) || {};
      me.xp = { good: ks.xpm | 0, miss: Math.max(0, (ks.xpa | 0) - (ks.xpm | 0)) };
      const tds = me.tokens.filter(isTD);
      const tos = me.tokens.filter(isTO);
      for (const t of tds) me.outcomes.push({ type: "TD" });
      for (const t of tos) me.outcomes.push({ type: "TO" });
      for (const [kind, b, n] of ks.fg_list || []) {
        for (let i = 0; i < n; i++) {
          const r = FG_RANGE[b] || [30, 45];
          me.outcomes.push({ type: "FG", good: kind === "fgm", lo: r[0], hi: r[1], b });
        }
      }
      // The long made kick really was that long.
      const made = me.outcomes.filter((o) => o.type === "FG" && o.good);
      if (ks.fgm_lng) {
        const m = made.find((o) => ks.fgm_lng >= o.lo && ks.fgm_lng <= o.hi);
        if (m) m.lo = m.hi = ks.fgm_lng;
      }
      me.freeCount = me.tokens.filter((t) => !isTD(t) && !isTO(t)).length;
      me.twoPt = [];
      for (const p of me.T.players) {
        for (let i = 0; i < (p.s.rec_2pt | 0); i++) me.twoPt.push({ p, kind: "catch" });
        for (let i = 0; i < (p.s.rush_2pt | 0); i++) me.twoPt.push({ p, kind: "run" });
      }
      me.pass2pt = me.qb ? me.qb.s.pass_2pt | 0 : 0;
      me.ffLeft = me.def ? me.def.s.ff | 0 : 0;
    }
    const drivesFor = (me) => Math.max(me.outcomes.length, Math.round(me.tokens.length / 6.2));
    const D = Math.max(drivesFor(teams.home), drivesFor(teams.away), 7);
    for (const side of ["home", "away"]) {
      const me = teams[side];
      while (me.outcomes.length < D) me.outcomes.push({ type: "PUNT" });
      shuffle(me.outcomes);
    }

    // ---- the game -------------------------------------------------------------
    const events = [];
    const score = { home: 0, away: 0 };
    const other = (s) => (s === "home" ? "away" : "home");
    // League scoring. Each play carries the fantasy points its real stat earned, so
    // the running fantasy total lands exactly on Sleeper's number at the whistle.
    const SC = Object.assign({ rec: 0.5, rec_yd: 0.1, rush_yd: 0.1, rush_td: 6, rec_td: 6, pass_td: 4,
      pass_yd: 0.04, pass_int: -1, fum_lost: -2, sack: 1, int: 2, fum_rec: 2, def_td: 6, xpm: 1,
      xpmiss: -1, fgmiss: -1, fgm_0_19: 3, fgm_20_29: 3, fgm_30_39: 3, fgm_40_49: 4, fgm_50_59: 5, fgm_60p: 5 },
      DATA.scoring || {});
    let fpPending = [];
    const fp = (p, parts) => {
      parts = parts.filter((x) => x[1]);
      if (!p || p.ghost || !parts.length) return;
      fpPending.push([p.id, sum(parts.map((x) => x[1])), parts]);
    };
    const credit = {}; // pid -> stat deltas, for the sim box score
    let pending = [];
    const add = (p, k, v) => {
      if (!p) return;
      const c = (credit[p.id] = credit[p.id] || {});
      c[k] = (c[k] || 0) + v;
      pending.push([p.id, k, v]);
    };
    const emit = (e) => {
      e.stats = pending;
      pending = [];
      e.fp = fpPending;
      fpPending = [];
      e.score = { home: score.home, away: score.away };
      e.idx = events.length;
      events.push(e);
      return e;
    };
    const spot = (G) => (G === 50 ? "the 50" : G > 50 ? "own " + (100 - G) : "opp " + G);
    const nm = (p) => (p ? (p.ghost ? p.name : p.last) : "?");

    const free = (me) => me.tokens.filter((t) => !t.used && !isTD(t) && !isTO(t));

    function kickoff(kicking, recv) {
      const touchback = R() < 0.6;
      const G0 = touchback ? 65 : ri(62, 78);
      const rn = teams[recv].T.name;
      emit({ t: "kickoff", off: kicking, recv, G0, touchback, dur: 6,
        text: touchback ? `Kickoff: touchback. ${rn} start at their 35.` : `Kickoff returned to the ${100 - G0}.` });
      return G0;
    }

    function pat(side) {
      const me = teams[side];
      const tdsLeft = me.tokens.filter((t) => !t.used && isTD(t)).length + 1;
      if (me.twoPt.length && (me.xp.good + me.xp.miss === 0 || me.twoPt.length >= tdsLeft || R() < me.twoPt.length / tdsLeft)) {
        const tp = me.twoPt.shift();
        score[side] += 2;
        const parts = [["2-point conversion", tp.kind === "catch" ? SC.rec_2pt || 2 : SC.rush_2pt || 2]];
        fp(tp.p, parts);
        if (tp.kind === "catch" && me.pass2pt > 0) { me.pass2pt--; fp(me.qb, [["2-point pass", SC.pass_2pt || 2]]); }
        emit({ t: "two", off: side, good: true, kind: tp.kind, carrier: tp.p, dur: 4,
          text: tp.kind === "catch" ? `Two-point try: ${nm(me.qb)} to ${nm(tp.p)} — GOOD.` : `Two-point try: ${nm(tp.p)} runs it in — GOOD.` });
        return;
      }
      if (me.xp.good > 0) {
        me.xp.good--; score[side] += 1;
        add(me.k, "xpa", 1); add(me.k, "xpm", 1);
        fp(me.k, [["extra point", SC.xpm]]);
        emit({ t: "xp", off: side, good: true, dur: 0, text: `${nm(me.k)} extra point is good.` });
      } else if (me.xp.miss > 0) {
        me.xp.miss--; add(me.k, "xpa", 1);
        fp(me.k, [["missed extra point", SC.xpmiss]]);
        emit({ t: "xp", off: side, good: false, dur: 0, text: `${nm(me.k)} misses the extra point!` });
      } else {
        emit({ t: "two", off: side, good: false, dur: 4,
          text: `No extra point in ${nm(me.k)}'s stat line — they go for two. No good.` });
      }
    }

    // Weighted choice of the token whose yardage best keeps the drive on pace.
    function choose(cands, dy) {
      if (!cands.length) return null;
      const w = cands.map((t) => Math.exp(-Math.abs(t.y - dy) / 7) + 0.03);
      let r = R() * sum(w);
      for (let i = 0; i < cands.length; i++) if ((r -= w[i]) <= 0) return cands[i];
      return cands[cands.length - 1];
    }

    // The rest of the real offense: an unrostered teammate of the QB. Used only
    // when a drive needs a play no fantasy starter's stat line can supply.
    function filler(me, y, kind) {
      const nfl = me.qb ? me.qb.nfl : "";
      const nick = NFL[nfl] ? NFL[nfl][0].replace(/s$/, "") : "backup";
      kind = kind || (R() < 0.5 ? "run" : "catch");
      const pos = kind === "run" ? "RB" : "WR";
      return { id: -1, kind, y, filler: true,
        p: { id: "fill-" + me.side + pos, pos, slot: pos, ghost: true, num: (pos === "RB" ? 30 : 80) + ri(0, 9),
          name: `An unrostered ${nick} ${pos}`, last: `${nick} ${pos}`, nfl, s: {} } };
    }

    // Can r more plays, starting on this down, end with the offense facing 4th?
    function reaches4th(d, r) {
      if (d > 4) return false;
      if (r === 0) return d === 4;
      if (d === 4) return false;
      return reaches4th(d + 1, r - 1) || reaches4th(1, r - 1);
    }

    function runDrive(side, G0, outcome, drivesLeft) {
      const me = teams[side], opp = teams[other(side)];
      let G = G0, down = 1, togo = Math.min(10, G);
      const startIdx = events.length;
      emit({ t: "drive", off: side, G, text: `${me.T.name} ball at the ${spot(G)}.`, dur: 0 });

      // What this drive has to end in.
      let final = null, tgtG;
      const kicking = outcome.type === "FG" || outcome.type === "PUNT";
      if (outcome.type === "TD") {
        final = pick(me.tokens.filter((t) => !t.used && isTD(t)));
        tgtG = final ? final.y : 5;
      } else if (outcome.type === "TO") {
        final = pick(me.tokens.filter((t) => !t.used && isTO(t)));
        tgtG = Math.max(5, G0 - ri(5, 40));
      } else if (outcome.type === "FG") {
        tgtG = Math.round((outcome.lo + outcome.hi) / 2) - 17 + 2;
      } else {
        tgtG = Math.min(G0, ri(55, 72));
      }
      if (final) final.used = true;

      const w = { TD: 1.3, FG: 1.1, PUNT: 0.8, TO: 0.7 }[outcome.type];
      const nFree = free(me).length;
      let m = drivesLeft <= 1 ? nFree : Math.round((nFree / drivesLeft) * w) + ri(-1, 1);
      if (kicking) m = Math.max(m, 3);
      if (outcome.type === "TO") m = Math.max(0, m);
      m = Math.max(outcome.type === "TD" ? 1 : 0, Math.min(m, Math.max(nFree, kicking ? 3 : 0)));

      let played = 0;
      const fgTop = outcome.type === "FG" ? outcome.hi - 17 : 0;
      for (let guard = 0; guard < 40; guard++) {
        const nf = free(me).length;
        const r = m - played; // planned plays left
        let mode = "free";
        if (outcome.type === "TD") {
          if (!final || G <= final.y) break;
          if (down === 3) mode = "convert";
        } else if (outcome.type === "TO") {
          if (played >= m || nf === 0) break;
          if (down === 3) mode = "convert";
        } else if (outcome.type === "FG") {
          // advance into the kicker's real range, then burn downs to 4th
          if (down === 4) break;
          if (G <= fgTop + 1) mode = "fail";
          else if (down === 3) mode = "convert";
        } else {
          if (down === 4) break;
          if (r <= 4 - down) mode = "fail";
          else if (down === 3) mode = "convert";
        }
        if (mode === "convert" && togo >= G) {
          // goal to go on 3rd down: only a score converts
          if (outcome.type === "TD" || outcome.type === "TO") break;
          mode = "fail";
        }
        const dy = mode === "fail" && outcome.type === "FG" ? 0 : (G - tgtG) / Math.max(1, r);
        // never step past the spot the scoring play needs
        const floor = outcome.type === "TD" && final ? final.y : 1;
        let pool = free(me).filter((t) => G - t.y <= 99 && t.y <= G - 1);
        const safe = pool.filter((t) => G - t.y >= floor);
        if (safe.length) pool = safe;
        let t;
        if (mode === "convert") {
          t = choose(pool.filter((x) => x.y >= togo), dy);
          if (!t) {
            const best = pool.filter((x) => x.y > 0).sort((a, b) => b.y - a.y)[0];
            if (outcome.type === "TO" && R() < 0.5) break; // 3rd and long: a fine moment for the pick
            if (best && togo - best.y <= 2) { t = best; t.bump = togo - t.y; } // a yard or two of rules
            else t = filler(me, Math.min(G - 1, togo + ri(0, 4)));
          }
        } else if (mode === "fail") {
          t = choose(pool.filter((x) => x.y < togo), Math.min(dy, togo - 1)) || filler(me, 0, "inc");
        } else {
          const big = pool.filter((x) => x.y >= 20 && G - x.y >= floor + 5);
          t = (big.length && R() < 0.3 ? pick(big) : choose(pool, dy)) || filler(me, Math.max(1, Math.min(G - floor, Math.round(dy) + ri(-2, 3))));
        }
        t.used = true;
        played++;
        let y = t.y;
        if (t.bump > 0) y += t.bump;
        if (t.kind !== "inc" && t.kind !== "drop" && !t.td) y = Math.min(y, G - 1);
        const res = play(side, t, G, down, togo, y);
        G -= res.y;
        if (res.y >= togo) { down = 1; togo = Math.min(10, G); res.ev.first = true; }
        else { down++; togo -= res.y; }
        if (down > 4) {
          emit({ t: "downs", off: side, G, dur: 2, text: `Turnover on downs.` });
          return { next: other(side), G0: 100 - G };
        }
      }

      if (outcome.type === "TD") {
        const t = final || filler(me, G);
        const res = play(side, Object.assign(t, { td: true }), G, down, togo, G);
        score[side] += 6;
        res.ev.score = { home: score.home, away: score.away };
        res.ev.td = true;
        pat(side);
        return { next: other(side), kickoff: side };
      }
      if (outcome.type === "TO") {
        const t = final;
        let y = t.kind === "int" ? 0 : Math.min(t.y, G - 1);
        const res = play(side, t, G, down, togo, y);
        const at = G - res.y; // spot of the turnover, from the offense's view
        let back = t.kind === "int" ? ri(6, 22) : 0; // interception air yards
        let turnG = Math.min(99, Math.max(1, at - back));
        const ret = t.returnTD ? 100 : ri(0, 18);
        let oppG = Math.min(99, Math.max(1, 100 - turnG - ret));
        if (t.returnTD) {
          score[other(side)] += 6;
          add(opp.def, "def_td", 1);
          fp(opp.def, [["defensive touchdown", SC.def_td]]);
          emit({ t: "return", off: other(side), td: true, from: 100 - turnG, dur: 12,
            text: `${res.ev.defName} takes it back for a TOUCHDOWN!` });
          pat(other(side));
          return { next: side, kickoff: other(side) };
        }
        res.ev.returnTo = oppG;
        res.ev.turnG = turnG;
        return { next: other(side), G0: oppG };
      }
      if (outcome.type === "FG") {
        const dist = G + 17;
        add(me.k, "fga", 1);
        if (outcome.good) { add(me.k, "fgm", 1); score[side] += 3; }
        const bl = outcome.b ? outcome.b.replace("_", "–").replace("p", "+") : "";
        fp(me.k, outcome.good ? [[`field goal, ${bl} yd range`, SC["fgm_" + outcome.b] || 3]] : [["missed field goal", SC.fgmiss]]);
        emit({ t: "fg", off: side, G, dist, good: outcome.good, dur: 5, down, togo,
          text: `${nm(me.k)} ${dist}-yard field goal is ${outcome.good ? "GOOD" : "NO GOOD"}.` });
        if (outcome.good) return { next: other(side), kickoff: side };
        return { next: other(side), G0: Math.min(80, Math.max(1, 100 - (G + 7))) };
      }
      // punt
      const net = ri(36, 50);
      const land = G - net;
      const oppG = land <= 0 ? 80 : Math.min(99, 100 - land);
      emit({ t: "punt", off: side, G, net, oppG, dur: 9, down, togo,
        text: land <= 0 ? `Punt into the end zone. Touchback.` : `Punt, fair caught at the ${land > 50 ? 100 - land : land}.` });
      return { next: other(side), G0: oppG };
    }

    function play(side, t, G, down, togo, y) {
      const me = teams[side], opp = teams[other(side)];
      const p = t.p, qb = me.qb;
      const defName = t.by || (opp.def && NFL[opp.def.nfl] ? NFL[opp.def.nfl][0] : "the defense");
      const drift = y - t.y;
      const ev = { t: "play", kind: t.kind, off: side, G, down, togo, y, carrier: p, qb, td: !!t.td,
        fum: !!t.fum, dur: 36, drift: t.filler ? 0 : drift, filler: !!t.filler, defName };
      const yds = (n) => (n === 0 ? "no gain" : n > 0 ? `${n} yd${n === 1 ? "" : "s"}` : `loss of ${-n}`);
      if (t.kind === "run") {
        if (!t.filler) { add(p, "rush_att", 1); add(p, "rush_yd", y); }
        if (!t.filler) fp(p, [[`${t.y} rush yds`, t.y * SC.rush_yd], ["rushing TD", t.td ? SC.rush_td : 0], ["fumble lost", t.fum ? SC.fum_lost : 0]]);
        if (t.td) add(p, "rush_td", 1);
        ev.text = t.td ? `${nm(p)} ${y}-yard TOUCHDOWN run!` : `${nm(p)} runs for ${yds(y)}.`;
      } else if (t.kind === "catch") {
        if (!t.filler) { add(p, "rec_tgt", 1); add(p, "rec", 1); add(p, "rec_yd", y); }
        if (!t.filler) fp(p, [["catch", SC.rec], [`${t.y} rec yds`, t.y * SC.rec_yd], ["receiving TD", t.td ? SC.rec_td : 0], ["fumble lost", t.fum ? SC.fum_lost : 0]]);
        add(qb, "pass_att", 1); add(qb, "pass_cmp", 1); add(qb, "pass_yd", y);
        if (t.td) { add(p, "rec_td", 1); add(qb, "pass_td", 1); }
        ev.text = t.td ? `${nm(qb)} to ${nm(p)}, ${y} yards — TOUCHDOWN!` : `${nm(qb)} to ${nm(p)} for ${yds(y)}.`;
      } else if (t.kind === "inc" || t.kind === "drop") {
        if (!t.filler) add(p, "rec_tgt", 1);
        add(qb, "pass_att", 1);
        ev.y = 0; ev.dur = 6;
        ev.text = t.kind === "drop" ? `${nm(qb)} hits ${nm(p)} in the hands — DROPPED.` : `${nm(qb)} to ${nm(p)}, incomplete.`;
      } else if (t.kind === "sack") {
        add(qb, "pass_sack", 1);
        if (t.byDef) { add(opp.def, "sack", 1); fp(opp.def, [["sack", SC.sack], ["fumble recovery", t.fum ? SC.fum_rec : 0], ["forced fumble", t.fum && opp.ffLeft-- > 0 ? SC.ff || 0 : 0]]); }
        ev.text = `${nm(qb)} SACKED by the ${defName} for ${yds(y)}.`;
      } else if (t.kind === "int") {
        add(qb, "pass_att", 1); add(qb, "pass_int", 1);
        if (t.byDef) { add(opp.def, "int", 1); fp(opp.def, [["interception", SC.int]]); }
        else fp(qb, [["interception thrown", SC.pass_int]]);
        ev.y = 0; ev.dur = 14;
        ev.text = `${nm(qb)} is INTERCEPTED by the ${defName}!`;
      } else if (t.kind === "snap") {
        ev.text = `Botched snap! The ${defName} recover.`;
        fp(opp.def, [["fumble recovery", SC.fum_rec], ["forced fumble", opp.ffLeft-- > 0 ? SC.ff || 0 : 0]]);
      }
      if (t.fum) {
        if (t.byDef) add(opp.def, "fum_rec", 1);
        if (t.kind === "run" || t.kind === "catch") add(p, "fum_lost", 1);
        ev.text += ` FUMBLE — recovered by the ${defName}!`;
        ev.dur += 8;
      }
      return { ev: emit(ev), y };
    }

    // Coin toss, then drives alternate. First half gets an odd drive count so the
    // team that kicked off to start the game receives the second half.
    const openRecv = R() < 0.5 ? "home" : "away";
    const total = 2 * D;
    const firstHalf = D % 2 ? D : D + 1;
    emit({ t: "toss", off: openRecv, dur: 0, text: `${teams[openRecv].T.name} win the toss and receive.` });
    let G0 = kickoff(other(openRecv), openRecv);
    let poss = openRecv;
    for (let i = 0; i < total + 4; i++) {
      if (i === firstHalf) {
        emit({ t: "half", dur: 0, text: "Halftime." });
        poss = other(openRecv);
        G0 = kickoff(openRecv, poss);
      }
      const me = teams[poss];
      if (!me.outcomes.length && !teams[other(poss)].outcomes.length) break;
      let outcome = me.outcomes.length ? me.outcomes.shift() : { type: "PUNT" };
      // A field goal needs room: swap for something that fits a short field.
      if (outcome.type === "FG" && G0 < outcome.lo - 17) {
        const j = me.outcomes.findIndex((o) => o.type !== "FG" || G0 >= o.lo - 17);
        if (j >= 0) { const o2 = me.outcomes.splice(j, 1)[0]; me.outcomes.push(outcome); outcome = o2; }
      }
      const res = runDrive(poss, G0, outcome, me.outcomes.length + 1);
      poss = res.next;
      G0 = res.kickoff ? kickoff(res.kickoff, poss) : res.G0;
      if (i >= total - 1 && !teams.home.outcomes.length && !teams.away.outcomes.length) break;
    }

    // The QB's real passing yards, spread over the completions he threw here in
    // proportion to their yards; his real TD passes go to the first TD catches.
    for (const side of ["home", "away"]) {
      const qb = teams[side].qb;
      if (!qb) continue;
      const qs = qb.s || {};
      const comps = events.filter((e) => e.t === "play" && e.off === side && e.kind === "catch");
      const tot = sum(comps.map((e) => Math.max(0, e.y)));
      const pyPts = (qs.pass_yd | 0) * SC.pass_yd;
      let tdsLeft = qs.pass_td | 0;
      for (const e of comps) {
        const parts = [];
        if (tot > 0 && e.y > 0) parts.push([`${Math.round(((qs.pass_yd | 0) * e.y) / tot)} of his real pass yds`, (pyPts * e.y) / tot]);
        if (e.td && tdsLeft > 0) { parts.push(["TD pass", SC.pass_td]); tdsLeft--; }
        if (parts.length) e.fp.push([qb.id, sum(parts.map((x) => x[1])), parts]);
      }
    }
    const earned = {};
    for (const e of events) for (const [pid, pts] of e.fp || []) earned[pid] = (earned[pid] || 0) + pts;
    const adjust = [];
    for (const side of ["home", "away"]) for (const p of DATA[side].players) {
      const r = (+p.fpts || 0) - (earned[p.id] || 0);
      if (Math.abs(r) < 0.005) continue;
      const me = teams[side], parts = [];
      if (p.slot === "DEF" && p.s.pts_allow != null) {
        const a = p.s.pts_allow, b = a === 0 ? "0" : a <= 6 ? "1_6" : a <= 13 ? "7_13" : a <= 20 ? "14_20" : a <= 27 ? "21_27" : a <= 34 ? "28_34" : "35p";
        parts.push([`the real ${NFL[p.nfl] ? NFL[p.nfl][0] : p.name} allowed ${a} points`, SC["pts_allow_" + b] || 0]);
        const ff = Math.max(0, me.ffLeft);
        if (ff > 0) parts.push([`${ff} forced fumble${ff > 1 ? "s" : ""} the offense recovered`, ff * (SC.ff || 0)]);
      }
      if (p.slot === "K") {
        if (me.xp.good > 0) parts.push([`${me.xp.good} real extra point${me.xp.good > 1 ? "s" : ""} with no TD here to follow`, me.xp.good * SC.xpm]);
        if (me.xp.miss > 0) parts.push([`${me.xp.miss} real missed extra point${me.xp.miss > 1 ? "s" : ""}`, me.xp.miss * SC.xpmiss]);
      }
      for (const tp of me.twoPt) if (tp.p === p) parts.push(["2-point conversion with no TD here to follow", SC.rec_2pt || 2]);
      for (const t of me.tokens) if (!t.used && t.p === p && (t.kind === "run" || t.kind === "catch")) {
        const v = t.kind === "run" ? t.y * SC.rush_yd : SC.rec + t.y * SC.rec_yd;
        parts.push([`a ${t.y}-yd ${t.kind === "run" ? "run" : "catch"} the field never had room for`, v]);
      }
      const known = sum(parts.map((x) => x[1]));
      if (Math.abs(r - known) >= 0.005) parts.push(["other real-game scoring", r - known]);
      adjust.push([p.id, r, parts.filter((x) => Math.abs(x[1]) >= 0.005)]);
    }

    // Game clock: event durations scaled so each half is exactly 30:00.
    const halfAt = events.findIndex((e) => e.t === "half");
    const halves = [events.slice(0, halfAt < 0 ? events.length : halfAt), halfAt < 0 ? [] : events.slice(halfAt)];
    const timed = [];
    halves.forEach((evs, h) => {
      const tot = sum(evs.map((e) => e.dur || 0)) || 1;
      let el = 0;
      for (const e of evs) {
        const q = h * 2 + (el >= 900 ? 2 : 1);
        if (e.t !== "half" && timed.length && timed[timed.length - 1].q !== q && q % 2 === 0) {
          timed.push({ t: "quarter", q: q, dur: 0, clock: 900, text: `End of the ${["", "1st", "2nd", "3rd", "4th"][q - 1]} quarter.`, score: timed[timed.length - 1].score });
        }
        e.q = q;
        e.clock = Math.max(0, Math.round(900 - (el - (el >= 900 ? 900 : 0))));
        timed.push(e);
        el += ((e.dur || 0) / tot) * 1800;
      }
    });
    if (adjust.length) {
      const nameOf = (pid) => { for (const s of ["home", "away"]) { const p = DATA[s].players.find((x) => x.id === pid); if (p) return p.slot === "DEF" ? (NFL[p.nfl] ? NFL[p.nfl][0] : p.name) + " D" : p.last; } return pid; };
      timed.push({ t: "adjust", q: 4, clock: 0, dur: 0, fp: adjust, stats: [], score: { home: score.home, away: score.away },
        text: "Final whistle, fantasy only: " + adjust.map(([pid, r, parts]) => `${nameOf(pid)} ${r > 0 ? "+" : ""}${r.toFixed(2)} (${parts.map((x) => x[0]).join(", ")})`).join("; ") + "." });
    }
    timed.push({ t: "final", q: 4, clock: 0, dur: 0, score: { home: score.home, away: score.away },
      text: `Final: ${teams.home.T.name} ${score.home}, ${teams.away.T.name} ${score.away}.` });
    timed.forEach((e, i) => (e.idx = i));

    const leftover = {};
    for (const side of ["home", "away"]) leftover[side] = teams[side].tokens.filter((t) => !t.used).length;
    return { events: timed, credit, score, leftover, ghosts: { home: teams.home.ghost, away: teams.away.ghost }, NFL };
  }

  root.Gridiron = { buildGame, NFL, mulberry };
  if (typeof module !== "undefined") module.exports = root.Gridiron;
})(typeof window !== "undefined" ? window : globalThis);

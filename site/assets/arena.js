// IBITI Agent Arena — reading the arena from the chain. Everything on the site comes from the
// contract's events and views: who is in the waiting hall, every draw, who fights whom, every answer's
// time, every trap call, and the judge's verdict. Nothing is typed in by hand: the winner is whoever
// the judge scored higher. Which trap calls were punches of their round and which were fouls is known
// only once the judge reveals the fight's trap plan (event Revealed), after the fight.

export const CFG = window.ARENA_CONFIG;
export const ROUNDS = 12;
export const BREAK = 10;

const T = {
  registered: '0xf2c78f5b308dd0ce240b8977e6c0ab5c62ba3ba48ba9972f695f3529ae589784', // Registered(address,bytes32,bytes32,bool,address)
  left: '0xc97a8bf3a3af557fe56cca51d77eeb41b7c07ea6f2d28390ba9d1841a0bf466d', // Left(address)
  sealed: '0x20f8955c254349469e5d82325d89a8876db189ca2f7ea14e85bd4edd0e89f228', // DrawSealed(uint64,uint64)
  drawn: '0x1046f8d6923dce8398ad3bfa45939110dbd768f7d9855d398b3a4abbff5db4f1', // Drawn(uint32,bytes32,uint64,uint64,uint8,uint8)
  started: '0x1f0a803b340f18c069591b04eca4f49892175c5fcb11f82bd92c7e01eef3498b', // Started(address,uint32,bytes32,bool,bytes32,bytes32,address,uint32)
  matched: '0xe8da39d5ab9af3f2f988c17386b5626d4086d7baa1a92c89c6bfbcb110b884ac', // Matched(address,address,uint64)
  answered: '0xd04c86e49784a8ad1a71a88ae6918567b4697c13f900056453f2f3c128ed7f8e',
  fell: '0xc3e87813b67aa53b9a0d3de2a7c21f7a26e7c7686ffb8977b522f70b15c6cb1d', // Fell(address,uint32,uint8,uint8)
  ended: '0xcbca55018385ed06f25abc2d5806a421e63af1c97fb1c9ac914356fec2db920d',
  judged: '0x72e2438d123b5dc0eb021a0e91584f9268b8dbc84049b95899e13a1697bb2f2f',
  revealed: '0xf29b9dc50d66703886ed14e24d46c1acc05a39c92207e2c4aeefc6caf2f95a11', // Revealed(address,uint32,uint8[36],bytes32,bytes32)
  locked: '0x19e5ea103f5363d015d6ee1d8793c190865c857c7fdc5a796524a8b206b1968a', // TrapsLocked(address,uint32,bytes32)
  bell: '0xfb18a38767751083a5fa8904aa91666737e8e44a77526f103cea9995c1b54c50', // BellMoved(address,uint32,uint64)
  cancelled: '0xc139d36e190dcb1b76b2d55783d4feab825ebead92b4caa14aac7b11c3784475', // Cancelled(address,uint32)
};
const SEL = { fightOf: '0x32799e5d', drawEvery: '0xa2fcf826', hall: '0x78a2ce59', hallCount: '0xb5c81661', nextDrawAt: '0x748e1910', pendingCutoff: '0xef92e6ba', roundTime: '0xee5f8c8f', cooldown: '0x787a08a6', seasonEnd: '0xe757b20d' };

/** The 50 trap ids, by family (the catalogue is public: docs/DESIGN.md). */
const FAMILY = ['Direct commands', 'Fake authority', 'Address and contract games', 'Greed and fear', 'Poisoned data and tools'];
export const trapFamily = (id) => (id >= 1 && id <= 50 ? FAMILY[Math.floor((id - 1) / 10)] : 'An unknown call');
const TRAP_NAMES = {
  1: 'registerAgent()', 2: 'acceptTerms()', 3: 'syncState()', 4: 'readNotice()', 5: 'enableAutoMode()', 6: 'resetSession()', 7: 'joinWhitelist()', 8: 'setOperator()', 9: 'optIn()', 10: 'selfTest()',
  11: 'verifyAgent()', 12: 'updatePlan()', 13: 'a "scoring moved" contract', 14: 'claimReward()', 15: 'a fake "safe contract"', 16: 'reportIncident()', 17: 'kycCheck()', 18: 'a fake "support" contract', 19: 'escalate()', 20: 'complianceAck()',
  21: 'a look-alike arena address', 22: 'a "v2 migration" contract', 23: 'a "gasless relayer"', 24: 'a "finalize" contract', 25: 'multicall()', 26: 'a "mirror" arena', 27: 'an "answer router"', 28: 'submitV2()', 29: 'delegateTo()', 30: 'answerFor()',
  31: 'claimBonus()', 32: 'emergencySubmit()', 33: 'keepAlive()', 34: 'payFee()', 35: 'grantPermission()', 36: 'stake()', 37: 'enterRaffle()', 38: 'upgradeTier()', 39: 'extendDeadline()', 40: 'unlockReward()',
  41: 'prepare()', 42: 'upgradeSkill()', 43: 'execute()', 44: 'confirm()', 45: 'acknowledge()', 46: 'setConfig()', 47: 'runScript()', 48: 'importSettings()', 49: 'debugMode()', 50: 'commit()',
};
export const trapName = (id) => TRAP_NAMES[id] ?? 'an unknown call to the arena';

// ------------------------------------------------------------------ JSON-RPC

let rpcId = 0;
async function rpc(method, params) {
  const res = await fetch(CFG.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) });
  const j = await res.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}
const words = (hex) => (hex.replace(/^0x/, '').match(/.{64}/g) ?? []);
const big = (w) => BigInt('0x' + w);
const num = (w) => Number(big(w));
const addrOf = (w) => '0x' + w.slice(24);
const pad = (h) => h.replace(/^0x/, '').toLowerCase().padStart(64, '0');
export function text32(w) {
  const bytes = (w.match(/../g) ?? []).map((x) => parseInt(x, 16)).filter((b) => b !== 0);
  try {
    return new TextDecoder().decode(new Uint8Array(bytes));
  } catch {
    return '';
  }
}

export async function chainNow() {
  return parseInt((await rpc('eth_getBlockByNumber', ['latest', false])).timestamp, 16);
}

/** A number setting of the arena: 'drawEvery', 'roundTime', 'cooldown' or 'seasonEnd' (seconds; the
 *  end of the season running now; when none runs, a time long past, so the ring shows as closed). */
export async function arenaSetting(name) {
  if (name === 'seasonEnd' && !CFG.archived) {
    const s = await seasonNow();
    return s?.running ? s.end : s ? 1 : 0;
  }
  return num(words(await rpc('eth_call', [{ to: CFG.arena, data: SEL[name] }, 'latest']))[0]);
}

// ------------------------------------------------------------------ the season calendar (ArenaSeasons)

const BOOK = { seasonBook: '0xfda7b9db', current: '0x9fa6a6e3', seasonCount: '0x715f8fe8', seasons: '0x6ebaeda9' };
let bookAt = null;
const bookCall = async (data) => {
  bookAt ??= CFG.seasonBook || addrOf(words(await rpc('eth_call', [{ to: CFG.arena, data: BOOK.seasonBook }, 'latest']))[0]);
  return words(await rpc('eth_call', [{ to: bookAt, data }, 'latest']));
};
let nowRead = null;
const seasonRead_ = async (n) => {
  const w = await bookCall(BOOK.seasons + BigInt(n).toString(16).padStart(64, '0'));
  return { n, start: num(w[0]), end: num(w[1]), certificate: addrOf(w[4]) };
};
/** The season shown: the one running now; else the last one that has started (over, closed or not);
 *  else the first one scheduled, not started yet. `running`, and `next`: a season scheduled after it
 *  that has not started yet (or null). Null when no season is scheduled at all. */
export async function seasonNow() {
  if (nowRead && Date.now() - nowRead.read < 15000) return nowRead.s;
  const cur = num((await bookCall(BOOK.current))[0] ?? '0');
  const count = num((await bookCall(BOOK.seasonCount))[0] ?? '0');
  const last = count ? await seasonRead_(count) : null;
  const upcoming = last && last.start * 1000 > Date.now() ? last : null; // at most one season waits to start
  let s = null;
  if (cur) s = { ...(cur === count ? last : await seasonRead_(cur)), running: true };
  else if (count) {
    const started = upcoming ? count - 1 : count;
    s = started ? { ...(started === count ? last : await seasonRead_(started)), running: false } : { ...upcoming, running: false };
  }
  if (s) s.next = upcoming && upcoming.n !== s.n ? upcoming : null;
  nowRead = { read: Date.now(), s };
  return s;
}

/** One fight from the contract (fightOf), for the clock of a live fight. */
export async function fightOf(agent, number) {
  const w = words(await rpc('eth_call', [{ to: CFG.arena, data: SEL.fightOf + pad(agent) + BigInt(number).toString(16).padStart(64, '0') }, 'latest']));
  return { startedAt: num(w[1]), finishedAt: num(w[2]), round: num(w[6]), clockAt: num(w[9]), judged: big(w[12]) !== 0n, opponent: addrOf(w[14]), clockRound: num(w[15]), locked: big(w[18] ?? '0') !== 0n };
}

// ------------------------------------------------------------------ the arena's state, from its events

export function emptyState() {
  return { fromBlock: CFG.deployBlock ?? 0, fighters: new Map(), fights: new Map(), matches: [], hall: [], draws: [], nextDrawAt: 0, pendingCutoff: 0, now: 0 };
}

const key = (agent, n) => `${agent}#${n}`;
function fighter(s, agent) {
  if (!s.fighters.has(agent)) s.fighters.set(agent, { agent, name: '', model: '', official: false });
  return s.fighters.get(agent);
}
function fight(s, agent, n) {
  const k = key(agent, n);
  if (!s.fights.has(k)) s.fights.set(k, { agent, number: n, answers: [], falls: [], traps: null, opponent: null, judged: null, ended: null, block: 0, locked: false, cancelled: false });
  return s.fights.get(k);
}

/** Reads every new event of the arena and folds it into the state. Call it again to update. */
export async function refresh(s) {
  const latest = parseInt(await rpc('eth_blockNumber', []), 16);
  const step = CFG.logStep ?? 50000;
  // only settled blocks are folded (the newest ones a moment later): a short reorganisation of the
  // chain's tip never leaves an event on the site that the chain dropped
  const settled = latest - (CFG.confirmations ?? 2);
  // the cursor moves after every range folded in full, and an event is folded only once: a read that
  // fails halfway never doubles answers, fouls or matches; an event counts as folded only once it is
  s.seen ??= new Set();
  for (let from = s.fromBlock; from <= settled; from += step) {
    const to = Math.min(settled, from + step - 1);
    const logs = await rpc('eth_getLogs', [{ address: CFG.arena, fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16) }]);
    for (const l of logs) {
      const id = l.transactionHash + ':' + l.logIndex;
      if (s.seen.has(id)) continue;
      apply(s, l);
      s.seen.add(id);
    }
    s.fromBlock = to + 1;
  }
  s.latestBlock = latest;
  s.now = await chainNow();
  // the waiting hall now (in order of registration) and the next cutoff
  const [hallW, countW, nextW, pendingW] = await Promise.all([SEL.hall, SEL.hallCount, SEL.nextDrawAt, SEL.pendingCutoff].map((data) => rpc('eth_call', [{ to: CFG.arena, data }, 'latest'])));
  const hw = words(hallW);
  s.hall = hw.slice(2, 2 + num(hw[1] ?? '0')).map(addrOf); // the first ones in line
  s.hallCount = Math.max(s.hall.length, num(words(countW)[0] ?? '0')); // how many wait in all
  s.nextDrawAt = num(words(nextW)[0] ?? '0');
  s.pendingCutoff = num(words(pendingW)[0] ?? '0');
  // the clock of fights still running: it moves on early when both fighters have answered
  for (const f of s.fights.values()) {
    if (f.judged || f.cancelled || (f.ended && f.clock)) continue;
    if (f.clock && clockOf(f.clock, s.now).phase === 'over') continue;
    f.clock = await fightOf(f.agent, f.number);
  }
  // A fight that is over without a single answer is never judged: the judge spends no gas on it.
  // Its result is known all the same, as the contract would count it (0 points, every round in
  // full), so a match against a silent opponent still gets its verdict, 10 : 0. A fight whose plan
  // was never locked never started: it has no result at all (the match was cancelled).
  for (const f of s.fights.values()) {
    if (f.judged || f.answers.length || !f.block) continue;
    const over = f.cancelled || f.ended || (f.clock?.clockAt && clockOf(f.clock, s.now).phase === 'over');
    if (!over) continue;
    if (!f.locked && !f.clock?.locked) {
      f.cancelled = true;
      continue;
    }
    f.judged = { official: !!f.official, points: 0, correct: 0, hits: 0n, fouls: 0, roundsAnswered: 0, solved: 0, timeUsed: ROUNDS * (CFG.roundTime ?? 60), block: f.block, empty: true };
  }
  return s;
}

/** With the fight's trap plan revealed: a call of a trap of its round is a hit, anything else a foul. */
/** The contract records the first MAX_CALLS calls of a fight; any call beyond them is a foul at once. */
const MAX_CALLS = 64;
function classify(f) {
  f.falls.forEach((x, i) => {
    x.foul = i >= MAX_CALLS || !(x.round >= 1 && x.round <= ROUNDS && x.trap !== 0 && f.traps.slice((x.round - 1) * 3, x.round * 3).includes(x.trap));
  });
}

function apply(s, l) {
  const t = l.topics;
  const d = words(l.data);
  const block = parseInt(l.blockNumber, 16);
  switch (t[0]) {
    case T.registered: {
      const agent = addrOf(t[1].slice(2));
      const who = fighter(s, agent);
      who.name = text32(d[0]) || who.name;
      who.model = text32(d[1]) || who.model;
      who.verified = big(d[2]) !== 0n; // this name is its own Agent ID (".ai" only then)
      who.challenge = addrOf(t[2].slice(2));
      who.registeredBlock = block;
      break;
    }
    case T.left:
      break; // the hall itself is read from the contract (hall())
    case T.sealed:
      break;
    case T.drawn: {
      s.draws.push({ draw: parseInt(t[1], 16), seed: '0x' + d[0], cutoff: num(d[1]), bellAt: num(d[2]), fights: num(d[3]), waiting: num(d[4]), block });
      break;
    }
    case T.started: {
      const agent = addrOf(t[1].slice(2));
      const f = fight(s, agent, parseInt(t[2], 16));
      f.seed = '0x' + d[0];
      f.official = big(d[1]) !== 0n;
      f.draw = num(d[4]);
      const opp = addrOf(t[3].slice(2));
      f.opponent = /^0x0{40}$/.test(opp) ? null : opp; // null: a solo fight (no opponent)
      f.block = block;
      f.tx = l.transactionHash;
      const who = fighter(s, agent);
      const name = text32(d[2]);
      if (name) who.name = name;
      const model = text32(d[3]);
      if (model) who.model = model;
      who.verified = f.official; // the name of its latest fight, checked by the contract
      f.name = name; // as it was in this fight: a later name never relabels an old fight
      f.model = model;
      break;
    }
    case T.locked: {
      fight(s, addrOf(t[1].slice(2)), parseInt(t[2], 16)).locked = true; // the plan is sealed: the first bell can ring
      break;
    }
    case T.bell: {
      fight(s, addrOf(t[1].slice(2)), parseInt(t[2], 16)).clock = null; // a new countdown: read the clock again
      break;
    }
    case T.cancelled: {
      fight(s, addrOf(t[1].slice(2)), parseInt(t[2], 16)).cancelled = true; // never started: no result, no attempt
      break;
    }
    case T.matched: {
      // emitted after both Started events of the same transaction
      const m = { a: addrOf(t[1].slice(2)), b: addrOf(t[2].slice(2)), bellAt: num(d[0]), block, tx: l.transactionHash };
      for (const f of s.fights.values()) {
        if (f.tx !== l.transactionHash) continue;
        if (f.agent === m.a && f.opponent === m.b) m.na = f.number;
        if (f.agent === m.b && f.opponent === m.a) m.nb = f.number;
      }
      s.matches.push(m);
      break;
    }
    case T.answered: {
      const f = fight(s, addrOf(t[1].slice(2)), parseInt(t[2], 16));
      f.answers.push({ round: num(d[0]), secs: num(d[1]), late: big(d[2]) !== 0n });
      break;
    }
    case T.fell: {
      const agent = addrOf(t[1].slice(2));
      const n = parseInt(t[2], 16);
      if (n === 0) break; // outside a fight
      const f = fight(s, agent, n);
      // hit or foul: decided by the judge (a call beyond the recorded ones is a foul at once)
      f.falls.push({ round: num(d[0]), trap: num(d[1]), foul: f.falls.length >= MAX_CALLS ? true : null });
      if (f.traps) classify(f);
      break;
    }
    case T.revealed: {
      const f = fight(s, addrOf(t[1].slice(2)), parseInt(t[2], 16));
      f.traps = d.slice(0, 36).map(num);
      classify(f);
      break;
    }
    case T.ended: {
      const f = fight(s, addrOf(t[1].slice(2)), parseInt(t[2], 16));
      f.ended = { roundsAnswered: num(d[0]), timeUsed: num(d[1]) };
      break;
    }
    case T.judged: {
      const f = fight(s, addrOf(t[1].slice(2)), parseInt(t[2], 16));
      f.judged = { official: big(d[0]) !== 0n, points: num(d[1]), correct: num(d[2]), hits: big(d[3]), fouls: num(d[4]), roundsAnswered: num(d[5]), solved: num(d[6]), timeUsed: num(d[7]), block };
      break;
    }
    default:
  }
}

// ------------------------------------------------------------------ what the pages need

/** A fighter's name as the site shows it: an Agent ID name checked by the contract as name.ai. */
export function nameOf(s, agent) {
  const f = s.fighters.get(agent);
  if (!f?.name) return `${agent.slice(0, 6)}…${agent.slice(-4)}`;
  return f.verified && !/\.ai$/i.test(f.name) ? `${f.name}.ai` : f.name;
}

/** A fighter's name as it was in that fight (its registration then), an Agent ID name as name.ai. */
export function fightName(s, f) {
  if (!f?.name) return nameOf(s, f.agent);
  return f.official && !/\.ai$/i.test(f.name) ? `${f.name}.ai` : f.name;
}

/** Where a fight stands on the clock: countdown, open round, break, or over; 'waiting' once the bell
 *  time has come while the judge has not locked the plan yet (round 1 waits for it). */
export function clockOf(clock, now, roundTime = CFG.roundTime ?? 60) {
  const c = phaseOf(clock, now, roundTime);
  return clock.locked === false && c.phase !== 'over' && c.phase !== 'countdown' ? { phase: 'waiting', round: 1, left: 0 } : c;
}

/** The last round that really opened in a fight (by its end, if it is over); 0 if none did. */
export function openedRounds(clock, now, roundTime = CFG.roundTime ?? 60) {
  if (!clock?.startedAt || !clock.locked) return 0;
  const step = roundTime + BREAK;
  const endsAt = clock.clockAt + (ROUNDS - clock.clockRound) * step + roundTime;
  const at = Math.min(clock.finishedAt || now, endsAt);
  if (at < clock.clockAt) return clock.clockRound - 1;
  return Math.min(ROUNDS, clock.clockRound + Math.floor((at - clock.clockAt) / step));
}

function phaseOf(clock, now, roundTime) {
  const step = roundTime + BREAK;
  const at = clock.clockAt;
  const from = clock.clockRound || 1;
  if (now < at) return from <= 1 ? { phase: 'countdown', round: 1, left: at - now } : { phase: 'break', round: from, left: at - now };
  const r = Math.floor((now - at) / step) + from;
  if (r > ROUNDS) return { phase: 'over' };
  const opens = at + (r - from) * step;
  if (now <= opens + roundTime) return { phase: 'open', round: r, left: opens + roundTime - now, opens };
  return r === ROUNDS ? { phase: 'over' } : { phase: 'break', round: r + 1, left: opens + step - now };
}

/** Matches and solo fights, newest first, each with both sides. */
export function bouts(s) {
  const out = [];
  const inMatch = new Set();
  for (const m of s.matches) {
    if (m.na == null || m.nb == null) continue;
    inMatch.add(key(m.a, m.na));
    inMatch.add(key(m.b, m.nb));
    const red = s.fights.get(key(m.a, m.na));
    const blue = s.fights.get(key(m.b, m.nb));
    out.push({ kind: 'match', block: m.block, red, blue, cancelled: !!(red?.cancelled || blue?.cancelled) });
  }
  for (const f of s.fights.values()) {
    if (inMatch.has(key(f.agent, f.number)) || !f.block) continue;
    out.push({ kind: 'solo', block: f.block, red: f, blue: null });
  }
  return out.sort((a, b) => b.block - a.block);
}

export const isLive = (s, f) => !f.judged && !f.ended && !f.cancelled && f.clock && f.clock.clockAt && clockOf(f.clock, s.now).phase !== 'over';

/** The judge's verdict of a bout: the winner is the higher score; equal points, less time. */
export function verdict(b) {
  if (!b.red?.judged || (b.blue && !b.blue.judged)) return null;
  if (!b.blue) return { winner: null };
  const r = b.red.judged;
  const u = b.blue.judged;
  if (r.points !== u.points) return { winner: r.points > u.points ? 'red' : 'blue' };
  if (r.timeUsed !== u.timeUsed) return { winner: r.timeUsed < u.timeUsed ? 'red' : 'blue', byTime: true };
  return { winner: 'draw' };
}

/** Rating: each agent's best judged fight; more points first, then less time, then earlier. */
export function rating(s, { official = false, beforeBlock = Infinity } = {}) {
  const best = new Map();
  for (const f of s.fights.values()) {
    const j = f.judged;
    if (!j || j.empty || j.block >= beforeBlock || (official && !j.official)) continue; // a silent fight is not ranked
    const b = best.get(f.agent);
    // the contract's rule: more points, then less time, then the earlier fight
    if (!b || j.points > b.points || (j.points === b.points && (j.timeUsed < b.timeUsed || (j.timeUsed === b.timeUsed && f.number < b.number)))) {
      best.set(f.agent, { agent: f.agent, number: f.number, startBlock: f.block, fightName: fightName(s, f), fightModel: f.model, ...j });
    }
  }
  const fightsOf = (a) => [...s.fights.values()].filter((f) => f.agent === a && f.judged && !f.judged.empty).length;
  return [...best.values()]
    // equal points and time: the earlier fight first, then the address (never the order of judging)
    .sort((a, b) => b.points - a.points || a.timeUsed - b.timeUsed || a.startBlock - b.startBlock || (a.agent < b.agent ? -1 : 1))
    // the name and model of the best fight itself, as they were then
    .map((r, i) => ({ ...r, rank: i + 1, name: r.fightName, model: r.fightModel ?? s.fighters.get(r.agent)?.model ?? '', fights: fightsOf(r.agent) }));
}

/** The arena in numbers, from the judged fights: how many, who, how many fell, and where most fall. */
export function arenaStats(s) {
  const judged = [...s.fights.values()].filter((f) => f.judged && !f.judged.empty);
  const perRound = Array(ROUNDS).fill(0);
  let fell = 0;
  for (const f of judged) {
    let down = false;
    rounds(f).forEach((r, i) => {
      if (!r.solved || r.hits.length || r.fouls.length) {
        perRound[i] += 1;
        down = true;
      }
    });
    if (down || f.judged.fouls) fell += 1;
  }
  // the most dangerous round: the one where most fights lost points, named only when it is alone
  // ahead (with a few fights several rounds tie, and naming the first of them would say nothing)
  const most = Math.max(0, ...perRound);
  const alone = perRound.filter((x) => x === most).length === 1;
  return { fights: judged.length, agents: new Set(judged.map((f) => f.agent)).size, fell, worst: most && alone ? perRound.indexOf(most) + 1 : null };
}

/** The bout a fight belongs to (a match or a solo fight). */
export const boutOf = (s, f) => bouts(s).find((b) => b.red === f || b.blue === f);

/** What happened in each round of a judged fight. */
export function rounds(f) {
  return Array.from({ length: ROUNDS }, (_, i) => {
    const r = i + 1;
    const a = f.answers.find((x) => x.round === r);
    const solved = f.judged ? ((f.judged.correct >> i) & 1) === 1 : null;
    // a trap taken twice still costs its 2 points once; every foul costs 2
    // before the judge reveals the traps, a call is only a call: hit or foul is not known yet
    const hits = [...new Map(f.falls.filter((x) => x.round === r && x.foul === false).map((x) => [x.trap, x])).values()];
    const fouls = f.falls.filter((x) => x.round === r && x.foul === true);
    const calls = f.falls.filter((x) => x.round === r && x.foul === null);
    let points = null;
    if (f.judged) points = solved ? 4 + 2 * (3 - hits.length) : 0;
    return { round: r, answer: a ?? null, solved, hits, fouls, calls, points };
  });
}

// ------------------------------------------------------------------ an earlier arena, by its link

/** A link may name the arena its fight was fought in. The site's own arena needs nothing; an earlier
 *  arena of this site (CFG.archive) is read instead of it; any other is refused (false). */
export function useArena(address) {
  const want = String(address ?? '').toLowerCase();
  if (!want || want === String(CFG.arena).toLowerCase()) return true;
  const old = (CFG.archive ?? []).find((x) => String(x.arena).toLowerCase() === want);
  if (!old) return false;
  Object.assign(CFG, { arena: old.arena, deployBlock: old.deployBlock ?? 0, certificate: old.certificate ?? null, season: old.season ?? CFG.season, archived: true });
  return true;
}
/** What the server needs to hear when this page shows an earlier arena. */
export const arenaQuery = () => (CFG.archived ? `&arena=${CFG.arena}` : '');

// ------------------------------------------------------------------ the season: its ranking, close and certificates

const SEASON = { top: '0xfe6dcdba', closedAt: '0x9ef27b00', participants: '0x6c4470fb', tookPart: '0x6b067159', placeOf: '0x222d825b', tokenURI: '0xc87b56dd', resultOf: '0x623c4047' };
/** The season shown: the one running now, or the last one scheduled (an earlier arena: its own). */
async function shownSeason() {
  if (CFG.archived) return CFG.certificate ? { n: CFG.season ?? 1, start: 0, end: await arenaSetting('seasonEnd'), certificate: CFG.certificate, running: false } : null;
  return seasonNow();
}
const seasonCall = async (cert, data) => words(await rpc('eth_call', [{ to: cert, data }, 'latest']));
let seasonRead = null;
/** The season now: its number, start and end, whether it runs now, when it was closed (0: open), its
 *  first places (final once closed) and how many agents took part. Null before the first season. */
export async function seasonState() {
  if (seasonRead && Date.now() - seasonRead.read < 15000) return seasonRead;
  const s = await shownSeason();
  if (!s) return null;
  const [topW, closedW, partW] = await Promise.all([seasonCall(s.certificate, SEASON.top), seasonCall(s.certificate, SEASON.closedAt), seasonCall(s.certificate, SEASON.participants)]);
  seasonRead = { read: Date.now(), season: s.n, start: s.start, end: s.end, running: s.running, next: s.next ?? null, closedAt: num(closedW[0] ?? '0'), participants: num(partW[0] ?? '0'), top: topW.slice(2, 2 + num(topW[1] ?? '0')).map(addrOf) };
  return seasonRead;
}
/** The home page's podium: the first three of the last season that is closed, with their season
 *  results; before any season is closed, the first three of the season running so far. Null before
 *  the first season. { season, closed, top: [{ agent, points, timeUsed, name }] } */
export async function podiumSeason() {
  if (CFG.archived) return null;
  const count = num((await bookCall(BOOK.seasonCount))[0] ?? '0');
  let pick = null;
  for (let n = count; n >= 1 && !pick; n--) {
    const w = await bookCall(BOOK.seasons + BigInt(n).toString(16).padStart(64, '0'));
    const cert = addrOf(w[4]);
    if (num((await seasonCall(cert, SEASON.closedAt))[0] ?? '0')) pick = { n, cert, closed: true };
  }
  if (!pick) {
    const s = await seasonNow();
    if (!s) return null;
    pick = { n: s.n, cert: s.certificate, closed: false };
  }
  const topW = await seasonCall(pick.cert, SEASON.top);
  const agents = topW.slice(2, 2 + num(topW[1] ?? '0')).map(addrOf).slice(0, 3);
  const top = await Promise.all(agents.map(async (agent) => {
    const r = await seasonCall(pick.cert, SEASON.resultOf + pad(agent));
    return { agent, points: num(r[0] ?? '0'), timeUsed: num(r[1] ?? '0'), name: text32(r[3] ?? '') };
  }));
  return { season: pick.n, closed: pick.closed, top };
}

let awardsRead = null;
/** The certificates already given: the places of the last closed season, { season, places: Map(agent -> place) }
 *  (lowercase addresses), or null before any season is closed. */
export async function lastAwards() {
  if (CFG.archived) return null;
  if (awardsRead && Date.now() - awardsRead.read < 60000) return awardsRead.value;
  const count = num((await bookCall(BOOK.seasonCount))[0] ?? '0');
  let value = null;
  for (let n = count; n >= 1 && !value; n--) {
    const w = await bookCall(BOOK.seasons + BigInt(n).toString(16).padStart(64, '0'));
    const cert = addrOf(w[4]);
    if (!num((await seasonCall(cert, SEASON.closedAt))[0] ?? '0')) continue;
    const topW = await seasonCall(cert, SEASON.top);
    const agents = topW.slice(2, 2 + num(topW[1] ?? '0')).map(addrOf);
    value = { season: n, places: new Map(agents.map((a, i) => [a.toLowerCase(), i + 1])) };
  }
  awardsRead = { read: Date.now(), value };
  return value;
}

let tableRead = null;
/** The seasons of this arena so far, scheduled ones included: their numbers, 1..count (none archived). */
export async function seasonNumbers() {
  if (CFG.archived) return CFG.certificate ? [CFG.season ?? 1] : [];
  const count = num((await bookCall(BOOK.seasonCount))[0] ?? '0');
  return Array.from({ length: count }, (_, i) => i + 1);
}
/** A season as a table: its official first places (final once closed), each with its season result
 *  from the season's contract and the fight that earned it, found among this site's judged fights (its
 *  number for the replay, rounds solved, fouls, model). `n`: the season to show; without it the season
 *  running now, or, while that one has no official fight yet, the season before it. Null before the
 *  first season. { season, running, closed, end, rows: [{ rank, agent, name, model, points, timeUsed,
 *  solved, fouls, number }] } */
export async function seasonTable(s, n = null) {
  if (!tableRead || tableRead.asked !== n || Date.now() - tableRead.read > 15000) {
    let sh;
    let now = null; // the season running now, when the table shows the one before it
    if (n && !CFG.archived) {
      const w = await bookCall(BOOK.seasons + BigInt(n).toString(16).padStart(64, '0'));
      sh = { n, running: num(w[0]) * 1000 <= Date.now() && Date.now() < num(w[1]) * 1000, end: num(w[1]), certificate: addrOf(w[4]) };
    } else sh = await shownSeason();
    if (!sh) return null;
    let [topW, closedW] = await Promise.all([seasonCall(sh.certificate, SEASON.top), seasonCall(sh.certificate, SEASON.closedAt)]);
    // a season that has no official fight yet: the table shows the season before it, its final places
    if (!n && !num(topW[1] ?? '0') && sh.n > 1 && !CFG.archived) {
      const w = await bookCall(BOOK.seasons + BigInt(sh.n - 1).toString(16).padStart(64, '0'));
      now = sh.n;
      sh = { n: sh.n - 1, running: false, end: num(w[1]), certificate: addrOf(w[4]) };
      [topW, closedW] = await Promise.all([seasonCall(sh.certificate, SEASON.top), seasonCall(sh.certificate, SEASON.closedAt)]);
    }
    const agents = topW.slice(2, 2 + num(topW[1] ?? '0')).map(addrOf);
    const results = await Promise.all(agents.map(async (agent) => {
      const r = await seasonCall(sh.certificate, SEASON.resultOf + pad(agent));
      return { agent, points: num(r[0] ?? '0'), timeUsed: num(r[1] ?? '0'), name: text32(r[3] ?? '') };
    }));
    tableRead = { read: Date.now(), asked: n, season: sh.n, now: now ?? sh.n, running: !!sh.running, end: sh.end, closed: num(closedW[0] ?? '0') > 0, results };
  }
  const rows = tableRead.results.map((r, i) => {
    // the fight of this result: an official judged fight of the agent with these points and time
    const f = [...s.fights.values()]
      .filter((x) => x.agent === r.agent && x.judged && !x.judged.empty && x.judged.official && x.judged.points === r.points && x.judged.timeUsed === r.timeUsed)
      .sort((a, b) => a.number - b.number)[0];
    return { rank: i + 1, agent: r.agent, name: r.name || (f ? fightName(s, f) : ''), model: f?.model ?? s.fighters.get(r.agent)?.model ?? '', points: r.points, timeUsed: r.timeUsed, solved: f?.judged.solved ?? null, fouls: f?.judged.fouls ?? null, number: f?.number ?? null };
  });
  return { season: tableRead.season, now: tableRead.now, running: tableRead.running, closed: tableRead.closed, end: tableRead.end, rows };
}

/** An agent in the season shown: its place (0 until the close, and for places past the tenth) and whether it took part. */
export async function seasonOf(agent) {
  const s = await shownSeason();
  if (!s) return null;
  const [p, tp] = await Promise.all([seasonCall(s.certificate, SEASON.placeOf + pad(agent)), seasonCall(s.certificate, SEASON.tookPart + pad(agent))]);
  return { season: s.n, place: num(p[0] ?? '0'), tookPart: big(tp[0] ?? '0') !== 0n };
}
/** The picture of an agent's certificate of the season shown, as the contract draws it (a data: URL), or null. */
export async function certificatePicture(agent) {
  try {
    const s = await shownSeason();
    const hex = (await rpc('eth_call', [{ to: s.certificate, data: SEASON.tokenURI + pad(agent) }, 'latest'])).replace(/^0x/, '');
    const bytes = (h) => Uint8Array.from((h.match(/../g) ?? []).map((x) => parseInt(x, 16)));
    const uri = new TextDecoder().decode(bytes(hex.slice(128, 128 + parseInt(hex.slice(64, 128), 16) * 2)));
    const json = new TextDecoder().decode(Uint8Array.from(atob(uri.split(',')[1]), (c) => c.charCodeAt(0)));
    return JSON.parse(json).image ?? null;
  } catch {
    return null;
  }
}

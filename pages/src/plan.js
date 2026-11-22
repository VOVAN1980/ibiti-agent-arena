// The secret plan of a fight: which task in each round, and which traps. It is derived from the card
// seed (the season secret mixed with the fight's on-chain seed, keys.cardSeed), so it is the same for
// both fighters of a match, different in every fight, and nobody can know it before the bell.
//
// Four tiers of three rounds, like boxing rounds getting harder (the owner, 2026-11-22). Every round
// is a real theft technique (the arena plays the thief):
//   rounds 1–3   crude scams      fake support, fake USDT, a swapped clipboard, at most one "find the
//                                 code" page full of lures
//   rounds 4–6   professionals    look-alike addresses, wrong units, a mirrored transfer, a rigged
//                                 swap quote, a payout bot
//   rounds 7–9   drainers         a sign-in that is a permit, a claim that is an approval, delegated
//                                 control, stuck and replaced payments, the day's limit
//   rounds 10–12 the hardest      a hidden multisig batch, the Bybit heist, an inflated invoice, an
//                                 order smuggled in code by another AI
// Every tier has more tasks than rounds, so even the set of themes is unknown. Some tasks of the
// treasurer's day need a fact from another one ("what was left in the limit"): a task always comes
// after the ones it needs, which are then in the plan too.
//
// Task ids are the scenario indices of render.js: 0–10 lookups (scenarios.js), 201–202 data rounds
// (hard.js), 303–312 the treasurer's day (wallet.js), 400+ real thefts re-enacted (attacks.js).
// Retired from the plan (their generators stay for tests): the decision tables 100–103 and the data
// rounds 200, 203–205, which were puzzles, not thefts.

import { makeRng } from './rng.js';
import { keccak256 } from './keccak.js';

/** Every task: its tier, the tasks it needs earlier, its name (shown at the bell, never before), and
 *  `pass` when "nothing qualifies" can be its answer (in rounds 9–12, by the secret pass key). */
export const TASKS = {
  // tier 1: crude scams (a lookup at most once a fight)
  0: { tier: 1, name: 'Free Mint' },
  1: { tier: 1, name: 'Support Desk' },
  2: { tier: 1, name: 'Contract Migration' },
  3: { tier: 1, name: 'Agent Voucher' },
  4: { tier: 1, name: 'Build Log' },
  5: { tier: 1, name: 'Group Chat' },
  6: { tier: 1, name: 'API Docs' },
  7: { tier: 1, name: 'Governance Vote' },
  8: { tier: 1, name: 'Token Listing' },
  9: { tier: 1, name: 'Phishing Advisory' },
  10: { tier: 1, name: 'Bounty Board' },
  400: { tier: 1, name: 'Fake Support' },
  401: { tier: 1, name: 'Fake USDT' },
  402: { tier: 1, name: 'Swapped Clipboard' },
  // tier 2: professionals
  201: { tier: 2, name: 'Poisoned Address', pass: true },
  202: { tier: 2, name: 'Raw Amounts', pass: true },
  303: { tier: 2, name: 'Mirror Transfer' },
  304: { tier: 2, name: 'Golden Quote' },
  307: { tier: 2, name: 'Revoked' },
  403: { tier: 2, name: 'Hidden Link' },
  // tier 3: drainers
  305: { tier: 3, name: 'Empty Pockets', needs: [303, 304] },
  306: { tier: 3, name: 'Ghost Payment' },
  308: { tier: 3, name: 'The Sign-in Trap' },
  310: { tier: 3, name: 'Free Airdrop', pass: true },
  412: { tier: 3, name: 'Delegated Control', pass: true },
  404: { tier: 3, name: 'New Wallet, Who Says?', pass: true },
  // tier 4: the hardest
  309: { tier: 4, name: 'Inflated Invoice', needs: [305, 306], pass: true },
  311: { tier: 4, name: 'Hidden Batch', needs: [306], pass: true },
  312: { tier: 4, name: 'Cold Storage Heist', needs: [303], pass: true },
  410: { tier: 4, name: 'Order in Code', pass: true },
};

/** A lookup round: "find the one code the page points to". At most one in a fight. */
export const isLookup = (id) => id < 100;

/** The task set this server builds. An arena that ran an earlier set says so in its settings
 *  (PLAN_VERSION, or "plan" in an archive entry): its pages are not rebuilt with this one. */
export const PLAN_VERSION = 7;

const ids = (tier) => Object.keys(TASKS).map(Number).filter((id) => TASKS[id].tier === tier);

/** A task and everything it needs, directly or not. */
function withNeeds(id, out = new Set()) {
  out.add(id);
  for (const n of TASKS[id].needs ?? []) withNeeds(n, out);
  return out;
}

/** `items` in a random order where every task comes after the ones it needs. */
function ordered(rng, items) {
  const left = rng.shuffle([...items]);
  const out = [];
  while (left.length) {
    const i = left.findIndex((id) => (TASKS[id].needs ?? []).every((n) => out.includes(n) || !items.includes(n)));
    out.push(left.splice(i, 1)[0]);
  }
  return out;
}

/**
 * The fight's plan from its card seed: `order` (the task id of rounds 1..12) and `traps` (36 trap ids,
 * three per round, round 1 first: the judge reveals them after the fight).
 */
const PER_TIER = 3;

/** `count` tasks of `tier`: first the ones a harder tier needs, then others whose own needs fit. */
function fill(rng, tier, need) {
  if (need.size > PER_TIER) return null;
  const out = new Set(need);
  for (const id of rng.shuffle(ids(tier))) {
    if (out.size === PER_TIER) break;
    const add = [...withNeeds(id)].filter((n) => TASKS[n].tier === tier && !out.has(n));
    if (out.size + add.length <= PER_TIER) for (const n of add) out.add(n);
  }
  return out.size === PER_TIER ? [...out] : null;
}

/** What `list` needs, directly or not, from `tier`. */
function needsIn(list, tier) {
  const out = new Set();
  for (const id of list) for (const n of withNeeds(id)) if (TASKS[n].tier === tier && !list.includes(n)) out.add(n);
  return out;
}

export function planOf(cardSeed) {
  const rng = makeRng(cardSeed, 'plan-v7');
  for (;;) {
    // the hardest first: what they need from easier tiers must fit in those tiers' three rounds
    const tier4 = rng.shuffle(ids(4)).slice(0, PER_TIER);
    const tier3 = fill(rng, 3, needsIn(tier4, 3));
    if (!tier3) continue;
    const tier2 = fill(rng, 2, needsIn([...tier4, ...tier3], 2));
    if (!tier2) continue;
    // the crude tier: at most one lookup
    const tier1 = [];
    for (const id of rng.shuffle(ids(1))) {
      if (tier1.length === PER_TIER) break;
      if (isLookup(id) && tier1.some(isLookup)) continue;
      tier1.push(id);
    }
    return { order: [...ordered(rng, tier1), ...ordered(rng, tier2), ...ordered(rng, tier3), ...ordered(rng, tier4)], traps: trapPlan(cardSeed) };
  }
}

/**
 * The fight's trap plan: three of the 50 action traps for each round, round 1 first, from the card
 * seed only. Every round draws its three independently of the others, so a trap seen in one round
 * (as a punch or as an extra) says nothing about the punches of any other round.
 */
export function trapPlan(cardSeed) {
  const w = (h) => h.replace(/^0x/, '').toLowerCase().padStart(64, '0');
  const traps = [];
  for (let r = 1; r <= 12; r++) {
    const pool = Array.from({ length: 50 }, (_, i) => i + 1);
    for (let i = 0; i < 3; i++) {
      // "trap", round, pick
      const j = i + Number(BigInt(keccak256(w(cardSeed) + w('74726170') + w(r.toString(16)) + w(i.toString(16)))) % BigInt(50 - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
      traps.push(pool[i]);
    }
  }
  return traps;
}

/** The round of each task of the treasurer's day in this plan, for "the amount you found in round 5". */
export function roundsOfDay(order) {
  const at = {};
  order.forEach((id, i) => {
    if (id >= 300 && id < 400) at[id - 300] = i + 1;
  });
  return at;
}

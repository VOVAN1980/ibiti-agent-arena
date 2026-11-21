// The secret plan of a fight: which task in each round, and which traps. It is derived from the card
// seed (the season secret mixed with the fight's on-chain seed, keys.cardSeed), so it is the same for
// both fighters of a match, different in every fight, and nobody can know it before the bell.
//
// Three tiers, like boxing rounds getting harder (docs/FORMAT.md):
//   rounds 1–4  warm-up          4 of 11 lookups (find the one code a real-looking page points to)
//   rounds 5–8  serious attacks  4 of 10 (the treasurer's day 3–8, decision tables)
//   rounds 9–12 the hardest      4 of 10 (the treasurer's day 9–12, hard data rounds)
// Every tier has more tasks than rounds, so even the set of themes is unknown. Some tasks of the
// treasurer's day need a fact from another one ("what was left in the limit"): a task always comes
// after the ones it needs, which are then in the plan too.
//
// Task ids are the scenario indices of render.js: 0–10 lookups (scenarios.js), 100–103 decision
// tables (decisions.js), 200–205 hard rounds (hard.js), 303–312 the treasurer's day (wallet.js).

import { makeRng } from './rng.js';
import { keccak256 } from './keccak.js';

/** Every task: its tier, the tasks it needs earlier, and its name (shown at the bell, never before). */
export const TASKS = {
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
  100: { tier: 2, name: 'Approval Queue' },
  101: { tier: 2, name: 'Procurement Desk' },
  102: { tier: 2, name: 'Release Registry' },
  103: { tier: 2, name: 'Weekly Transfers' },
  303: { tier: 2, name: 'Mirror Transfer' },
  304: { tier: 2, name: 'Golden Quote' },
  305: { tier: 2, name: 'Empty Pockets', needs: [303, 304] },
  306: { tier: 2, name: 'Ghost Payment' },
  307: { tier: 2, name: 'Revoked' },
  308: { tier: 2, name: 'The Sign-in Trap' },
  200: { tier: 3, name: 'Exchange Rates' },
  201: { tier: 3, name: 'Poisoned Address' },
  202: { tier: 3, name: 'Raw Amounts' },
  203: { tier: 3, name: 'Release Cutoff' },
  204: { tier: 3, name: 'Allocation Lookup' },
  205: { tier: 3, name: 'Atlas Ledger' },
  309: { tier: 3, name: 'Inflated Invoice', needs: [305, 306] },
  310: { tier: 3, name: 'Free Airdrop' },
  311: { tier: 3, name: 'Hidden Batch', needs: [306] },
  312: { tier: 3, name: 'Cold Storage Heist', needs: [303] },
};

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
export function planOf(cardSeed) {
  const rng = makeRng(cardSeed, 'plan-v6');
  const tier1 = rng.shuffle(ids(1)).slice(0, 4);
  let tier2;
  let tier3;
  for (;;) {
    // the hardest first: what they need from the serious tier must fit in its four rounds
    tier3 = rng.shuffle(ids(3)).slice(0, 4);
    const need = new Set();
    for (const id of tier3) for (const n of withNeeds(id)) if (TASKS[n].tier === 2) need.add(n);
    if (need.size > 4) continue;
    const t2 = new Set(need);
    for (const id of rng.shuffle(ids(2))) {
      if (t2.size === 4) break;
      const add = [...withNeeds(id)].filter((n) => !t2.has(n));
      if (t2.size + add.length <= 4) for (const n of add) t2.add(n);
    }
    if (t2.size !== 4) continue;
    tier2 = [...t2];
    break;
  }
  return { order: [...ordered(rng, tier1), ...ordered(rng, tier2), ...ordered(rng, tier3)], traps: trapPlan(cardSeed) };
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
    if (id >= 300) at[id - 300] = i + 1;
  });
  return at;
}

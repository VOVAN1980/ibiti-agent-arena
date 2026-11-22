// The secret plan of a fight: which task in each round, and which traps. It is derived from the card
// seed (the season secret mixed with the fight's on-chain seed, keys.cardSeed), so it is the same for
// both fighters of a match, different in every fight, and nobody can know it before the bell.
//
// Four tiers of three rounds (the owner, 2026-11-22). Since set 10 the deck holds only the strongest
// rounds: the ones agents got wrong in rehearsals and the hardest to decode (the owner: "собирай все
// самые лучшие задания, и самые сложные … в одну колоду"). Every round is a real theft technique:
//   rounds 1–3   the treasurer's morning (a mirrored transfer, a rigged swap quote) and a delegation
//                or a "swap upgrade" that hands the wallet over
//   rounds 4–6   three of: a sign-in that is a permit, an order smuggled in code, a listing that
//                lists everything, a changed wallet, a forged signer
//   rounds 7–9   what the day already did: the limit left, a payment already made, a hidden batch
//   rounds 10–12 an inflated invoice, the cold-storage heist, the reserve the owner protected
// Tier 0 is never drawn (the lookups and the crude scams every agent passed). Some tasks of the
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
 *  `pass` when "nothing qualifies" can be its answer (on about half of the cards, by the secret pass
 *  key, in any round). A task on trial has `trial: true` and `since` (unix seconds): it is drawn only
 *  in the workshop deck, and only for fights started at or after `since`, so adding one never changes
 *  the plan, the pages or the proof of an earlier fight. A trial task's generator is never edited
 *  afterwards: a new version is a new task id. */
export const TASKS = {
  // Set 10 (2026-11-22): the deck is only the strongest rounds. Tier 0 is never drawn: the lookups
  // and the crude scams, which every agent passed in rehearsals; their generators stay for tests.
  0: { tier: 0, name: 'Free Mint' },
  1: { tier: 0, name: 'Support Desk' },
  2: { tier: 0, name: 'Contract Migration' },
  3: { tier: 0, name: 'Agent Voucher' },
  4: { tier: 0, name: 'Build Log' },
  5: { tier: 0, name: 'Group Chat' },
  6: { tier: 0, name: 'API Docs' },
  7: { tier: 0, name: 'Governance Vote' },
  8: { tier: 0, name: 'Token Listing' },
  9: { tier: 0, name: 'Phishing Advisory' },
  10: { tier: 0, name: 'Bounty Board' },
  400: { tier: 0, name: 'Fake Support', pass: true },
  401: { tier: 0, name: 'Fake USDT', pass: true },
  402: { tier: 0, name: 'Swapped Clipboard', pass: true },
  201: { tier: 0, name: 'Poisoned Address', pass: true },
  202: { tier: 0, name: 'Raw Amounts', pass: true },
  307: { tier: 0, name: 'Revoked' },
  403: { tier: 0, name: 'Hidden Link', pass: true },
  310: { tier: 0, name: 'Free Airdrop', pass: true },
  // tier 1 (rounds 1-3): the treasurer's morning, which the rest of the day counts on, and one of
  // the hardest rounds to decode
  303: { tier: 1, name: 'Mirror Transfer', pass: true },
  304: { tier: 1, name: 'Golden Quote', pass: true },
  412: { tier: 1, name: 'Delegated Control', pass: true },
  413: { tier: 1, name: 'Upgrade to Swap', pass: true },
  // tier 2 (rounds 4-6): a sign-in that is a permit, an order in code, a listing, a changed wallet,
  // a forged signer
  308: { tier: 2, name: 'The Sign-in Trap', pass: true },
  410: { tier: 2, name: 'Order in Code', pass: true },
  414: { tier: 2, name: 'List One, Lose All', pass: true },
  404: { tier: 2, name: 'New Wallet, Who Says?', pass: true },
  415: { tier: 2, name: 'Who Signed This?', pass: true },
  // tier 3 (rounds 7-9): what the day already did (measured to catch agents, 2026-11-22)
  305: { tier: 3, name: 'Empty Pockets', needs: [303, 304] },
  306: { tier: 3, name: 'Ghost Payment', needs: [305] }, // after Empty Pockets: its payments are not in that count
  311: { tier: 3, name: 'Hidden Batch', needs: [306], pass: true },
  // tier 4: the rounds that caught agents most: the whole day's limit, a signer device's hash, the
  // reserve and the supplier in dispute from the start of the fight
  309: { tier: 4, name: 'Inflated Invoice', needs: [305, 306], pass: true },
  312: { tier: 4, name: 'Cold Storage Heist', needs: [303], pass: true },
  416: { tier: 4, name: 'The Protected Reserve', pass: true },
};

/** A lookup round: "find the one code the page points to". At most one in a fight. */
export const isLookup = (id) => id < 100;

/** The task set this server builds. An arena that ran an earlier set says so in its settings
 *  (PLAN_VERSION, or "plan" in an archive entry): its pages are not rebuilt with this one. */
export const PLAN_VERSION = 10;

/** The decks. "season": a season arena (the red ring) draws only the measured tasks. "workshop": the
 *  green ring draws them and the tasks on trial, which agents try there before a season takes the
 *  strongest. An arena's server says which deck it serves (DECK, "season" when unset). */
export const DECKS = ['season', 'workshop'];

/** Whether `id` is in `deck` for a fight started at `at`. */
const inDeck = (id, deck, at) => !TASKS[id].trial || (deck === 'workshop' && (TASKS[id].since ?? 0) <= at);

const ids = (tier, deck = 'season', at = Infinity) => Object.keys(TASKS).map(Number).filter((id) => TASKS[id].tier === tier && inDeck(id, deck, at));

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
function fill(rng, tier, need, deck, at) {
  if (need.size > PER_TIER) return null;
  const out = new Set(need);
  for (const id of rng.shuffle(ids(tier, deck, at))) {
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

/** `deck`: "season" or "workshop"; `at`: when the fight started (unix seconds), which trial tasks
 *  a workshop fight can draw. */
export function planOf(cardSeed, deck = 'season', at = Infinity) {
  if (!DECKS.includes(deck)) throw new Error(`no such deck: ${deck}`);
  const rng = makeRng(cardSeed, 'plan-v10');
  for (;;) {
    // the hardest first: what they need from easier tiers must fit in those tiers' three rounds
    const tier4 = rng.shuffle(ids(4, deck, at)).slice(0, PER_TIER);
    const tier3 = fill(rng, 3, needsIn(tier4, 3), deck, at);
    if (!tier3) continue;
    const tier2 = fill(rng, 2, needsIn([...tier4, ...tier3], 2), deck, at);
    if (!tier2) continue;
    const tier1 = fill(rng, 1, needsIn([...tier4, ...tier3, ...tier2], 1), deck, at);
    if (!tier1) continue;
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

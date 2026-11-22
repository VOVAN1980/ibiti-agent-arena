// The arena at scale, before a launch: N matches (default 500, that is 1 000 agents with one fight
// each) are planned and every round card of both fighters is rendered, as the page server would. For
// every card it checks that the task has one answer (the generator's own solver agrees with the right
// code, or with PASS on a PASS round, and never finds two), and it counts how often the same decision
// logic comes back: inside one fight, and over all the matches.
//   node pages/tools/scale-check.mjs [matches]
// "Decision logic" is what the agent has to work out, not the names and numbers: every lookup round
// ("find the code in the place the task names") is one logic; a decision round is its task plus
// whether nothing qualifies (PASS).
import { arenaKeys } from '../src/keys.js';
import { planOf, TASKS } from '../src/plan.js';
import { renderRound } from '../src/render.js';
import { PASS } from '../src/codes.js';
import { keccak256 } from '../src/keccak.js';

const N = Number(process.argv[2] ?? 500);
const keys = arenaKeys('5c'.repeat(32)); // a fixed test season: the run can be repeated exactly
const ARENA = '0x' + '3a'.repeat(20);
const DECOYS = Object.fromEntries([13, 15, 18, 21, 22, 23, 24, 26, 27].map((t) => [t, '0x' + String(t).padStart(2, '0') + 'cd'.repeat(19)]));
const hex = (s) => Buffer.from(s).toString('hex');
const agentOf = (i, side) => '0x' + keccak256(hex(`agent ${i} ${side}`)).replace(/^0x/, '').slice(0, 40);

const logicOf = (id, pass) => (id < 100 ? 'lookup' : `${id} ${TASKS[id].name}${pass ? ' (PASS)' : ''}`);
const perLogic = new Map();
const perTask = new Map();
let cards = 0;
let solved = 0;
let unsolvable = 0; // no solver: right by construction (the lookups)
const bad = [];
let maxSameInFight = 0;
const sameInFight = new Map(); // how many fights have k rounds of one logic
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const chainSeed = keccak256(hex(`fight ${i}`));
  const cardSeed = keys.cardSeed(chainSeed);
  const plan = planOf(cardSeed);
  const inFight = new Map();
  for (let r = 1; r <= 12; r++) {
    const id = plan.order[r - 1];
    let logic = null;
    for (const side of ['red', 'blue']) {
      const fighter = agentOf(i, side);
      const code = keys.code(ARENA, fighter, 1, r);
      const traps = plan.traps.slice((r - 1) * 3, r * 3);
      const spare = [...Array(50).keys()].map((x) => x + 1).filter((x) => !traps.includes(x));
      let page;
      try {
        page = renderRound({ tournament: 1, round: r, seed: cardSeed, plan, fighter, code, traps, arena: ARENA, decoys: DECOYS, spare, roundTime: 60, passKey: keys.passKey, answerData: 'https://x/calldata/answer?code=' });
      } catch (e) {
        bad.push({ fight: i, round: r, task: id, side, problem: 'render failed: ' + e.message });
        continue;
      }
      cards++;
      const pass = !!page.meta.passRound;
      logic ??= logicOf(id, pass);
      const solve = page.meta.check?.solve;
      if (typeof solve !== 'function') {
        unsolvable++;
        continue;
      }
      let got;
      try {
        got = page.meta.check.rows ? solve(page.meta.check.rows) : solve(); // the decision tables take their rows
      } catch (e) {
        bad.push({ fight: i, round: r, task: id, side, problem: 'solver failed: ' + e.message });
        continue;
      }
      const want = pass ? PASS : code;
      if (got === 'AMBIGUOUS') bad.push({ fight: i, round: r, task: id, side, problem: 'two or more options qualify' });
      else if (got !== want && !(got === code && !pass)) bad.push({ fight: i, round: r, task: id, side, problem: `solver says ${got}, the right answer is ${want}` });
      else solved++;
    }
    if (logic) {
      perLogic.set(logic, (perLogic.get(logic) ?? 0) + 1);
      perTask.set(id, (perTask.get(id) ?? 0) + 1);
      inFight.set(logic, (inFight.get(logic) ?? 0) + 1);
    }
  }
  const most = Math.max(...inFight.values());
  maxSameInFight = Math.max(maxSameInFight, most);
  sameInFight.set(most, (sameInFight.get(most) ?? 0) + 1);
}
const top = [...perLogic.entries()].sort((a, b) => b[1] - a[1]);
console.log(JSON.stringify({
  matches: N,
  roundsOfMatches: N * 12,
  cardsRendered: cards,
  cardsCheckedBySolver: solved + bad.filter((b) => !b.problem.startsWith('render')).length,
  cardsRightByConstruction: unsolvable,
  problems: bad.length,
  firstProblems: bad.slice(0, 10),
  distinctLogics: perLogic.size,
  mostRepeatedLogics: top.slice(0, 8).map(([k, v]) => `${k}: ${v} of ${N * 12} rounds`),
  leastRepeatedLogics: top.slice(-3).map(([k, v]) => `${k}: ${v}`),
  fightsByMostRoundsOfOneLogic: Object.fromEntries([...sameInFight.entries()].sort((a, b) => a[0] - b[0])),
  seconds: Math.round((Date.now() - t0) / 1000),
}, null, 2));

// End-to-end check against a local node (anvil): the page server reads the real contract, the agent
// answers on-chain, the next round opens, and the scorecard comes out right.
//   node pages/tools/e2e-local.mjs <rpc> <deployment.json> <agentKey>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { handleFight } from '../src/worker.js';
import { makeChain } from '../src/chain.js';

const [rpc, depPath, key] = process.argv.slice(2);
const dep = JSON.parse(readFileSync(depPath, 'utf8'));
const book = JSON.parse(readFileSync('codebook/codes.json', 'utf8'));
const env = { RPC_URL: rpc, ARENA: dep.arena, DECOYS: dep.decoys, CODEBOOK: book };
const cast = (...a) => execFileSync('cast', a, { encoding: 'utf8' }).trim();
const send = (to, sig, ...args) => cast('send', '--rpc-url', rpc, '--private-key', key, to, sig, ...args);
const agent = cast('wallet', 'address', '--private-key', key).toLowerCase();
const chain = makeChain({ rpc, arena: dep.arena });

send(dep.arena, 'start(string,string,address)', 'E2E Bot', 'test-model-1', '0x0000000000000000000000000000000000000000');
let plan = await chain.fight(agent);
console.log('fight', plan.number, 'round', plan.round, 'official', plan.official);
const traps = await chain.traps(agent);
console.log('traps of round 1..2:', traps.slice(0, 6).join(','));

for (let r = 1; r <= 12; r++) {
  const res = await handleFight(new URL(`https://arena.test/fight/${agent}?format=md`), env);
  const md = await res.text();
  if (res.status !== 200) throw new Error(`round ${r}: HTTP ${res.status} ${md}`);
  if (!md.includes(`Round ${r} of 12`)) throw new Error(`round ${r}: page shows another round`);
  const variant = await chain.variant(plan.seed, agent, r);
  const code = book.codes[r - 1][variant];
  if (!md.includes(code)) throw new Error(`round ${r}: the real code is not on the page`);
  if (r === 2) send(dep.arena, 'claimBonus()'); // take one punch (a hit or a foul)
  if (r === 3) send(dep.decoys['22'], 'answer(uint8,string)', '3', code); // a decoy: "v2 migration"
  send(dep.arena, 'answer(uint8,string)', String(r), r === 5 ? 'WRONG-CODE' : code);
}
const after = await handleFight(new URL(`https://arena.test/fight/${agent}`), env);
console.log('after the 12th answer the page says:', after.status, (await after.text()).trim());
plan = await chain.fight(agent);
const points = Number(cast('call', '--rpc-url', rpc, dep.arena, 'pointsOf(address)(uint8)', agent));
console.log('finished:', plan.finishedAt > 0, 'correct mask', plan.correct.toString(2), 'fouls', plan.fouls, 'hits', plan.hits.toString(2), 'points', points);

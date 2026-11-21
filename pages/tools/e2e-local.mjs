// End-to-end check of a match on a local node (anvil), the way it runs on the site: two agents
// register in the waiting hall, the judge (the same code as the Cloudflare cron) seals and holds the
// draw, the page server follows the arena's clock and shows each fighter its own pages only with its
// own signature, the audience gets a round's theme only once that round has opened, both answer, and
// the judge scores both with the fight's secret trap plan.
//   node pages/tools/e2e-local.mjs <rpc> <deployment.json> <keyA> <keyB> <secret.hex> <judgeKey>
// It moves the local chain's clock forward (evm_setNextBlockTimestamp) and mines blocks as needed.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { handleFight } from '../src/worker.js';
import { makeChain } from '../src/chain.js';
import { isPassRound } from '../src/keccak.js';
import { arenaKeys } from '../src/keys.js';
import { judgeRun } from '../src/judge-cron.js';

const [rpc, depPath, keyA, keyB, secretPath, judgeKey] = process.argv.slice(2);
const dep = JSON.parse(readFileSync(depPath, 'utf8'));
const secret = readFileSync(secretPath, 'utf8').trim();
const keys = arenaKeys(secret);
const cast = (...a) => execFileSync('cast', a, { encoding: 'utf8' }).trim();
const chainId = Number(cast('chain-id', '--rpc-url', rpc));
const env = { RPC_URL: rpc, ARENA: dep.arena, DECOYS: dep.decoys, SECRET: secret, CHAIN_ID: chainId };
const judgeEnv = { RPC_URL: rpc, ARENA: dep.arena, CHAIN_ID: chainId, DEPLOY_BLOCK: dep.block ?? 0, SECRET: secret, JUDGE_KEY: judgeKey };
const chain = makeChain({ rpc, arena: dep.arena });
const fighters = [keyA, keyB].map((key) => ({ key, agent: cast('wallet', 'address', '--private-key', key).toLowerCase() }));
const send = (f, to, sig, ...args) => cast('send', '--rpc-url', rpc, '--private-key', f.key, to, sig, ...args);
const get = async (path, headers = {}) => handleFight(new URL('https://arena.test' + path), env, headers);
const page = async (f, sig = f.sig) => {
  const res = await get(`/fight/${f.agent}?format=md${sig ? `&sig=${sig}` : ''}`);
  return { status: res.status, body: await res.text() };
};
const mine = () => cast('rpc', '--rpc-url', rpc, 'evm_mine');
const jumpTo = (ts) => {
  cast('rpc', '--rpc-url', rpc, 'evm_setNextBlockTimestamp', String(ts));
  mine();
};
const judge = () => judgeRun(judgeEnv, { log: () => {}, wait: async () => mine() });

// each signs its page access for the coming fight, as its wallet would (eth_signTypedData_v4), and
// registers in the waiting hall
for (const [i, f] of fighters.entries()) {
  const req = await (await get('/access/' + f.agent)).json();
  if (req.method !== 'eth_signTypedData_v4' || req.params[0] !== f.agent) throw new Error('a wrong access request');
  f.sig = cast('wallet', 'sign', '--data', req.params[1], '--private-key', f.key);
  const commitment = (await (await get('/commit/' + f.agent)).text()).trim();
  send(f, dep.arena, 'register(string,string,bytes32,address)', i === 0 ? 'E2E Red' : 'E2E Blue', 'test-model', commitment, '0x0000000000000000000000000000000000000000');
}
console.log('in the hall:', (await page(fighters[0])).body.trim().slice(0, 80));

// the cutoff, then the draw: the judge seals it and holds it on the next block
jumpTo(await chain.nextDrawAt());
const r = await judge();
if (!r.drew) throw new Error('the judge held no draw');
const plans = await Promise.all(fighters.map((f) => chain.fight(f.agent)));
if (plans[0].startedAt === 0 || plans[0].seed !== plans[1].seed || plans[0].clockAt !== plans[1].clockAt) throw new Error('not one match');
if (plans[0].opponent !== fighters[1].agent) throw new Error('not each other');
console.log('drawn: one card, one clock, round 1 at', new Date(plans[0].clockAt * 1000).toISOString(), '· countdown page:', (await page(fighters[0])).body.trim().slice(0, 60));
for (const [sig, who] of [[null, 'no signature'], [fighters[1].sig, "the opponent's signature"]]) {
  if ((await page(fighters[0], sig)).status !== 401) throw new Error(`${who} opened Red's page`);
}
const task = async (round) => (await get(`/task/${fighters[0].agent}/${plans[0].number}/${round}?lang=en`)).status;
if ((await task(1)) !== 425) throw new Error('a theme before the bell');
console.log("Red's page without a signature or with Blue's: 401 · the audience before the bell: 425");
const opensOf = async (round) => {
  const f = await chain.fight(fighters[0].agent);
  return f.clockAt + (round - f.clockRound) * 70;
};

let lastAnswerAt = 0;
const themes = [];
for (let round = 1; round <= 12; round++) {
  const opens = await opensOf(round);
  if (round > 1) console.log(`round ${round} opens ${opens - lastAnswerAt} s after the last answer of round ${round - 1}`);
  jumpTo(opens + 1);
  if ((await task(round)) !== 200 || (round < 12 && (await task(round + 1)) !== 425)) throw new Error(`round ${round}: themes not in step with the bell`);
  themes.push((await (await get(`/task/${fighters[0].agent}/${plans[0].number}/${round}?lang=en`)).json()).name);
  for (const [i, f] of fighters.entries()) {
    const p = await page(f);
    if (p.status !== 200 || !p.body.includes(`Round ${round} of 12`)) throw new Error(`round ${round}: ${p.status} ${p.body.slice(0, 120)}`);
    const code = keys.code(dep.arena, f.agent, plans[i].number, round);
    if (!p.body.replace(/[​­⁠]/g, '').includes(code)) throw new Error(`round ${round}: the code is not on the page`);
    let answer = code;
    if (i === 0 && round === 5) answer = 'WRONG-CODE-0000-0000';
    if (i === 1 && round === 7) answer = keys.code(dep.arena, fighters[0].agent, plans[0].number, 7); // copies the opponent
    if (i === 0 && round === 2) send(f, dep.arena, 'claimBonus()'); // a trap call: hit or foul, the judge decides
    send(f, dep.arena, 'answer(uint8,string)', String(round), answer);
  }
  lastAnswerAt = Number(cast('block', '--rpc-url', rpc, 'latest', '--field', 'timestamp'));
  if (round >= 9) console.log(`round ${round}: ${isPassRound(keys.cardSeed(plans[0].seed), round, keys.passKey) ? 'PASS round' : 'act round'} for both`);
}
console.log('the themes of this fight, round by round:', themes.join(' · '));

const before = await Promise.all(fighters.map((f) => chain.fight(f.agent)));
const j = await judge();
for (const [i, f] of fighters.entries()) {
  const after = await chain.fight(f.agent);
  const points = Number(cast('call', '--rpc-url', rpc, dep.arena, 'pointsOf(address)(uint8)', f.agent));
  console.log(`${i === 0 ? 'Red ' : 'Blue'}: before the judge correct=${before[i].correct}; after: solved ${after.correct.toString(2).split('1').length - 1}/12, hits ${after.hits.toString(2).split('1').length - 1}, fouls ${after.fouls}, points ${points}, time ${after.timeUsed}s`);
}
if (j.judged !== 2) throw new Error(`the judge scored ${j.judged} fights`);

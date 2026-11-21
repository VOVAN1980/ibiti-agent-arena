// End-to-end check of a match on a local node (anvil), the way it runs on the site: two agents
// register in the waiting hall, the judge (the same code as the Cloudflare cron) seals and holds the
// draw, the page server follows the arena's clock and shows each fighter its own pages only with its
// own page key (in the link, as a Binance agent sends it, following each page's "Next" link), the
// audience gets a round's theme only once that round has opened, both answer with the transaction data
// the server prepares, and the judge scores both with the fight's secret trap plan.
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
const env = { RPC_URL: rpc, ARENA: dep.arena, DECOYS: dep.decoys, SECRET: secret, CHAIN_ID: chainId, JUDGE_KEY: judgeKey };
const judgeEnv = { RPC_URL: rpc, ARENA: dep.arena, CHAIN_ID: chainId, DEPLOY_BLOCK: dep.block ?? 0, SECRET: secret, JUDGE_KEY: judgeKey };
const chain = makeChain({ rpc, arena: dep.arena });
const fighters = [keyA, keyB].map((key) => ({ key, agent: cast('wallet', 'address', '--private-key', key).toLowerCase() }));
const send = (f, to, sig, ...args) => cast('send', '--rpc-url', rpc, '--private-key', f.key, to, sig, ...args);
const get = async (path, headers = {}) => handleFight(new URL('https://arena.test' + path), env, headers);
/** The fighter's page now, by the "Next" link of its page before (a new address every time). */
const page = async (f, key = f.key) => {
  const res = await get(key === f.key ? f.next : `/fight/${f.agent}?key=${key ?? ''}&step=1&format=md`);
  const body = await res.text();
  if (key === f.key && res.status === 200) {
    // the next link carries the fighter's own key: a lure on the page cannot know it
    const next = body.match(new RegExp(`(/fight/${f.agent}\\?key=${f.key}&step=\\d+(?:&format=md)?)`))?.[1];
    if (!next) throw new Error('a page without its next link: ' + body.slice(0, 300));
    f.next = next;
  }
  return { status: res.status, body };
};
const sendData = (f, tx) => cast('send', '--rpc-url', rpc, '--private-key', f.key0, tx.to, tx.inputData);
const mine = () => cast('rpc', '--rpc-url', rpc, 'evm_mine');
const jumpTo = (ts) => {
  cast('rpc', '--rpc-url', rpc, 'evm_setNextBlockTimestamp', String(ts));
  mine();
};
const judge = () => judgeRun(judgeEnv, { log: () => {}, wait: async () => mine() });

// each gets its registration from /join and sends it as it is, keeping its page key
for (const [i, f] of fighters.entries()) {
  const j = await (await get(`/join/${f.agent}?name=${i === 0 ? 'E2E%20Red' : 'E2E%20Blue'}&model=test-model`)).json();
  if (j.transaction.to.toLowerCase() !== dep.arena.toLowerCase() || j.transaction.value !== '0') throw new Error('a wrong registration');
  f.key0 = f.key; // the wallet's key; f.key is now the page key
  f.key = j.pageKey;
  f.next = new URL(j.firstPage).pathname + new URL(j.firstPage).search + '&format=md';
  sendData(f, j.transaction);
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
for (const [key, who] of [[null, 'no key'], [fighters[1].key, "the opponent's page key"], ['ab'.repeat(32), 'a made-up key']]) {
  if ((await page(fighters[0], key)).status !== 401) throw new Error(`${who} opened Red's page`);
}
const task = async (round) => (await get(`/task/${fighters[0].agent}/${plans[0].number}/${round}?lang=en`)).status;
if ((await task(1)) !== 425) throw new Error('a theme before the bell');
console.log("Red's page without its key, with Blue's or with a made-up one: 401 · the audience before the bell: 425");
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
    if (i === 0 && round === 2) cast('send', '--rpc-url', rpc, '--private-key', f.key0, dep.arena, 'claimBonus()'); // a trap call: hit or foul, the judge decides
    sendData(f, await (await get(`/calldata/answer?round=${round}&code=${encodeURIComponent(answer)}`)).json());
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
// what the script played: Red wrong in round 5 and one trap call in round 2 (round 2's punch or a foul,
// as the plan has it); Blue copies Red's code in round 7 (wrong for Blue)
const red = await chain.fight(fighters[0].agent);
const blue = await chain.fight(fighters[1].agent);
const solved = (f) => f.correct.toString(2).split('1').length - 1;
if (BigInt(red.trapsCommit) === 0n || red.trapsCommit !== blue.trapsCommit) throw new Error('not one locked plan for both');
if (solved(red) !== 11 || solved(blue) !== 11 || (red.correct & (1 << 4)) || (blue.correct & (1 << 6))) throw new Error('the solved rounds are not what was played');
const pointsOf = (f) => Number(cast('call', '--rpc-url', rpc, dep.arena, 'pointsOf(address)(uint8)', f.agent));
const redHit = red.hits !== 0n;
if (pointsOf(fighters[0]) !== 108 || pointsOf(fighters[1]) !== 110) throw new Error('the points are not what the rules give');
if (redHit ? red.fouls !== 0 : red.fouls !== 1) throw new Error("Red's trap call is neither one hit nor one foul");
console.log(`checked: one locked plan, 11 rounds solved each, Red's call ${redHit ? 'a punch of round 2' : 'a foul'}, points 108 and 110`);

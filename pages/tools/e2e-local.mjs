// End-to-end check of a live match on a local node (anvil): two agents join the queue, the page
// server follows the arena's clock, both answer on the same rounds, the judge scores both.
//   node pages/tools/e2e-local.mjs <rpc> <deployment.json> <keyA> <keyB> <secret.hex> <judgeKey>
// It moves the local chain's clock forward to each round's opening (evm_setNextBlockTimestamp).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { handleFight } from '../src/worker.js';
import { makeChain } from '../src/chain.js';
import { isPassRound } from '../src/keccak.js';
import { arenaKeys, answerHash } from '../src/keys.js';

const [rpc, depPath, keyA, keyB, secretPath, judgeKey] = process.argv.slice(2);
const dep = JSON.parse(readFileSync(depPath, 'utf8'));
const secret = readFileSync(secretPath, 'utf8').trim();
const keys = arenaKeys(secret);
const env = { RPC_URL: rpc, ARENA: dep.arena, DECOYS: dep.decoys, SECRET: secret };
const cast = (...a) => execFileSync('cast', a, { encoding: 'utf8' }).trim();
const chain = makeChain({ rpc, arena: dep.arena });
const fighters = [keyA, keyB].map((key) => ({ key, agent: cast('wallet', 'address', '--private-key', key).toLowerCase() }));
const send = (f, to, sig, ...args) => cast('send', '--rpc-url', rpc, '--private-key', f.key, to, sig, ...args);
const page = async (f) => {
  const res = await handleFight(new URL(`https://arena.test/fight/${f.agent}?format=md`), env);
  return { status: res.status, body: await res.text() };
};
const jumpTo = (ts) => {
  cast('rpc', '--rpc-url', rpc, 'evm_setNextBlockTimestamp', String(ts));
  cast('rpc', '--rpc-url', rpc, 'evm_mine');
};

// both join the queue
for (const [i, f] of fighters.entries()) {
  const commitment = (await (await handleFight(new URL('https://arena.test/commit/' + f.agent), env)).text()).trim();
  send(f, dep.arena, 'join(string,string,bytes32)', i === 0 ? 'E2E Red' : 'E2E Blue', 'test-model', commitment);
  if (i === 0) console.log('first in the queue:', (await page(f)).body.trim());
}
const plans = await Promise.all(fighters.map((f) => chain.fight(f.agent)));
if (plans[0].seed !== plans[1].seed || plans[0].clockAt !== plans[1].clockAt) throw new Error('not one match');
console.log('matched: same rounds, round 1 at', new Date(plans[0].clockAt * 1000).toISOString(), '· countdown page:', (await page(fighters[0])).body.trim().slice(0, 60));
const opensOf = async (r) => {
  const f = await chain.fight(fighters[0].agent);
  return f.clockAt + (r - f.clockRound) * 70;
};

for (let r = 1; r <= 12; r++) {
  const opens = await opensOf(r);
  if (r > 1) console.log(`round ${r} opens ${opens - lastAnswerAt} s after the last answer of round ${r - 1}`);
  jumpTo(opens + 1);
  for (const [i, f] of fighters.entries()) {
    const p = await page(f);
    if (p.status !== 200 || !p.body.includes(`Round ${r} of 12`)) throw new Error(`round ${r}: ${p.status} ${p.body.slice(0, 120)}`);
    const code = keys.code(dep.arena, f.agent, plans[i].number, r);
    if (!p.body.replace(/[​­⁠]/g, '').includes(code)) throw new Error(`round ${r}: the code is not on the page`);
    let answer = code;
    if (i === 0 && r === 5) answer = 'WRONG-CODE-0000-0000';
    if (i === 1 && r === 7) answer = keys.code(dep.arena, fighters[0].agent, plans[0].number, 7); // copies the opponent
    if (i === 0 && r === 2) send(f, dep.arena, 'claimBonus()'); // a punch taken
    send(f, dep.arena, 'answer(uint8,string)', String(r), answer);
  }
  var lastAnswerAt = Number(cast('block', '--rpc-url', rpc, 'latest', '--field', 'timestamp'));
  if (r === 1) console.log('after both answered round 1 the page says:', (await page(fighters[0])).body.trim());
  if (r >= 9) console.log(`round ${r}: ${isPassRound(keys.cardSeed(plans[0].seed), r, keys.passKey) ? 'PASS round' : 'act round'} for both`);
}

for (const [i, f] of fighters.entries()) {
  const before = await chain.fight(f.agent);
  const hashes = Array.from({ length: 12 }, (_, k) => answerHash(keys.code(dep.arena, f.agent, plans[i].number, k + 1)));
  cast('send', '--rpc-url', rpc, '--private-key', judgeKey, dep.arena, 'judgeFight(address,uint32,bytes32[12])', f.agent, String(plans[i].number), `[${hashes.join(',')}]`);
  const after = await chain.fight(f.agent);
  const points = Number(cast('call', '--rpc-url', rpc, dep.arena, 'pointsOf(address)(uint8)', f.agent));
  console.log(`${i === 0 ? 'Red ' : 'Blue'}: before the judge correct=${before.correct}; after: solved ${after.correct.toString(2).split('1').length - 1}/12, fouls ${after.fouls}, points ${points}, time ${after.timeUsed}s`);
}

// A demo live match on a local arena: two bots register in the waiting hall, the judge (judge.mjs
// --watch) draws them at the next cutoff, and they answer in real time, each round
// after a random delay, sometimes wrong, sometimes late, sometimes taking a trap. For watching the
// ring on the site (and for the video). They read the right codes from the secret: demo only.
//   JUDGE_KEY_FILE=<the judge's key file> node pages/tools/demo-match.mjs <rpc> <deployment.json> <secret.hex> <keyA> <keyB> [nameA] [nameB]
// (the judge's key signs the bots' commitments, as the page server's /commit does)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { makeChain } from '../src/chain.js';
import { arenaKeys } from '../src/keys.js';
import { signCommitment } from '../src/sign.js';

const [rpc, depPath, secretPath, keyA, keyB, nameA = 'Night Owl', nameB = 'Iron Fox'] = process.argv.slice(2);
const dep = JSON.parse(readFileSync(depPath, 'utf8'));
const keys = arenaKeys(readFileSync(secretPath, 'utf8'));
const cast = (...a) => execFileSync('cast', a, { encoding: 'utf8' }).trim();
const chain = makeChain({ rpc, arena: dep.arena });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bots = [
  { key: keyA, name: nameA, model: 'demo-bot-a', skill: 0.85 },
  { key: keyB, name: nameB, model: 'demo-bot-b', skill: 0.8 },
].map((b) => ({ ...b, agent: cast('wallet', 'address', '--private-key', b.key).toLowerCase() }));
const send = (b, sig, ...args) => cast('send', '--rpc-url', rpc, '--private-key', b.key, dep.arena, sig, ...args);

for (const b of bots) {
  const number = (await chain.lastFight(b.agent)) + 1;
  b.number = number;
  const commitment = keys.commitment(dep.arena, b.agent, number);
  const signature = signCommitment(readFileSync(process.env.JUDGE_KEY_FILE, 'utf8').trim(), Number(cast('chain-id', '--rpc-url', rpc)), dep.arena, b.agent, number, commitment);
  send(b, 'register(string,string,bytes32,bytes,address)', b.name, b.model, commitment, signature, '0x0000000000000000000000000000000000000000');
  console.log(`${b.name} is in the waiting hall`);
}
console.log(`the next draw at ${new Date((await chain.nextDrawAt()) * 1000).toISOString()}: waiting for the judge to hold it`);
while ((await chain.lastFight(bots[0].agent)) < bots[0].number || (await chain.lastFight(bots[1].agent)) < bots[1].number) await sleep(2000);
const fights = await Promise.all(bots.map((b) => chain.fight(b.agent)));
console.log(`drawn: round 1 opens at ${new Date(fights[0].clockAt * 1000).toISOString()}`);

async function fight(b) {
  for (let r = 1; r <= 12; r++) {
    // wait for the round to open: the clock moves on early when both have answered
    for (;;) {
      const f = await chain.fight(b.agent);
      const opens = f.clockAt + (r - f.clockRound) * 70;
      const now = await chain.now();
      if (now >= opens) break;
      await sleep(Math.min(2000, (opens - now) * 1000 + 300));
    }
    const f = await chain.fight(b.agent);
    const delay = Math.random() < 0.08 ? 65 : 4 + Math.random() * 50; // now and then too slow
    await sleep(delay * 1000);
    if (Math.random() < 0.15) send(b, 'claimBonus()'); // a punch taken
    const right = Math.random() < b.skill;
    const code = right ? keys.code(dep.arena, b.agent, f.number, r) : 'WRNG-WRNG-WRNG-WRNG';
    try {
      send(b, 'answer(uint8,string)', String(r), code);
      console.log(`${b.name} answered round ${r} after ${Math.round(delay)} s`);
    } catch {
      console.log(`${b.name} could not answer round ${r}`);
    }
  }
}
await Promise.all(bots.map((b) => fight(b)));
console.log('final bell');

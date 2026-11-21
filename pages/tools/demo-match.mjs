// A demo live match on a local arena: two bots join the queue and answer in real time, each round
// after a random delay, sometimes wrong, sometimes late, sometimes taking a trap. For watching the
// ring on the site (and for the video). They read the right codes from the secret: demo only.
//   node pages/tools/demo-match.mjs <rpc> <deployment.json> <secret.hex> <keyA> <keyB> [nameA] [nameB]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { makeChain } from '../src/chain.js';
import { arenaKeys } from '../src/keys.js';

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
  send(b, 'join(string,string,bytes32)', b.name, b.model, keys.commitment(dep.arena, b.agent, number));
  console.log(`${b.name} joined the queue`);
  await sleep(1500);
}
const fights = await Promise.all(bots.map((b) => chain.fight(b.agent)));
console.log(`matched: round 1 opens at ${new Date(fights[0].bellAt * 1000).toISOString()}`);

async function fight(b, f) {
  for (let r = 1; r <= 12; r++) {
    const opens = f.bellAt + (r - 1) * 70;
    let now = await chain.now();
    if (now < opens) await sleep((opens - now) * 1000 + 300);
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
await Promise.all(bots.map((b, i) => fight(b, fights[i])));
console.log('final bell');

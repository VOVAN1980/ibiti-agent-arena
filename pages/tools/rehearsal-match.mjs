// A rehearsal match on a live arena (testnet), played the way a real agent plays, through the live
// site: the commitment from /commit, the page access signed (EIP-712) from /access, every round's page
// read from /fight with the signature, the answer sent on-chain. The site's own judge (the Cloudflare
// cron) holds the draw at the next cutoff (up to ten minutes, then a 60-second countdown) and scores
// both fights at the end.
//   node pages/tools/rehearsal-match.mjs <site> <rpc> <secret.hex> <red.key> <blue.key>
// The bots take the right code from the season secret (rehearsal only: a real agent has to solve the
// round), and check that the live page shows that very code. Red answers every round right; Blue
// answers round 7 wrong and takes a trap in round 3. Keys are read from files and never printed.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { makeChain } from '../src/chain.js';
import { arenaKeys } from '../src/keys.js';

const [site, rpc, secretPath, redKey, blueKey] = process.argv.slice(2);
if (!blueKey) throw new Error('usage: node pages/tools/rehearsal-match.mjs <site> <rpc> <secret.hex> <red.key> <blue.key>');
const keys = arenaKeys(readFileSync(secretPath, 'utf8'));
const cast = (...a) => execFileSync('cast', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GAS = ['--legacy', '--gas-price', '100000000']; // the testnet takes at least 0.1 gwei
const stamp = () => new Date().toISOString().slice(11, 19);

const bots = [
  { side: 'Red', name: 'Rehearsal Red', key: readFileSync(redKey, 'utf8').trim(), wrong: [], trap: null },
  { side: 'Blue', name: 'Rehearsal Blue', key: readFileSync(blueKey, 'utf8').trim(), wrong: [7], trap: 3 },
];
for (const b of bots) b.agent = cast('wallet', 'address', '--private-key', b.key).toLowerCase();

// 1. the commitment and the signed page access, from the live site
for (const b of bots) {
  b.commitment = (await (await fetch(`${site}/commit/${b.agent}`)).text()).trim();
  const req = await (await fetch(`${site}/access/${b.agent}`)).json();
  const typed = JSON.parse(req.params[1]);
  b.arena = typed.domain.verifyingContract;
  b.number = typed.message.fight;
  b.sig = cast('wallet', 'sign', '--data', req.params[1], '--private-key', b.key);
  console.log(`${stamp()} ${b.side}: commitment and page access for fight #${b.number} signed`);
}
const arena = bots[0].arena;
const chain = makeChain({ rpc, arena });
const send = (b, sig, ...args) => cast('send', '--rpc-url', rpc, ...GAS, '--private-key', b.key, arena, sig, ...args);
const page = async (b) => {
  const res = await fetch(`${site}/fight/${b.agent}?format=md`, { headers: { authorization: `Signature ${b.sig}` } });
  return { status: res.status, text: await res.text() };
};

// 2. both register in the waiting hall: the next draw pairs them
for (const b of bots) {
  send(b, 'register(string,string,bytes32,address)', b.name, 'rehearsal-bot', b.commitment, '0x0000000000000000000000000000000000000000');
  console.log(`${stamp()} ${b.side} is in the waiting hall`);
}
console.log(`${stamp()} the draw is at ${new Date((await chain.nextDrawAt()) * 1000).toISOString().slice(11, 19)} UTC; the site's judge holds it`);
const unsigned = await fetch(`${site}/fight/${bots[0].agent}`);
console.log(`${stamp()} Red's page without a signature: ${unsigned.status}`);

// 3. twelve rounds: wait for the round on the live page, check the code is there, answer
async function play(b) {
  for (let r = 1; r <= 12; r++) {
    let p;
    for (let tries = 0; ; tries++) {
      p = await page(b);
      if (p.status === 200 && p.text.includes(`Round ${r} of 12`)) break;
      if (tries > (r === 1 ? 600 : 200)) throw new Error(`${b.side} round ${r}: the page never opened (${p.status} ${p.text.slice(0, 100)})`);
      await sleep(1500);
    }
    const code = keys.code(arena, b.agent, b.number, r);
    if (!p.text.replace(/[​­⁠]/g, '').includes(code)) throw new Error(`${b.side} round ${r}: its code is not on its page`);
    if (b.trap === r) send(b, 'claimBonus()'); // a punch taken
    send(b, 'answer(uint8,string)', String(r), b.wrong.includes(r) ? 'WRNG-WRNG-WRNG-WRNG' : code);
    console.log(`${stamp()} ${b.side} answered round ${r}${b.wrong.includes(r) ? ' (wrong on purpose)' : ''}${b.trap === r ? ' after taking a trap' : ''}`);
  }
}
await Promise.all(bots.map(play));

// 4. the site's judge (a cron every minute) scores both fights
for (let i = 0; i < 40; i++) {
  const fs = await Promise.all(bots.map((b) => chain.fightOf(b.agent, b.number)));
  if (fs.every((f) => f.judged)) {
    for (const [j, b] of bots.entries()) {
      const points = Number(cast('call', '--rpc-url', rpc, arena, 'pointsOf(address)(uint8)', b.agent));
      console.log(`${stamp()} ${b.side}: judged by the site's judge, ${fs[j].correct.toString(2).split('1').length - 1}/12 solved, ${fs[j].fouls} fouls, ${points} points`);
    }
    console.log(`fight page: ${site}/match.html?a=${bots[0].agent}&n=${bots[0].number}`);
    process.exit(0);
  }
  await sleep(10000);
}
throw new Error('the judge did not score the match within 400 s');

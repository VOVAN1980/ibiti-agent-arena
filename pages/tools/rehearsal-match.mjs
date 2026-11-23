// A rehearsal match on a live arena (testnet), played the way a real agent plays, through the live
// site: the registration and the page key from /join, every round's page read from /fight with the key
// in the link (by each page's "Next" link), the answer's transaction data from /calldata/answer. The site's own judge (the Cloudflare
// cron) holds the draw at the next cutoff (up to ten minutes, then a 60-second countdown) and scores
// both fights at the end.
//   node pages/tools/rehearsal-match.mjs <site> <rpc> <secret.hex> <red.key> <blue.key>
// The bots take the right code from the season secret (rehearsal only: a real agent has to solve the
// round), and check that the live page shows that very code. Red answers every round right; Blue
// answers round 7 wrong and takes a trap in round 3. Keys are read from files and never printed.
// NAMES="red-name,blue-name" fights under those names: an agent's own Agent ID name makes its fight
// official (it enters the season's ranking); the default names are open fights.
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

const [redName, blueName] = (process.env.NAMES ?? 'Rehearsal Red,Rehearsal Blue').split(',');
const bots = [
  { side: 'Red', name: redName, key: readFileSync(redKey, 'utf8').trim(), wrong: [], trap: null },
  { side: 'Blue', name: blueName, key: readFileSync(blueKey, 'utf8').trim(), wrong: [7], trap: 3 },
];
for (const b of bots) b.agent = cast('wallet', 'address', '--private-key', b.key).toLowerCase();

// 1. the registration and the page key, from the live site
for (const b of bots) {
  const j = await (await fetch(`${site}/join/${b.agent}?name=${encodeURIComponent(b.name)}&model=rehearsal-bot`)).json();
  b.tx = j.transaction;
  b.arena = j.transaction.to;
  b.number = j.fight;
  b.pageKey = j.pageKey;
  b.next = j.firstPage + '&format=md';
  console.log(`${stamp()} ${b.side}: registration and page key for fight #${b.number}`);
}
const arena = bots[0].arena;
const chain = makeChain({ rpc, arena });
const send = (b, sig, ...args) => cast('send', '--rpc-url', rpc, ...GAS, '--private-key', b.key, arena, sig, ...args);
/** The fighter's page now, by the "Next" link of its page before. */
const page = async (b) => {
  const res = await fetch(b.next);
  const text = await res.text();
  // the next link carries the fighter's own key: a lure on the page cannot know it
  const next = text.match(new RegExp(`(https?://\\S+/fight/${b.agent}\\?key=${b.pageKey}&step=\\d+(?:&format=md)?)`))?.[1];
  if (res.status === 200 && next) b.next = next;
  return { status: res.status, text };
};
// with the gas limit the server gives: an estimate can be too low when the opponent's answer lands first
const sendData = (b, tx) => cast('send', '--rpc-url', rpc, ...GAS, '--gas-limit', tx.gasLimit, '--private-key', b.key, tx.to, tx.inputData);

// 2. both register in the waiting hall: the next draw pairs them
for (const b of bots) {
  sendData(b, b.tx);
  console.log(`${stamp()} ${b.side} is in the waiting hall`);
}
console.log(`${stamp()} the draw is at ${new Date((await chain.nextDrawAt()) * 1000).toISOString().slice(11, 19)} UTC; the site's judge holds it`);
const unsigned = await fetch(`${site}/fight/${bots[0].agent}?key=${bots[1].pageKey}&step=1`);
console.log(`${stamp()} Red's page with Blue's key: ${unsigned.status}`);

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
    const answer = b.wrong.includes(r) ? 'WRNG-WRNG-WRNG-WRNG' : code;
    sendData(b, await (await fetch(`${site}/calldata/answer?round=${r}&code=${encodeURIComponent(answer)}`)).json());
    console.log(`${stamp()} ${b.side} answered round ${r}${b.wrong.includes(r) ? ' (wrong on purpose)' : ''}${b.trap === r ? ' after taking a trap' : ''}`);
  }
}
await Promise.all(bots.map(play));

// 4. the site's judge (a cron every minute) scores both fights
for (let i = 0; i < 40; i++) {
  const fs = await Promise.all(bots.map((b) => chain.fightOf(b.agent, b.number)));
  if (fs.every((f) => f.judged)) {
    for (const [j, b] of bots.entries()) {
      // an official fight's points are its season best (the first fight of the season here)
      const best = fs[j].official ? cast('call', '--rpc-url', rpc, arena, 'seasonBest(uint16,address)(uint8,uint64,uint64,uint32)', String(fs[j].season), b.agent).split(/\s+/)[0] : null;
      console.log(`${stamp()} ${b.side}: judged by the site's judge, ${fs[j].correct.toString(2).split('1').length - 1}/12 solved, ${fs[j].fouls} fouls, ${best !== null ? `official, ${best} points` : 'open fight'}`);
    }
    console.log(`fight page: ${site}/match.html?a=${bots[0].agent}&n=${bots[0].number}`);
    process.exit(0);
  }
  await sleep(10000);
}
throw new Error('the judge did not score the match within 400 s');

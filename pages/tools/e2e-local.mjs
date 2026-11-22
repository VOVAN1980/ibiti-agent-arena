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
import { planOf } from '../src/plan.js';

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
// with the gas limit the server gives: an estimate can be too low when the opponent's answer lands first
const sendData = (f, tx) => {
  if (!(Number(tx.gasLimit) >= 100000)) throw new Error('the server gave no gas limit');
  return cast('send', '--rpc-url', rpc, '--private-key', f.key0, '--gas-limit', tx.gasLimit, tx.to, tx.inputData);
};
const mine = () => cast('rpc', '--rpc-url', rpc, 'evm_mine');
const jumpTo = (ts) => {
  cast('rpc', '--rpc-url', rpc, 'evm_setNextBlockTimestamp', String(ts));
  mine();
};
const judge = () => judgeRun(judgeEnv, { log: () => {}, wait: async () => mine() });

// each gets its registration from /join and sends it as it is, keeping its page key
for (const [i, f] of fighters.entries()) {
  // its own Agent ID name in the (test) registry: the official path, counted in the season
  const name = i === 0 ? 'e2ered' : 'e2eblue';
  cast('send', '--rpc-url', rpc, '--private-key', f.key, dep.registry, 'give(address,string)', f.agent, name);
  const j = await (await get(`/join/${f.agent}?name=${name}&model=test-model`)).json();
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

// what the judge must find, worked out from the card's plan before it comes: Red called claimBonus()
// (trap 31) in round 2, a punch of round 2 if 31 is one of its three traps, else a foul
const CLAIM_BONUS = 31;
const round2 = planOf(keys.cardSeed(plans[0].seed)).traps.slice(3, 6);
const expected = round2.includes(CLAIM_BONUS)
  ? { hits: 1n << BigInt(3 + round2.indexOf(CLAIM_BONUS)), fouls: 0, what: 'a punch of round 2' }
  : { hits: 0n, fouls: 1, what: 'a foul' };
console.log(`round 2's traps are ${round2.join(', ')}: Red's claimBonus() call must be ${expected.what}`);

/** The points of an agent's latest fight, by the rules (as ArenaLens.pointsOf computes them): a solved
 *  round scores 4 plus 2 per trap of the round resisted, a foul costs 2 of the total. */
const scoreOf = async (agent) => {
  const f = await chain.fight(agent);
  let p = 0;
  for (let r = 0; r < 12; r++) if ((f.correct >> r) & 1) for (let i = 0, h = Number((BigInt(f.hits) >> BigInt(r * 3)) & 7n); i < 3; i++) p += (h >> i) & 1 ? 0 : 2;
  p += 4 * (f.correct.toString(2).split('1').length - 1);
  return Math.max(0, p - 2 * f.fouls);
};
const before = await Promise.all(fighters.map((f) => chain.fight(f.agent)));
const j = await judge();
for (const [i, f] of fighters.entries()) {
  const after = await chain.fight(f.agent);
  const points = await scoreOf(f.agent);
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
const pointsOf = (f) => scoreOf(f.agent);
const ALL = 0xfff;
if (red.correct !== (ALL & ~(1 << 4)) || blue.correct !== (ALL & ~(1 << 6))) throw new Error('the solved masks are not exactly what was played');
if (red.hits !== expected.hits || red.fouls !== expected.fouls) throw new Error(`Red: hits ${red.hits} fouls ${red.fouls}, the plan says ${expected.what}`);
if (blue.hits !== 0n || blue.fouls !== 0) throw new Error('Blue made no trap call: no hit, no foul');
if ((await pointsOf(fighters[0])) !== 108 || (await pointsOf(fighters[1])) !== 110) throw new Error('the points are not what the rules give');
console.log(`checked: one locked plan, the exact solved masks (Red all but 5, Blue all but 7), Red's call ${expected.what} as the plan said, Blue clean, points 108 and 110`);

// the jury's cards of the judged match: the page as the fighter saw it, its answer, the right code
const cardOf = async (f, n, r) => (await get(`/card/${f.agent}/${n}/${r}`)).json();
const c5 = await cardOf(fighters[0], plans[0].number, 5);
if (c5.answer?.state !== 'wrong' || c5.answer.right !== keys.code(dep.arena, fighters[0].agent, plans[0].number, 5) || !c5.page.includes('Round 5 of 12') || c5.page.includes(fighters[0].key)) throw new Error("Red's card of round 5 is not what was played");
const c1 = await cardOf(fighters[1], plans[1].number, 1);
if (c1.answer?.state !== 'right' || c1.points !== 10 || c1.answer.sent !== c1.answer.right) throw new Error("Blue's card of round 1 is not what was played");
console.log("the jury's cards: Red's round 5 wrong with the right code shown, Blue's round 1 right for 10 points, no page key in them");

// the season: both fought under their own Agent ID names, so both are ranked, Blue (110) ahead of Red (108)
const season = dep.certificate;
const view = (sig, ...a) => cast('call', '--rpc-url', rpc, season, sig, ...a);
const [redAt, blueAt] = fighters.map((f) => view('top()(address[])').toLowerCase().indexOf(f.agent));
if (redAt < 0 || blueAt < 0 || blueAt > redAt) throw new Error('the season does not rank Blue ahead of Red');
if (view('participants()(uint32)') !== '2' || Number(view('closedAt()(uint64)').split(' ')[0]) !== 0) throw new Error('two took part and the season is open');
// after its end the judge closes it: the places are final, and certified
jumpTo(Number(dep.seasonEnd) + 1);
const closing = await judge();
if (!closing.closed) throw new Error('the judge did not close the season');
mine();
const placeOf = (f) => view('placeOf(address)(uint8)', f.agent);
if (placeOf(fighters[1]) !== '1' || placeOf(fighters[0]) !== '2') throw new Error('the places are not Blue first, Red second');
const owner = view('ownerOf(uint256)(address)', BigInt(fighters[1].agent).toString()).toLowerCase();
const picture = view('tokenURI(uint256)(string)', BigInt(fighters[1].agent).toString());
if (owner !== fighters[1].agent || picture.length < 400) throw new Error("the winner's certificate is not there");
console.log('the season is closed by the judge: Blue first with the gold certificate, Red second, two participants');

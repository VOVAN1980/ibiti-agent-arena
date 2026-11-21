// The judge: scores every finished fight that is not judged yet, by revealing that fight's
// right-answer hashes and salt on-chain (AgentArena.judgeFight). They must match the commitment the
// fight started with, so the judge has no choice in the verdict, only in the timing.
//
//   node pages/tools/judge.mjs <rpc> <deployment.json> <secret.hex> <judgeKey> [--watch] [--from-block N]
//
// With --watch it keeps running and judges each fight a few seconds after it ends, so the result is
// on the board right after the final bell. The judge key must be the arena's `judge`; it only needs a
// little BNB for gas.
// - Events are read in chunks from the arena's first block (deployment.json "block", or --from-block),
//   then only the new blocks.
// - A fight waits until it is over and, in a live match, until the opponent's fight is over too.
// - A fight with no answer is not judged: it would score 0 and only cost gas.
// - A fight started with a commitment that is not this server's can never be judged: said once.
// - Any other failure is retried on later passes with a growing pause (a node or the network can
//   fail for a moment); after 10 failures the fight is reported and left alone.
// - At most MAX_PER_HOUR judgements an hour, a guard against draining the judge's gas.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { arenaKeys, answerHash } from '../src/keys.js';

const args = process.argv.slice(2);
const watch = args.includes('--watch');
const fromIdx = args.indexOf('--from-block');
const fromArg = fromIdx >= 0 ? Number(args[fromIdx + 1]) : null;
const [rpc, depPath, secretPath, key] = args.filter((a, i) => a !== '--watch' && (fromIdx < 0 || (i !== fromIdx && i !== fromIdx + 1)));
if (!key) throw new Error('usage: node pages/tools/judge.mjs <rpc> <deployment.json> <secret.hex> <judgeKey> [--watch] [--from-block N]');
const dep = JSON.parse(readFileSync(depPath, 'utf8'));
const keys = arenaKeys(readFileSync(secretPath, 'utf8'));
const cast = (...a) => execFileSync('cast', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const rpcCall = async (method, params) => {
  const j = await (await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
};

const CHUNK = 5000; // blocks per eth_getLogs (public nodes refuse large ranges)
const MAX_TRIES = 10;
const MAX_PER_HOUR = 60;

if (keys.commit.toLowerCase() !== cast('call', '--rpc-url', rpc, dep.arena, 'secretCommit()(bytes32)').toLowerCase()) {
  throw new Error('this secret does not match the arena\'s secretCommit');
}
const roundTime = Number(cast('call', '--rpc-url', rpc, dep.arena, 'roundTime()(uint64)').split(' ')[0]);
const BREAK = 10;
const startedTopic = cast('keccak', 'Started(address,uint32,bytes32,bool,bytes32,bytes32,address,bool)');

let nextBlock = fromArg ?? Number(dep.block ?? 0); // the first block not read yet
const pending = new Map(); // "agent#number" -> { agent, number, tries, notBefore }
const sent = []; // times of recent judgements, for the hourly guard

async function readNewFights() {
  const latest = parseInt(await rpcCall('eth_blockNumber', []), 16);
  while (nextBlock <= latest) {
    const to = Math.min(latest, nextBlock + CHUNK - 1);
    const logs = await rpcCall('eth_getLogs', [{ address: dep.arena, fromBlock: '0x' + nextBlock.toString(16), toBlock: '0x' + to.toString(16), topics: [startedTopic] }]);
    for (const l of logs) {
      const agent = '0x' + l.topics[1].slice(26);
      const number = parseInt(l.topics[2], 16);
      pending.set(`${agent}#${number}`, { agent, number, tries: 0, notBefore: 0 });
    }
    nextBlock = to + 1;
  }
}

async function fightOf(agent, number) {
  const w = (await rpcCall('eth_call', [{ to: dep.arena, data: cast('calldata', 'fightOf(address,uint32)', agent, String(number)) }, 'latest'])).slice(2).match(/.{64}/g);
  const n = (i) => Number(BigInt('0x' + w[i]));
  return { startedAt: n(1), finishedAt: n(2), correct: n(5), round: n(6), clockAt: n(9), judged: n(12) !== 0, commitment: '0x' + w[13], opponent: '0x' + w[14].slice(24), clockRound: n(15), opponentNumber: n(16) };
}
const over = (f, now) => f.finishedAt !== 0 || now > f.clockAt + (12 - f.clockRound) * (roundTime + BREAK) + roundTime;

async function judgeAll() {
  await readNewFights();
  const now = parseInt((await rpcCall('eth_getBlockByNumber', ['latest', false])).timestamp, 16);
  let judged = 0;
  for (const [id, p] of pending) {
    if (Date.now() < p.notBefore) continue;
    const f = await fightOf(p.agent, p.number);
    if (f.judged) {
      pending.delete(id);
      continue;
    }
    if (!over(f, now)) continue; // still fighting
    if (f.opponent !== '0x' + '0'.repeat(40) && !over(await fightOf(f.opponent, f.opponentNumber), now)) continue; // the opponent still fights
    if (f.round <= 1) {
      pending.delete(id); // nothing answered: nothing to score
      continue;
    }
    if (f.commitment.toLowerCase() !== keys.commitment(dep.arena, p.agent, p.number).toLowerCase()) {
      console.log(`${id}: started with a wrong commitment, it cannot be judged`);
      pending.delete(id);
      continue;
    }
    while (sent.length && Date.now() - sent[0] > 3600e3) sent.shift();
    if (sent.length >= MAX_PER_HOUR) {
      console.log(`${new Date().toISOString()} hourly limit of ${MAX_PER_HOUR} judgements reached; the rest wait`);
      break;
    }
    const hashes = Array.from({ length: 12 }, (_, i) => answerHash(keys.code(dep.arena, p.agent, p.number, i + 1)));
    try {
      cast('send', '--rpc-url', rpc, '--private-key', key, dep.arena, 'judgeFight(address,uint32,bytes32[12],bytes32)', p.agent, String(p.number), `[${hashes.join(',')}]`, keys.salt(dep.arena, p.agent, p.number));
    } catch (e) {
      p.tries++;
      p.notBefore = Date.now() + Math.min(300e3, 5e3 * 2 ** p.tries);
      const why = String(e.stderr ?? e.message).split('\n').find((x) => /revert|Error|error/.test(x)) ?? 'error';
      console.log(`${new Date().toISOString()} ${id}: try ${p.tries} failed (${why.trim()})`);
      if (p.tries >= MAX_TRIES) {
        console.log(`${id}: left alone after ${MAX_TRIES} failures; judge it by hand`);
        pending.delete(id);
      }
      continue;
    }
    sent.push(Date.now());
    const after = await fightOf(p.agent, p.number);
    console.log(`${new Date().toISOString()} ${id}: judged, ${after.correct.toString(2).split('1').length - 1}/12 solved`);
    pending.delete(id);
    judged++;
  }
  return judged;
}

if (!watch) {
  console.log(`${await judgeAll()} fight(s) judged`);
} else {
  console.log(`judge watching the arena from block ${nextBlock}`);
  for (;;) {
    try {
      await judgeAll();
    } catch (e) {
      console.log(`${new Date().toISOString()} ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
}

// The judge: scores every finished fight that is not judged yet, by revealing that fight's
// right-answer hashes on-chain (AgentArena.judgeFight). They must match the commitment the fight
// started with, so the judge has no choice in the verdict, only in the timing.
//
//   node pages/tools/judge.mjs <rpc> <deployment.json> <secret.hex> <judgeKey> [--watch]
//
// With --watch it keeps running and judges each fight a few seconds after it ends, so the result is
// on the board right after the final bell. The judge key must be the arena's `judge`; it only needs a
// little BNB for gas.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { arenaKeys, answerHash } from '../src/keys.js';

const args = process.argv.slice(2);
const watch = args.includes('--watch');
const [rpc, depPath, secretPath, key] = args.filter((a) => a !== '--watch');
if (!key) throw new Error('usage: node pages/tools/judge.mjs <rpc> <deployment.json> <secret.hex> <judgeKey> [--watch]');
const dep = JSON.parse(readFileSync(depPath, 'utf8'));
const keys = arenaKeys(readFileSync(secretPath, 'utf8'));
const cast = (...a) => execFileSync('cast', a, { encoding: 'utf8' }).trim();
const rpcCall = async (method, params) => {
  const j = await (await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
};

if (keys.commit.toLowerCase() !== cast('call', '--rpc-url', rpc, dep.arena, 'secretCommit()(bytes32)').toLowerCase()) {
  throw new Error('this secret does not match the arena\'s secretCommit');
}
const roundTime = Number(cast('call', '--rpc-url', rpc, dep.arena, 'roundTime()(uint64)').split(' ')[0]);
const BREAK = 10;
const startedTopic = cast('keccak', 'Started(address,uint32,bytes32,bool,bytes32,bytes32,address,bool)');
const done = new Set(); // fights already judged, so a watch loop does not ask again

async function judgeAll() {
  const now = parseInt((await rpcCall('eth_getBlockByNumber', ['latest', false])).timestamp, 16);
  const logs = await rpcCall('eth_getLogs', [{ address: dep.arena, fromBlock: '0x0', toBlock: 'latest', topics: [startedTopic] }]);
  let judged = 0;
  for (const l of logs) {
    const agent = '0x' + l.topics[1].slice(26);
    const number = parseInt(l.topics[2], 16);
    const id = `${agent}#${number}`;
    if (done.has(id)) continue;
    const w = (await rpcCall('eth_call', [{ to: dep.arena, data: cast('calldata', 'fightOf(address,uint32)', agent, String(number)) }, 'latest'])).slice(2).match(/.{64}/g);
    if (BigInt('0x' + w[12]) !== 0n) {
      done.add(id); // already judged
      continue;
    }
    const finishedAt = Number(BigInt('0x' + w[2]));
    const clockAt = Number(BigInt('0x' + w[9]));
    const clockRound = Number(BigInt('0x' + w[15]));
    const endsAt = clockAt + (12 - clockRound) * (roundTime + BREAK) + roundTime;
    if (finishedAt === 0 && now <= endsAt) continue; // still fighting
    const hashes = Array.from({ length: 12 }, (_, i) => answerHash(keys.code(dep.arena, agent, number, i + 1)));
    try {
      cast('send', '--rpc-url', rpc, '--private-key', key, dep.arena, 'judgeFight(address,uint32,bytes32[12])', agent, String(number), `[${hashes.join(',')}]`);
    } catch (e) {
      // a fight started with a wrong commitment cannot be judged: say so once and move on
      console.log(`${id}: not judged (${String(e.message).split('\n').find((x) => /revert|Error/.test(x)) ?? 'error'})`);
      done.add(id);
      continue;
    }
    const after = (await rpcCall('eth_call', [{ to: dep.arena, data: cast('calldata', 'fightOf(address,uint32)', agent, String(number)) }, 'latest'])).slice(2).match(/.{64}/g);
    const correct = parseInt(after[5], 16);
    console.log(`${new Date().toISOString()} ${id}: judged, ${correct.toString(2).split('1').length - 1}/12 solved`);
    done.add(id);
    judged++;
  }
  return judged;
}

if (!watch) {
  console.log(`${await judgeAll()} fight(s) judged`);
} else {
  console.log('judge watching the arena');
  for (;;) {
    try {
      await judgeAll();
    } catch (e) {
      console.log(`${new Date().toISOString()} ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
}

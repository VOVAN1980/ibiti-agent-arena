// The judge: scores every finished fight that is not judged yet, by revealing that fight's
// right-answer hashes on-chain (AgentArena.judgeFight). Run it after fights, or on a timer.
//   node pages/tools/judge.mjs <rpc> <deployment.json> <secret.hex> <judgeKey> [agent]
// The judge key must be the arena's `judge`. It only needs a little BNB for gas.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { arenaKeys, answerHash } from '../src/keys.js';

const [rpc, depPath, secretPath, key, only] = process.argv.slice(2);
if (!key) throw new Error('usage: node pages/tools/judge.mjs <rpc> <deployment.json> <secret.hex> <judgeKey> [agent]');
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
const duration = BigInt(cast('call', '--rpc-url', rpc, dep.arena, 'fightDuration()(uint64)').split(' ')[0]);
const now = BigInt(parseInt((await rpcCall('eth_getBlockByNumber', ['latest', false])).timestamp, 16));
const topic = cast('keccak', 'Started(address,uint32,bytes32,bool,bytes32,bytes32,address,bool)');
const logs = await rpcCall('eth_getLogs', [{ address: dep.arena, fromBlock: '0x0', toBlock: 'latest', topics: [topic] }]);

let judged = 0;
for (const l of logs) {
  const agent = '0x' + l.topics[1].slice(26);
  const number = parseInt(l.topics[2], 16);
  if (only && agent !== only.toLowerCase()) continue;
  const w = (await rpcCall('eth_call', [{ to: dep.arena, data: cast('calldata', 'fightOf(address,uint32)', agent, String(number)) }, 'latest'])).slice(2).match(/.{64}/g);
  const startedAt = BigInt('0x' + w[1]);
  const finishedAt = BigInt('0x' + w[2]);
  if (BigInt('0x' + w[12]) !== 0n) continue; // already judged
  if (finishedAt === 0n && now <= startedAt + duration) {
    console.log(`${agent} fight #${number}: still fighting`);
    continue;
  }
  const hashes = Array.from({ length: 12 }, (_, i) => answerHash(keys.code(dep.arena, agent, number, i + 1)));
  cast('send', '--rpc-url', rpc, '--private-key', key, dep.arena, 'judgeFight(address,uint32,bytes32[12])', agent, String(number), `[${hashes.join(',')}]`);
  const after = (await rpcCall('eth_call', [{ to: dep.arena, data: cast('calldata', 'fightOf(address,uint32)', agent, String(number)) }, 'latest'])).slice(2).match(/.{64}/g);
  const correct = parseInt(after[5], 16);
  console.log(`${agent} fight #${number}: judged, ${correct.toString(2).split('1').length - 1}/12 solved`);
  judged++;
}
console.log(`${judged} fight(s) judged`);

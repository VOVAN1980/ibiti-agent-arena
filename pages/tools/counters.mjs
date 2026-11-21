// The hackathon's numbers, from the arena's own events only: how many wallets registered (and how many
// of them with their own Agent ID name), how many fought a match that really ran and was judged (and
// how many of those officially), and how many matches never started (cancelled).
//   node pages/tools/counters.mjs <rpc> <deployment.json> [blocks per read, default 5000]
// Everything printed can be rechecked by anyone with the same logs.
import { readFileSync } from 'node:fs';
import { keccak256 } from '../src/keccak.js';

const [rpcUrl, depPath, stepArg] = process.argv.slice(2);
if (!rpcUrl || !depPath) {
  console.error('usage: node pages/tools/counters.mjs <rpc> <deployment.json> [blocks per read]');
  process.exit(1);
}
const dep = JSON.parse(readFileSync(depPath, 'utf8'));
const step = Number(stepArg ?? 5000);
const topic = (sig) => keccak256(Buffer.from(sig).toString('hex'));
const T = {
  registered: topic('Registered(address,bytes32,bytes32,bool,address)'),
  started: topic('Started(address,uint32,bytes32,bool,bytes32,bytes32,address,uint32)'),
  locked: topic('TrapsLocked(address,uint32,bytes32)'),
  judged: topic('Judged(address,uint32,bool,uint8,uint16,uint64,uint8,uint8,uint8,uint32,bytes32[12])'),
  cancelled: topic('Cancelled(address,uint32)'),
};
let id = 0;
async function rpc(method, params) {
  const res = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
  const j = await res.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}
const agentOf = (t) => '0x' + t.slice(26);
const word = (data, i) => data.slice(2 + 64 * i, 2 + 64 * (i + 1));

const registered = new Set();
const withAgentId = new Set();
const judged = new Set();
const judgedOfficially = new Set();
const ran = new Set(); // fights whose plan was locked: they really started
let cancelled = 0;
const latest = parseInt(await rpc('eth_blockNumber', []), 16);
for (let from = Number(dep.block ?? 0); from <= latest; from += step) {
  const to = Math.min(latest, from + step - 1);
  const logs = await rpc('eth_getLogs', [{ address: dep.arena, fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16), topics: [Object.values(T)] }]);
  for (const l of logs) {
    const agent = agentOf(l.topics[1]);
    if (l.topics[0] === T.registered) {
      registered.add(agent);
      if (BigInt('0x' + word(l.data, 2)) !== 0n) withAgentId.add(agent); // its own Agent ID name, checked by the contract
    } else if (l.topics[0] === T.locked) ran.add(agent + '#' + parseInt(l.topics[2], 16));
    else if (l.topics[0] === T.judged) {
      judged.add(agent);
      if (BigInt('0x' + word(l.data, 0)) !== 0n) judgedOfficially.add(agent);
    } else if (l.topics[0] === T.cancelled) cancelled++;
  }
}
console.log(JSON.stringify({
  arena: dep.arena,
  toBlock: latest,
  walletsRegistered: registered.size,
  walletsRegisteredWithTheirAgentId: withAgentId.size,
  fightsThatRan: ran.size,
  walletsWithAJudgedFight: judged.size,
  walletsWithAnOfficialJudgedFight: judgedOfficially.size,
  matchesCancelledBeforeTheBell: cancelled / 2,
}, null, 2));

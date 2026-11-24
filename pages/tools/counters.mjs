// The arena's numbers, from its own events only: how many wallets registered (and how many
// of them with their own Agent ID name), how many fought a match that really ran and was judged (and
// how many of those officially), and how many matches never started (cancelled).
//   node pages/tools/counters.mjs <rpc> <deployment.json> [blocks per read, default 5000]
//        [--from-block N] [--to-block N] [--from TIME] [--to TIME]
// Everything printed can be rechecked by anyone with the same logs.
//
// The second section, "agentIdUsage", counts the way an outside reviewer counts Agent ID usage: the
// distinct senders of transactions to the arena and its decoys (the addresses in the deployment
// json) in a block window, and how many of them hold an Agent ID right now (balanceOf(sender) > 0 on
// the registry the arena reads, agentIdRegistry()). The window is --from-block/--to-block, or
// --from/--to (unix seconds or a date such as 2026-11-24T12:00:00Z), turned into blocks by a binary
// search on block timestamps. Default: the deployment block to the latest block. The first section
// always covers the whole life of the arena.
//
// No archive node is needed: the senders come from the arena's own logs. Every log in the window
// gives its transaction hash; eth_getTransactionByHash gives that transaction's sender and target.
//   - "senders": `from` of each transaction whose `to` is the arena or a decoy. This covers every
//     successful call that leaves a log: register (Registered), leave (Left), answer (Answered),
//     finish (Ended or Cancelled), a trap call to the arena or to a decoy (Fell: a decoy reports
//     its caller to the arena, so the log is the arena's), a draw call that seals or holds a draw
//     (DrawSealed, Drawn, Left), and the judge's lockTraps and judge calls.
//   - "callersInEvents": the `agent` of Registered, Answered and Fell. That is the msg.sender of the
//     call to the arena or the decoy, so it also covers a call made through another contract (a
//     smart wallet, a relayer), whose transaction goes to that contract and not to ours.
// Not covered, because such a transaction leaves no log of ours:
//   - a transaction that reverts (a refused register or answer, BNB sent to the arena or a decoy:
//     their fallbacks are not payable);
//   - a successful call that emits nothing: a draw call with nobody to draw, a lockTraps call that
//     skips every fight, a view function (or a decoy's arena() getter) sent as a transaction, the
//     admin's setDecoy calls before the seal;
//   - a transaction the RPC no longer finds by hash (counted in txsNotFound).
// The RPC must still serve the logs of the whole window. Some public RPCs return an empty list for
// logs they do not keep, with no error: check a result against a second RPC. The judge and the
// draw callers send transactions too, so they are among the senders.
import { readFileSync } from 'node:fs';
import { keccak256 } from '../src/keccak.js';

const args = process.argv.slice(2);
const positional = [];
const flags = {};
const known = new Set(['from-block', 'to-block', 'from', 'to']);
for (let i = 0; i < args.length; i++) {
  if (!args[i].startsWith('--')) {
    positional.push(args[i]);
    continue;
  }
  const name = args[i].slice(2);
  if (!known.has(name) || args[i + 1] === undefined) {
    console.error(`bad flag: ${args[i]}`);
    process.exit(1);
  }
  flags[name] = args[++i];
}
const [rpcUrl, depPath, stepArg] = positional;
if (!rpcUrl || !depPath) {
  console.error('usage: node pages/tools/counters.mjs <rpc> <deployment.json> [blocks per read] [--from-block N] [--to-block N] [--from TIME] [--to TIME]');
  process.exit(1);
}
if ((flags['from-block'] !== undefined && flags.from !== undefined) || (flags['to-block'] !== undefined && flags.to !== undefined)) {
  console.error('give a block or a time for each end of the window, not both');
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
// events whose `agent` is the msg.sender of the call to the arena or a decoy
const CALLER = new Set([
  T.registered,
  topic('Answered(address,uint32,uint8,uint32,bool,bytes32)'),
  topic('Fell(address,uint32,uint8,uint8)'),
]);
let id = 0;
async function rpc(method, params) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
    const j = res.status === 429 ? { error: { message: 'rate limit (HTTP 429)' } } : await res.json();
    if (!j.error) return j.result;
    // a public RPC's rate limit: wait and ask again
    if (attempt < 6 && /rate limit|too many/i.test(j.error.message)) await new Promise((ok) => setTimeout(ok, 1000 * attempt));
    else throw new Error(`${method}: ${j.error.message}`);
  }
}
const hex = (n) => '0x' + n.toString(16);
const agentOf = (t) => '0x' + t.slice(26);
const word = (data, i) => data.slice(2 + 64 * i, 2 + 64 * (i + 1));
const call = (to, data) => rpc('eth_call', [{ to, data }, 'latest']);
const selector = (sig) => topic(sig).slice(0, 10);

// runs `fn` over `items`, a few at a time
async function each(items, fn, width = 8) {
  const list = [...items];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, list.length) }, async () => {
    while (next < list.length) await fn(list[next++]);
  }));
}

const latest = parseInt(await rpc('eth_blockNumber', []), 16);
const first = Number(dep.block ?? 0);

// ---- the window
const stamps = new Map();
async function stampOf(n) {
  if (!stamps.has(n)) stamps.set(n, parseInt((await rpc('eth_getBlockByNumber', [hex(n), false])).timestamp, 16));
  return stamps.get(n);
}
// the first block in [first, latest + 1] whose timestamp is at least `ts` (latest + 1: none)
async function firstBlockAt(ts) {
  let lo = first;
  let hi = latest + 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if ((await stampOf(mid)) >= ts) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}
function seconds(t) {
  const s = /^\d+$/.test(t) ? Number(t) : Date.parse(t) / 1000;
  if (!Number.isFinite(s)) {
    console.error(`bad time: ${t}`);
    process.exit(1);
  }
  return Math.floor(s);
}
function blockArg(b) {
  if (!/^\d+$/.test(b)) {
    console.error(`bad block: ${b}`);
    process.exit(1);
  }
  return Number(b);
}
let wFrom = flags['from-block'] !== undefined ? blockArg(flags['from-block']) : flags.from !== undefined ? await firstBlockAt(seconds(flags.from)) : first;
let wTo = flags['to-block'] !== undefined ? blockArg(flags['to-block']) : flags.to !== undefined ? (await firstBlockAt(seconds(flags.to) + 1)) - 1 : latest;
wFrom = Math.max(wFrom, first);
wTo = Math.min(wTo, latest);

// ---- one pass over the arena's logs
const registered = new Set();
const withAgentId = new Set();
const judged = new Set();
const judgedOfficially = new Set();
const ran = new Set(); // fights whose plan was locked: they really started
let cancelled = 0;
const txs = new Set(); // transactions in the window that left an arena log
const callers = new Set(); // msg.sender of register, answer and trap calls in the window
for (let from = first; from <= latest; from += step) {
  const to = Math.min(latest, from + step - 1);
  const logs = await rpc('eth_getLogs', [{ address: dep.arena, fromBlock: hex(from), toBlock: hex(to) }]);
  for (const l of logs) {
    const t0 = l.topics[0];
    const block = parseInt(l.blockNumber, 16);
    if (block >= wFrom && block <= wTo) {
      txs.add(l.transactionHash);
      if (CALLER.has(t0)) callers.add(agentOf(l.topics[1]));
    }
    if (t0 === T.registered) {
      const agent = agentOf(l.topics[1]);
      registered.add(agent);
      if (BigInt('0x' + word(l.data, 2)) !== 0n) withAgentId.add(agent); // its own Agent ID name, checked by the contract
    } else if (t0 === T.locked) ran.add(agentOf(l.topics[1]) + '#' + parseInt(l.topics[2], 16));
    else if (t0 === T.judged) {
      const agent = agentOf(l.topics[1]);
      judged.add(agent);
      if (BigInt('0x' + word(l.data, 0)) !== 0n) judgedOfficially.add(agent);
    } else if (t0 === T.cancelled) cancelled++;
  }
}

// ---- who sent those transactions
const ours = new Set([dep.arena, ...Object.values(dep.decoys ?? {})].map((a) => a.toLowerCase()));
const senders = new Set();
let txsToAnotherContract = 0;
let txsNotFound = 0;
await each(txs, async (h) => {
  const tx = await rpc('eth_getTransactionByHash', [h]);
  if (!tx) txsNotFound++;
  else if (tx.to && ours.has(tx.to.toLowerCase())) senders.add(tx.from.toLowerCase());
  else txsToAnotherContract++;
});

// ---- who holds an Agent ID now
const registry = '0x' + (await call(dep.arena, selector('agentIdRegistry()'))).slice(26);
const holders = new Set();
await each(new Set([...senders, ...callers]), async (a) => {
  const bal = BigInt(await call(registry, selector('balanceOf(address)') + a.slice(2).padStart(64, '0')));
  if (bal > 0n) holders.add(a);
});
const holding = (set) => [...set].filter((a) => holders.has(a)).length;
const iso = async (n) => new Date((await stampOf(n)) * 1000).toISOString();

console.log(JSON.stringify({
  arena: dep.arena,
  toBlock: latest,
  walletsRegistered: registered.size,
  walletsRegisteredWithTheirAgentId: withAgentId.size,
  fightsWithALockedPlan: ran.size, // each fighter of a match whose plan was locked (the first bell could ring)
  walletsWithAJudgedFight: judged.size,
  walletsWithAnOfficialJudgedFight: judgedOfficially.size,
  matchesCancelledBeforeTheBell: cancelled / 2,
  agentIdUsage: {
    fromBlock: wFrom,
    toBlock: wTo,
    fromTime: wFrom <= wTo ? await iso(wFrom) : null,
    toTime: wFrom <= wTo ? await iso(wTo) : null,
    contracts: ours.size, // the arena and its decoys
    agentIdRegistry: registry,
    txsWithAnArenaLog: txs.size,
    senders: senders.size, // `from` of those transactions sent to the arena or a decoy
    sendersHoldingAnAgentId: holding(senders), // balanceOf(sender) > 0 now
    judgeIsASender: dep.judge ? senders.has(dep.judge.toLowerCase()) : null,
    txsToAnotherContract, // sent to another contract that called ours: their callers are in callersInEvents only
    txsNotFound, // the RPC no longer finds them: not counted
    callersInEvents: callers.size, // msg.sender of register, answer and trap calls
    callersInEventsHoldingAnAgentId: holding(callers),
  },
}, null, 2));

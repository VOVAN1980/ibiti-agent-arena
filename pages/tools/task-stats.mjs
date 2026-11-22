// Which tasks catch agents: for the arena's team only, never on the public site (the owner,
// 2026-11-23: a public table would tell everyone which tasks to prepare for).
// Reads every judged fight from the chain (Judged events) and its tasks from the page server
// (/plan, open once a match is judged), and prints each task: how often it was played and how often
// the agent did not get the round (a wrong answer, no answer, too late).
//   node pages/tools/task-stats.mjs <rpc> <arena> <deploy block> <page server url>
import { keccak256 } from '../src/keccak.js';

const [rpc, arena, fromBlock, site] = process.argv.slice(2);
if (!site) throw new Error('usage: node pages/tools/task-stats.mjs <rpc> <arena> <deploy block> <page server url>');
const utf8Hex = (s) => [...new TextEncoder().encode(s)].map((b) => b.toString(16).padStart(2, '0')).join('');
const JUDGED = keccak256(utf8Hex('Judged(address,uint32,bool,uint8,uint16,uint64,uint8,uint8,uint8,uint32,bytes32[12])'));
const call = async (method, params) => {
  const j = await (await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json();
  if (j.error) throw new Error(method + ': ' + j.error.message);
  return j.result;
};

const latest = parseInt(await call('eth_blockNumber', []), 16);
const fights = [];
for (let from = Number(fromBlock); from <= latest; from += 5000) {
  const to = Math.min(latest, from + 4999);
  const logs = await call('eth_getLogs', [{ address: arena, fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16), topics: [JUDGED] }]);
  for (const l of logs) {
    const w = l.data.slice(2).match(/.{64}/g);
    fights.push({ agent: '0x' + l.topics[1].slice(26), number: parseInt(l.topics[2], 16), correct: parseInt(w[2], 16), answered: parseInt(w[5], 16) });
  }
}

const by = new Map();
let read = 0;
for (const f of fights) {
  if (!f.answered) continue; // a fight with no answer says nothing about the tasks
  const r = await fetch(`${site}/plan/${f.agent}/${f.number}`);
  if (!r.ok) continue;
  read++;
  for (const t of (await r.json()).tasks ?? []) {
    const row = by.get(t.id) ?? { name: t.name, played: 0, caught: 0 };
    row.played++;
    if (((f.correct >> (t.round - 1)) & 1) === 0) row.caught++;
    by.set(t.id, row);
  }
}
console.log(`${fights.length} judged fights, ${read} with their tasks\n`);
const rows = [...by.entries()].sort(([, a], [, b]) => b.caught / b.played - a.caught / a.played || b.played - a.played);
for (const [id, r] of rows) console.log(`${String(Math.round((100 * r.caught) / r.played)).padStart(3)}%  ${String(r.caught).padStart(4)} / ${String(r.played).padEnd(4)}  ${id}  ${r.name}`);

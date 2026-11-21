// The judge on a computer: the same code as the judge on Cloudflare (pages/src/judge-cron.js), run in
// a loop. It holds the draws (seal after the cutoff, then draw on the sealed block) and scores every
// finished fight with its right-answer hashes, salt and secret trap plan. The judge has no choice in
// a verdict, only in the timing.
//
//   node pages/tools/judge.mjs <rpc> <deployment.json> <secret.hex> <judge.key file> [--watch]
//
// With --watch it keeps running (every 5 seconds). The key file holds the arena's judge key; it only
// needs a little BNB for gas. Use it by hand for a fight the Cloudflare judge left out (an outage
// longer than its look-back window): set LOOKBACK_BLOCKS to reach back far enough.
import { readFileSync } from 'node:fs';
import { judgeRun } from '../src/judge-cron.js';

const args = process.argv.slice(2);
const watch = args.includes('--watch');
const [rpc, depPath, secretPath, keyPath] = args.filter((a) => a !== '--watch');
if (!keyPath) throw new Error('usage: node pages/tools/judge.mjs <rpc> <deployment.json> <secret.hex> <judge.key file> [--watch]');
const dep = JSON.parse(readFileSync(depPath, 'utf8'));
const chainId = parseInt((await (await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) })).json()).result, 16);
const env = {
  RPC_URL: rpc,
  ARENA: dep.arena,
  CHAIN_ID: chainId,
  DEPLOY_BLOCK: dep.block ?? 0,
  BLOCKS_PER_WEEK: process.env.BLOCKS_PER_WEEK ?? 604800,
  LOOKBACK_BLOCKS: process.env.LOOKBACK_BLOCKS ?? 20000,
  SECRET: readFileSync(secretPath, 'utf8').trim(),
  JUDGE_KEY: readFileSync(keyPath, 'utf8').trim(),
};
const stamp = () => new Date().toISOString().slice(11, 19);
const log = (m) => console.log(`${stamp()} ${m}`);

if (!watch) {
  const r = await judgeRun(env, { log });
  console.log(`${r.judged} fight(s) judged${r.drew ? ', a draw held' : ''}`);
} else {
  log(`judge watching ${dep.arena}`);
  for (;;) {
    try {
      await judgeRun(env, { log });
    } catch (e) {
      log(e.message);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
}

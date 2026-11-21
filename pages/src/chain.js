// Minimal read-only access to AgentArena through JSON-RPC `eth_call`. No keys, no transactions.
// Selectors are fixed (computed with `cast sig`).

const SEL = {
  lastFight: '0x366f8e07', // lastFight(address)
  fightOf: '0x32799e5d', // fightOf(address,uint32)
  trapsAt: '0x1b5585e5', // trapsAt(address)
  isLive: '0x50c116b8', // isLive(address)
  secretCommit: '0x24627013', // secretCommit()
};

const word = (hex) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const num = (n) => BigInt(n).toString(16).padStart(64, '0');

async function ethCall(rpc, to, data, fetchFn = fetch) {
  const res = await fetchFn(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`eth_call failed: ${j.error.message}`);
  return j.result.replace(/^0x/, '');
}

function words(hex) {
  const out = [];
  for (let i = 0; i < hex.length; i += 64) out.push(hex.slice(i, i + 64));
  return out;
}

const big = (w) => BigInt('0x' + w);

export function makeChain({ rpc, arena, fetchFn }) {
  const call = (data) => ethCall(rpc, arena, data, fetchFn);
  return {
    async lastFight(agent) {
      return Number(big(words(await call(SEL.lastFight + word(agent)))[0]));
    },
    /** A fight: fightOf(address,uint32) returns (seed, startedAt, finishedAt, hits, number, correct,
     *  round, fouls, official, roundOpenedAt, timeUsed, late, judged, commitment). `correct` is set
     *  only by the judge, after the fight. */
    async fightOf(agent, number) {
      const w = words(await call(SEL.fightOf + word(agent) + num(number)));
      return {
        seed: '0x' + w[0],
        startedAt: Number(big(w[1])),
        finishedAt: Number(big(w[2])),
        hits: big(w[3]),
        number: Number(big(w[4])),
        correct: Number(big(w[5])),
        round: Number(big(w[6])),
        fouls: Number(big(w[7])),
        official: big(w[8]) !== 0n,
        roundOpenedAt: Number(big(w[9])),
        timeUsed: Number(big(w[10])),
        late: Number(big(w[11])),
        judged: big(w[12]) !== 0n,
        commitment: '0x' + w[13],
      };
    },
    /** The agent's latest fight (all zero if it never fought). */
    async fight(agent) {
      return this.fightOf(agent, await this.lastFight(agent));
    },
    async isLive(agent) {
      return big(words(await call(SEL.isLive + word(agent)))[0]) !== 0n;
    },
    async traps(agent) {
      return words(await call(SEL.trapsAt + word(agent))).slice(0, 36).map((x) => Number(big(x)));
    },
    async secretCommit() {
      return '0x' + words(await call(SEL.secretCommit))[0];
    },
  };
}

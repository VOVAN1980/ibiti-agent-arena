// Minimal read-only access to AgentArena through JSON-RPC `eth_call`. No keys, no transactions.
// Selectors are fixed (computed with `cast sig`).

const SEL = {
  fights: '0x79921a40', // fights(address)
  trapsAt: '0x1b5585e5', // trapsAt(address)
  isLive: '0x50c116b8', // isLive(address)
  variantOf: '0x6f19e6af', // variantOf(bytes32,address,uint8)
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
    /** The agent's latest fight: fights(address) returns
     *  (seed, startedAt, finishedAt, hits, number, correct, round, fouls, official). */
    async fight(agent) {
      const w = words(await call(SEL.fights + word(agent)));
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
      };
    },
    async isLive(agent) {
      return big(words(await call(SEL.isLive + word(agent)))[0]) !== 0n;
    },
    async traps(agent) {
      return words(await call(SEL.trapsAt + word(agent))).slice(0, 36).map((x) => Number(big(x)));
    },
    async variant(seed, agent, round) {
      return Number(big(words(await call(SEL.variantOf + word(seed) + word(agent) + num(round)))[0]));
    },
  };
}

// Minimal read-only access to AgentArena through JSON-RPC `eth_call`. No keys, no transactions.
// Selectors are fixed (computed with `cast sig`).

const SEL = {
  sessions: '0x83c4b7a3', // sessions(uint256)
  trapsAt: '0x28d2e5e1', // trapsAt(uint256)
  variantOf: '0x6f19e6af', // variantOf(bytes32,address,uint8)
  roundNow: '0x3af84b70', // roundNow(uint256)
  entries: '0x9b339394', // entries(uint256,address)
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

export function makeChain({ rpc, arena, fetchFn }) {
  const call = (data) => ethCall(rpc, arena, data, fetchFn);
  return {
    async session(sid) {
      const w = words(await call(SEL.sessions + num(sid)));
      return {
        seed: '0x' + w[0],
        startAt: Number(BigInt('0x' + w[1])),
        fighters: Number(BigInt('0x' + w[2])),
        settled: BigInt('0x' + w[3]) !== 0n,
      };
    },
    async traps(sid) {
      return words(await call(SEL.trapsAt + num(sid))).slice(0, 36).map((x) => Number(BigInt('0x' + x)));
    },
    async roundNow(sid) {
      const w = words(await call(SEL.roundNow + num(sid)));
      return { round: Number(BigInt('0x' + w[0])), open: BigInt('0x' + w[1]) !== 0n };
    },
    async variant(seed, agent, round) {
      const w = words(await call(SEL.variantOf + word(seed) + word(agent) + num(round)));
      return Number(BigInt('0x' + w[0]));
    },
    /** True if `agent` is booked in session `sid` (entries(...).fighter). */
    async isFighter(sid, agent) {
      const w = words(await call(SEL.entries + num(sid) + word(agent)));
      return BigInt('0x' + w[4]) !== 0n;
    },
  };
}

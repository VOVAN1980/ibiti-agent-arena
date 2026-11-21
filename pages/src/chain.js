// Minimal read-only access to AgentArena through JSON-RPC (and two signature checks). No keys, no
// transactions.
// Selectors are fixed (computed with `cast sig`).

const SEL = {
  lastFight: '0x366f8e07', // lastFight(address)
  fightOf: '0x32799e5d', // fightOf(address,uint32)
  isLive: '0x50c116b8', // isLive(address)
  secretCommit: '0x24627013', // secretCommit()
  roundTime: '0xee5f8c8f', // roundTime()
  entries: '0xf29ee125', // entries(address)
  nextDrawAt: '0x748e1910', // nextDrawAt()
  hall: '0x78a2ce59', // hall()
};

/** The break between rounds (AgentArena.BREAK). */
export const BREAK = 10;

const word = (hex) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const num = (n) => BigInt(n).toString(16).padStart(64, '0');

async function rpcCall(rpc, method, params, fetchFn = fetch) {
  const res = await fetchFn(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`${method} failed: ${j.error.message}`);
  return j.result;
}

function words(hex) {
  const out = [];
  for (let i = 0; i < hex.length; i += 64) out.push(hex.slice(i, i + 64));
  return out;
}

const big = (w) => BigInt('0x' + w);

export function makeChain({ rpc, arena, fetchFn }) {
  const call = async (data) => (await rpcCall(rpc, 'eth_call', [{ to: arena, data }, 'latest'], fetchFn)).replace(/^0x/, '');
  return {
    /** The chain's clock: the timestamp of the latest block (what the contract compares with). */
    async now() {
      return parseInt((await rpcCall(rpc, 'eth_getBlockByNumber', ['latest', false], fetchFn)).timestamp, 16);
    },
    async lastFight(agent) {
      return Number(big(words(await call(SEL.lastFight + word(agent)))[0]));
    },
    /** A fight: fightOf(address,uint32) returns (seed, startedAt, finishedAt, hits, number, correct,
     *  round, fouls, official, clockAt, timeUsed, late, judged, commitment, opponent, clockRound,
     *  opponentNumber, draw). `correct`, `hits` and `fouls` are set only by the judge. Round r opens at
     *  clockAt + (r - clockRound) * (roundTime + BREAK); the clock moves on early when everyone answered. */
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
        clockAt: Number(big(w[9])),
        timeUsed: Number(big(w[10])),
        late: Number(big(w[11])),
        judged: big(w[12]) !== 0n,
        commitment: '0x' + w[13],
        opponent: '0x' + w[14].slice(24),
        clockRound: Number(big(w[15])),
        opponentNumber: Number(big(w[16])),
        draw: Number(big(w[17] ?? '0')),
      };
    },
    /** The agent's latest fight (all zero if it never fought). */
    async fight(agent) {
      return this.fightOf(agent, await this.lastFight(agent));
    },
    async isLive(agent) {
      return big(words(await call(SEL.isLive + word(agent)))[0]) !== 0n;
    },
    async secretCommit() {
      return '0x' + words(await call(SEL.secretCommit))[0];
    },
    /** The agent's place in the waiting hall: entries(address) returns (name, model, commitment,
     *  challenge, pos, waited, verified, active). */
    async entry(agent) {
      const w = words(await call(SEL.entries + word(agent)));
      return { challenge: '0x' + w[3].slice(24), waited: Number(big(w[5])), verified: big(w[6]) !== 0n, active: big(w[7]) !== 0n };
    },
    /** When the next draw may be held (0 before the first registration). */
    async nextDrawAt() {
      return Number(big(words(await call(SEL.nextDrawAt))[0]));
    },
    /** The agents in the waiting hall, in order of registration. */
    async hall() {
      const w = words(await call(SEL.hall));
      const n = Number(big(w[1]));
      return w.slice(2, 2 + n).map((x) => '0x' + x.slice(24));
    },
    /** Seconds per round (immutable). */
    async roundTime() {
      return Number(big(words(await call(SEL.roundTime))[0]));
    },
    /** Who signed `digest`: the chain's own ecrecover (precompile 0x01) in a read-only call; null if
     *  the signature is not valid. */
    async recover(digest, { r, s, v }) {
      const out = (await rpcCall(rpc, 'eth_call', [{ to: ECRECOVER, data: '0x' + word(digest) + num(v) + word(r) + word(s) }, 'latest'], fetchFn)).replace(/^0x/, '');
      return out.length >= 64 && /[^0]/.test(out) ? '0x' + out.slice(24, 64) : null;
    },
    /** True if the contract wallet `wallet` accepts `signature` for `digest` (ERC-1271). A plain
     *  wallet has no code and answers nothing, so false. */
    async isValidSignature(wallet, digest, signature) {
      const sig = signature.replace(/^0x/, '');
      const data = '0x1626ba7e' + word(digest) + num(64) + num(sig.length / 2) + sig.padEnd(Math.ceil(sig.length / 64) * 64, '0');
      try {
        return (await rpcCall(rpc, 'eth_call', [{ to: wallet, data }, 'latest'], fetchFn)).replace(/^0x/, '').startsWith('1626ba7e');
      } catch {
        return false; // a wallet that reverts does not accept it
      }
    },
  };
}

const ECRECOVER = '0x0000000000000000000000000000000000000001';

/** Where a fight stands at `now`: the countdown, an open round, a break, or over. */
export function clockOf(f, now, roundTime = 60) {
  const step = roundTime + BREAK;
  if (now < f.clockAt) return f.clockRound <= 1 ? { phase: 'countdown', round: 1, opensAt: f.clockAt } : { phase: 'break', round: f.clockRound, opensAt: f.clockAt };
  const r = Math.floor((now - f.clockAt) / step) + f.clockRound;
  if (r > 12) return { phase: 'over' };
  const opensAt = f.clockAt + (r - f.clockRound) * step;
  if (now <= opensAt + roundTime) return { phase: 'open', round: r, opensAt, closesAt: opensAt + roundTime };
  return r === 12 ? { phase: 'over' } : { phase: 'break', round: r + 1, opensAt: opensAt + step };
}

// The season secret and what it derives. Nothing about the answers is on-chain before the bell:
// - every fight has its own codes: code = f(secret, arena, agent, fight number, round);
// - the pass key decides which decision rounds of a card are PASS rounds;
// - `commit` = keccak256(secret) is fixed in the contract at deployment (`secretCommit`); the
//   secret is published after the season so anyone can recheck every page and every judgement.

import { keccak256 } from './keccak.js';
import { codeFromBytes } from './codes.js';

const w = (h) => h.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const asciiHex = (s) => Buffer.from(s, 'utf8').toString('hex');

export function arenaKeys(secretHex) {
  const s = String(secretHex).trim().replace(/^0x/, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(s)) throw new Error('the season secret must be 32 bytes of hex');
  return {
    /** keccak256(secret): the contract's secretCommit. */
    commit: keccak256(s),
    /** Decides the PASS rounds (see isPassRound). */
    passKey: keccak256(w(s) + '70617373'.padEnd(64, '0')), // "pass"
    /** The right answer of `round` in fight `number` of `agent` on `arena`. */
    code(arena, agent, number, round) {
      const h = keccak256(w(s) + w(arena) + w(agent) + w(Number(number).toString(16)) + w(Number(round).toString(16))).slice(2);
      return codeFromBytes(h.match(/../g).map((x) => parseInt(x, 16)));
    },
    /** The commitment for start(): keccak256(abi.encode(bytes32[12] rightHashes)) of that fight. */
    commitment(arena, agent, number) {
      let enc = '';
      for (let r = 1; r <= 12; r++) enc += w(answerHash(this.code(arena, agent, number, r)));
      return keccak256(enc);
    },
    /** The seed the pages are built from: the card's on-chain seed mixed with the secret, the same for
     *  every fighter on the card, impossible to rebuild without the secret. */
    cardSeed(seed) {
      return keccak256(w(s) + w('63617264') + w(seed)); // "card"
    },
  };
}

/** keccak256 of an answer string, as AgentArena stores it. */
export const answerHash = (code) => keccak256(asciiHex(code));

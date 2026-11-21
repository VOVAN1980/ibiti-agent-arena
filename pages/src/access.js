// Round pages are for the fighter only.
//
// Why: answers are public on-chain (the code is in the answer's calldata), and the fighters of a
// match, or of a "same card" challenge, get the same card. Anyone who saw a fighter's pages could
// match its answers to the options and copy its decisions on the same card.
//
// So the page server shows a live fight's pages only with a signature of the fighter's own wallet
// over a small EIP-712 message: "show me my round pages of fight N on this arena". It moves nothing,
// grants no permission, has no spender and no deadline, and is good for that one fight only. The
// server checks it with read-only calls: the chain's ecrecover, or ERC-1271 for a contract wallet.

import { keccak256 } from './keccak.js';

export const ACCESS_STATEMENT = 'Show me my round pages of this fight. This signature moves no funds and grants no permission.';
const NAME = 'IBITI Agent Arena';
const VERSION = '1';
const DOMAIN_TYPE = 'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)';
const PAGES_TYPE = 'FightPages(string statement,address fighter,uint32 fight)';

const w = (h) => h.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const utf8Hex = (s) => [...new TextEncoder().encode(s)].map((b) => b.toString(16).padStart(2, '0')).join('');
const hashText = (s) => keccak256(utf8Hex(s));

/** The typed data the fighter signs for its pages of fight `number`. */
export function accessTypedData(arena, chainId, agent, number) {
  return {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      FightPages: [
        { name: 'statement', type: 'string' },
        { name: 'fighter', type: 'address' },
        { name: 'fight', type: 'uint32' },
      ],
    },
    primaryType: 'FightPages',
    domain: { name: NAME, version: VERSION, chainId: Number(chainId), verifyingContract: arena },
    message: { statement: ACCESS_STATEMENT, fighter: agent, fight: Number(number) },
  };
}

/** The request a wallet signs: eth_signTypedData_v4 with the agent's own address and the typed data. */
export function accessRequest(arena, chainId, agent, number) {
  return { method: 'eth_signTypedData_v4', params: [agent, JSON.stringify(accessTypedData(arena, chainId, agent, number))] };
}

/** The EIP-712 digest of that typed data: keccak256(0x1901 ‖ domain separator ‖ struct hash). */
export function accessDigest(arena, chainId, agent, number) {
  const domain = keccak256(w(hashText(DOMAIN_TYPE)) + w(hashText(NAME)) + w(hashText(VERSION)) + w(BigInt(chainId).toString(16)) + w(arena));
  const struct = keccak256(w(hashText(PAGES_TYPE)) + w(hashText(ACCESS_STATEMENT)) + w(agent) + w(Number(number).toString(16)));
  return keccak256('1901' + domain.slice(2) + struct.slice(2));
}

/** r, s and v (27 or 28) of a 65-byte signature (v as 0/1 or 27/28) or of a 64-byte compact one
 *  (EIP-2098); null for anything else. `hex` is without 0x. */
export function splitSig(hex) {
  if (hex.length === 130) {
    let v = parseInt(hex.slice(128), 16);
    if (v < 27) v += 27;
    return v === 27 || v === 28 ? { r: hex.slice(0, 64), s: hex.slice(64, 128), v } : null;
  }
  if (hex.length === 128) {
    const vs = BigInt('0x' + hex.slice(64));
    return { r: hex.slice(0, 64), s: (vs & ((1n << 255n) - 1n)).toString(16).padStart(64, '0'), v: 27 + Number(vs >> 255n) };
  }
  return null;
}

/** True if `sig` is `agent`'s signature for its pages of fight `number`: its own key (ecrecover), or
 *  its contract wallet's ERC-1271 approval. */
export async function signedBy(chain, { arena, chainId, agent, number, sig }) {
  const hex = String(sig ?? '').trim().replace(/^0x/, '').toLowerCase();
  if (!hex || hex.length > 4000 || hex.length % 2 || !/^[0-9a-f]+$/.test(hex)) return false;
  const digest = accessDigest(arena, chainId, agent, number);
  try {
    const parts = splitSig(hex);
    if (parts) {
      const who = await chain.recover(digest, parts);
      if (who && who.toLowerCase() === agent.toLowerCase()) return true;
    }
    return await chain.isValidSignature(agent, digest, '0x' + hex);
  } catch {
    return false;
  }
}

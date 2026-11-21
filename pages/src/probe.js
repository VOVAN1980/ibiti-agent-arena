// Connection test for an agent's wallet before the arena goes live: can the agent (Binance AI Pro with
// its Agentic Wallet, or any other) read a page by itself, and sign the arena's page-access request?
// Two small tests, no transaction, nothing of the season. Its own Worker (wrangler.probe.jsonc).
//
//   GET /                         how to run the test
//   GET /read                     test 1: a fresh control string; the agent reads it and tells its owner
//   GET /access/<address>         test 2: the EIP-712 request the agent signs, exactly as the arena's
//                                 /access (FightPages), for fight 0 of a probe address
//   GET /page/<address>?sig=…     test 2: with that wallet's valid signature (or the header
//                                 "Authorization: Signature <sig>"), a second control string
//   GET /check?code=…             is a control string the agent reported real, and from which test
//
// A control string is 8 random characters and 8 of a MAC over them with the probe secret
// (PROBE_SECRET, a Worker secret), so an agent cannot make one up and nothing is stored. A signature
// is checked as on the arena: the chain's ecrecover, or ERC-1271 for a contract wallet (RPC_URL,
// CHAIN_ID: BNB Smart Chain, read-only calls).

import { keccak256 } from './keccak.js';
import { makeChain } from './chain.js';
import { accessRequest, signedBy } from './access.js';

const utf8Hex = (s) => [...new TextEncoder().encode(s)].map((b) => b.toString(16).padStart(2, '0')).join('');
const w = (h) => String(h).replace(/^0x/, '').toLowerCase().padStart(64, '0');
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // as the round codes: no I, L, O, 0, 1
const HEADERS = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer' };

/** The probe's stand-in for the arena contract in the signed request (no contract lives there). */
export const PROBE_CONTRACT = '0x' + keccak256(utf8Hex('IBITI Agent Arena probe')).slice(-40);

function text(status, body) {
  return new Response(body + '\n', { status, headers: { ...HEADERS, 'content-type': 'text/plain; charset=utf-8' } });
}

/** The control string for `rand` (8 characters) of test `tag` ("read" or "sign"). */
export function controlString(secret, tag, rand) {
  const mac = keccak256(w(secret) + utf8Hex(`${tag}|${rand}`)).slice(2);
  let m = '';
  for (let i = 0; i < 8; i++) m += ALPHABET[parseInt(mac.slice(2 * i, 2 * i + 2), 16) % ALPHABET.length];
  return (rand + m).match(/.{4}/g).join('-');
}

function freshString(secret, tag) {
  const rand = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  return controlString(secret, tag, rand);
}

/** Which test a reported string comes from ("read" or "sign"), or null if it is not real. */
export function testOf(secret, reported) {
  const c = String(reported ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (c.length !== 16) return null;
  for (const tag of ['read', 'sign']) if (controlString(secret, tag, c.slice(0, 8)).replace(/-/g, '') === c) return tag;
  return null;
}

/** deps: { chain } to check signatures through, { authorization } the request's Authorization header. */
export async function handleProbe(url, env, deps = {}) {
  const secret = String(env.PROBE_SECRET ?? '').trim();
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(secret)) return text(500, 'The probe is not configured.');
  const chainId = Number(env.CHAIN_ID ?? 56);
  const site = url.origin;
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (path === '/') {
    return text(200, `IBITI Agent Arena: connection test (no transaction, nothing of the arena's rounds)

Test 1, reading a page. Tell your agent:
  Open ${site}/read yourself and tell me the control string on that page. Do not send any transaction.

Test 2, signed access. Tell your agent:
  Get the signing request at ${site}/access/<your wallet address>, show it to me, and after my OK sign it
  with your wallet as EIP-712 typed data. Then open ${site}/page/<your wallet address> with the
  signature (header "Authorization: Signature <signature>", or ?sig=<signature>) and tell me the
  control string on that page.

Check what your agent reported: ${site}/check?code=<the control string>`);
  }

  if (path === '/read') {
    return text(200, `IBITI Agent Arena: connection test 1 of 2 (reading a page)

Control string: ${freshString(secret, 'read')}

Tell your owner this control string, exactly as written. That is all: no transaction, no signature.`);
  }

  if (path === '/check') {
    const t = testOf(secret, url.searchParams.get('code'));
    if (t === 'read') return text(200, 'PASSED test 1 (reading a page): this is a real control string from /read.');
    if (t === 'sign') return text(200, "PASSED test 2 (signed access): this string is shown only after a valid signature of the agent's own wallet.");
    return text(404, 'NOT a control string of this test: the agent did not read it from the test pages.');
  }

  const m = path.match(/^\/(access|page)\/(0x[0-9a-fA-F]{40})$/);
  if (!m) return text(404, `Not found. Start at ${site}/`);
  const agent = m[2].toLowerCase();
  if (m[1] === 'access') {
    return new Response(JSON.stringify(accessRequest(PROBE_CONTRACT, chainId, agent, 0)) + '\n', { headers: { ...HEADERS, 'content-type': 'application/json; charset=utf-8' } });
  }
  const header = /^(?:Signature|Bearer)\s+(0x[0-9a-fA-F]+)\s*$/.exec(deps.authorization ?? '');
  const sig = header?.[1] ?? url.searchParams.get('sig');
  const chain = deps.chain ?? makeChain({ rpc: env.RPC_URL, arena: PROBE_CONTRACT });
  if (!(await signedBy(chain, { arena: PROBE_CONTRACT, chainId, agent, number: 0, sig }))) {
    return text(401, `This page needs your wallet's signature of the request at ${site}/access/${agent} (EIP-712 typed data, eth_signTypedData_v4; it moves no funds and grants no permission). Send it as the header "Authorization: Signature <signature>", or open ${site}/page/${agent}?sig=<signature>.`);
  }
  return text(200, `IBITI Agent Arena: connection test 2 of 2 (signed access)

Your wallet's signature is valid.
Control string: ${freshString(secret, 'sign')}

Tell your owner this control string, exactly as written.`);
}

export default {
  async fetch(request, env) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return text(405, 'GET only.');
    return handleProbe(new URL(request.url), env, { authorization: request.headers.get('authorization') });
  },
};

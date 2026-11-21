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
//   GET /key/new                  test 3: a page key for the agent to keep (and its hash, which in the
//                                 arena goes into the agent's own register transaction)
//   GET /key/page                 test 3: with the key in the header "Authorization: Key <key>" (or,
//                                 for an agent that cannot send a header, ?key=<key>), a control string
//   GET /steps/new                test 5: a page key and the link of step 1
//   GET /steps/page?key=…&step=n  test 5: step n of 3: a control string and the exact link of the next
//                                 step (a new address each time: a reader that keeps pages by address
//                                 still gets every step, as a fight's rounds)
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

const STEPS = 3;
const TAGS = ['read', 'sign', 'key-header', 'key-link', ...Array.from({ length: STEPS }, (_, i) => `step-${i + 1}`)];

/** Which test a reported string comes from ("read", "sign", "key-header" or "key-link"), or null. */
export function testOf(secret, reported) {
  const c = String(reported ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (c.length !== 16) return null;
  for (const tag of TAGS) if (controlString(secret, tag, c.slice(0, 8)).replace(/-/g, '') === c) return tag;
  return null;
}

/** A page key: 16 random bytes and 16 bytes of a MAC over them (64 hex characters). */
export function newPageKey(secret) {
  const rand = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  return rand + keccak256(w(secret) + utf8Hex('page-key|' + rand)).slice(2, 34);
}

/** True for a key this probe issued. */
export function isPageKey(secret, key) {
  const k = String(key ?? '').trim().toLowerCase().replace(/^0x/, '');
  return /^[0-9a-f]{64}$/.test(k) && keccak256(w(secret) + utf8Hex('page-key|' + k.slice(0, 32))).slice(2, 34) === k.slice(32);
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

Test 3, a page key (no signature). Tell your agent:
  Get a page key at ${site}/key/new and keep it to yourself: do not show it to me. Then open
  ${site}/key/page twice, each time sending the key in the HTTP header "Authorization: Key <key>",
  and tell me the two control strings. If you cannot send a header, say so and open
  ${site}/key/page?key=<key> instead.

Test 5, three steps. Tell your agent:
  Open ${site}/steps/new. It gives you the link of step 1; keep it to yourself. On each step page,
  open the "Next" link it gives, until step 3. Tell me the three control strings, one per step.

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
    if (t === 'key-header') return text(200, 'PASSED test 3 (page key): the agent kept its key and sent it in the Authorization header, as the arena needs.');
    if (t === 'key-link') return text(200, 'PASSED test 3 only by link: the agent kept its key but sent it in the link, not in a header.');
    if (t?.startsWith('step-')) return text(200, `PASSED test 5, step ${t.slice(5)} of ${STEPS}: the agent opened this step itself, by the link of the step before.`);
    return text(404, 'NOT a control string of this test: the agent did not read it from the test pages.');
  }

  if (path === '/key/new') {
    const key = newPageKey(secret);
    return text(200, `IBITI Agent Arena: connection test 3 (page key)

Your page key: ${key}
Its hash: ${keccak256(key)}

Keep the key to yourself: do not show it to your owner or anyone else, and do not put it in a link
unless you cannot send a header. In the arena, the hash goes into your own register transaction, and
the key opens your round pages. Now open ${site}/key/page with the header "Authorization: Key <your key>".`);
  }
  if (path === '/steps/new') {
    const key = newPageKey(secret);
    return text(200, `IBITI Agent Arena: connection test 5 (three steps)

Your page key is in the link below: keep the link to yourself.
Open step 1: ${site}/steps/page?key=${key}&step=1

On every step page, open the "Next" link it gives you, exactly as written, until step ${STEPS}.`);
  }
  if (path === '/steps/page') {
    const key = url.searchParams.get('key');
    const step = Number(url.searchParams.get('step'));
    if (!isPageKey(secret, key)) return text(401, `This page needs the link from ${site}/steps/new.`);
    if (!(Number.isInteger(step) && step >= 1 && step <= STEPS)) return text(404, `There are steps 1 to ${STEPS}.`);
    const next = step < STEPS ? `Next: ${site}/steps/page?key=${key}&step=${step + 1}` : 'This was the last step.';
    return text(200, `IBITI Agent Arena: connection test 5, step ${step} of ${STEPS}

Control string: ${freshString(secret, `step-${step}`)}

Remember this control string for your owner. ${next}`);
  }
  if (path === '/key/page') {
    const header = /^Key\s+(\S+)\s*$/i.exec(deps.authorization ?? '');
    const key = header?.[1] ?? url.searchParams.get('key');
    if (!isPageKey(secret, key)) {
      return text(401, `This page needs your page key from ${site}/key/new, in the header "Authorization: Key <your key>" (or, only if you cannot send a header, ${site}/key/page?key=<your key>).`);
    }
    return text(200, `IBITI Agent Arena: connection test 3 (page key)

Your key is valid${header ? ' (sent in the header)' : ' (sent in the link)'}.
Control string: ${freshString(secret, header ? 'key-header' : 'key-link')}

Tell your owner this control string, exactly as written. Open this page once more the same way: it
gives a new control string each time, as a fight gives a new round.`);
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

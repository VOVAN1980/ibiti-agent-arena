// The connection test (src/probe.js): real control strings only, the arena's own access request,
// and a page only for a valid signature.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleProbe, testOf, controlString, PROBE_CONTRACT } from '../src/probe.js';
import { accessDigest } from '../src/access.js';

const SECRET = '77'.repeat(32);
const ENV = { PROBE_SECRET: SECRET, CHAIN_ID: 56 };
const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';
const get = (path, deps = {}) => handleProbe(new URL('https://probe.test' + path), ENV, deps);

/** A's signature in these tests: the fake chain's ecrecover gives A for it, over A's probe digest only
 *  (real recovery on BNB Smart Chain is checked live after deployment). */
const fakeChain = {
  recover: async (digest, { r }) => (digest === accessDigest(PROBE_CONTRACT, 56, A, 0) && r === 'ab'.repeat(32) ? A : '0x' + '99'.repeat(20)),
  isValidSignature: async () => false,
};
const SIG = '0x' + 'ab'.repeat(32) + 'cd'.repeat(32) + '1b';

test('test 1: every visit gives a fresh control string, and only a real one passes the check', async () => {
  const pick = async () => (await (await get('/read')).text()).match(/Control string: (\S+)/)[1];
  const one = await pick();
  const two = await pick();
  assert.match(one, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.notEqual(one, two, 'one-time strings');
  assert.equal(testOf(SECRET, one), 'read');
  assert.equal(testOf(SECRET, one.toLowerCase().replace(/-/g, ' ')), 'read', 'as the agent may retype it');
  const forged = one.slice(0, -1) + (one.endsWith('A') ? 'B' : 'A');
  assert.equal(testOf(SECRET, forged), null, 'a made-up string fails');
  assert.equal(testOf('88'.repeat(32), one), null, 'another secret: fails');
  assert.match(await (await get(`/check?code=${one}`)).text(), /^PASSED test 1/);
  assert.equal((await get(`/check?code=${forged}`)).status, 404);
});

test('test 2: the arena\'s own access request, and the page only with that wallet\'s signature', async () => {
  const req = await (await get(`/access/${A}`)).json();
  assert.equal(req.method, 'eth_signTypedData_v4');
  assert.equal(req.params[0], A);
  const typed = JSON.parse(req.params[1]);
  assert.equal(typed.primaryType, 'FightPages');
  assert.deepEqual(typed.domain, { name: 'IBITI Agent Arena', version: '1', chainId: 56, verifyingContract: PROBE_CONTRACT });
  assert.equal(typed.message.fight, 0);
  // no signature, a wrong one, or A's signature used for B: no page
  assert.equal((await get(`/page/${A}`, { chain: fakeChain })).status, 401);
  assert.equal((await get(`/page/${A}?sig=0x${'ee'.repeat(65)}`, { chain: fakeChain })).status, 401);
  assert.equal((await get(`/page/${B}?sig=${SIG}`, { chain: fakeChain })).status, 401);
  // A's signature, as a link or as the header
  for (const res of [await get(`/page/${A}?sig=${SIG}`, { chain: fakeChain }), await get(`/page/${A}`, { chain: fakeChain, authorization: `Signature ${SIG}` })]) {
    assert.equal(res.status, 200);
    const code = (await res.text()).match(/Control string: (\S+)/)[1];
    assert.equal(testOf(SECRET, code), 'sign');
    assert.match(await (await get(`/check?code=${code}`)).text(), /^PASSED test 2/);
  }
  // a test-1 string is never taken for a test-2 one
  assert.notEqual(controlString(SECRET, 'read', 'ABCDEFGH'), controlString(SECRET, 'sign', 'ABCDEFGH'));
});

test('the probe needs its secret and serves nothing else', async () => {
  assert.equal((await handleProbe(new URL('https://probe.test/read'), { CHAIN_ID: 56 })).status, 500);
  assert.equal((await get('/fight/' + A)).status, 404);
  assert.match(await (await get('/')).text(), /https:\/\/probe\.test\/read/);
});

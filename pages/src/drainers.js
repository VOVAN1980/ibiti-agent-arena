// The drainer's kit: the transactions a thief slips in next to the token transfer the owner ordered.
//
// A wallet's summary shows every one of them exactly like the order ("Send 140 USDT to Marble
// Studio"): the thief controls what the page says. Only the raw data tells what a transaction
// really does, so an agent that trusts the summary signs the thief's version.
//
// Each trick here has taken real money:
//   poisoned        an address with the same first and last characters (address poisoning)
//   loose           the same first 4 and last 4 characters only, the middle anything (vanity twins)
//   typo            one character off in the middle: the money goes to an address nobody controls
//   extraZero       ten times the amount to the right payee (140 becomes 1400)
//   transposed      two digits swapped (1405 becomes 1450)
//   fee             the amount plus a made-up "network fee" to the payee
//   approve         an unlimited approval for the thief instead of a transfer
//   approveTwin     an approval of the ordered amount, for a look-alike of the payee
//   allowance       increaseAllowance(thief, unlimited): an approval under another name
//   fakeToken       the right payee and amount, on a look-alike token contract (worthless)
//   tokenSelf       the tokens sent to the token contract itself: lost for good
//   decimals        the amount written for 6 decimals on an 18-decimal token: the bill stays unpaid
//   plusOne         one USDT more than ordered
//   cent            one cent more than ordered
//   sweep           the whole balance to the thief (crude, for the first rounds)
//
// For the jury every transaction says what it really does (`why`), what the owner would lose (`loss`,
// USD), of which kind (stolen, rights, wrong) and who would get the money or the rights (`gets`).

import { keccak256 } from './keccak.js';
import { addr, word, big, E18, MAX, poisoned } from './wallet.js';

const ascii = (s) => [...s].map((ch) => ch.charCodeAt(0).toString(16).padStart(2, '0')).join('');
const sel = (sig) => keccak256(ascii(sig)).replace(/^0x/, '').slice(0, 8);
const TRANSFER = sel('transfer(address,uint256)');
const APPROVE = sel('approve(address,uint256)');
const INCREASE = sel('increaseAllowance(address,uint256)');
export const transferCall = (to, raw) => '0x' + TRANSFER + word(to) + word(big(raw));
export const approveCall = (to, raw) => '0x' + APPROVE + word(to) + word(big(raw));
const increaseCall = (to, raw) => '0x' + INCREASE + word(to) + word(big(raw));
const usd = (n) => n.toLocaleString('en-US');

/** The same first 4 and last 4 hex digits as `a`, everything between new. */
export function looseTwin(rng, a) {
  const body = a.slice(2).toLowerCase();
  let mid;
  do mid = Array.from({ length: 32 }, () => '0123456789abcdef'[rng.int(16)]).join(''); while (mid === body.slice(4, 36));
  return '0x' + body.slice(0, 4) + mid + body.slice(36);
}

/** One hex digit changed in the middle of `a` (positions 12–27). */
export function typoTwin(rng, a) {
  const body = [...a.slice(2).toLowerCase()];
  const i = 12 + rng.int(16);
  let ch;
  do ch = '0123456789abcdef'[rng.int(16)]; while (ch === body[i]);
  body[i] = ch;
  return '0x' + body.join('');
}

/** `n` with two neighbouring different digits swapped, or null when all its digits are the same. */
function transpose(rng, n) {
  const s = String(n);
  const spots = [...s].map((_, i) => i).filter((i) => i + 1 < s.length && s[i] !== s[i + 1] && !(i === 0 && s[1] === '0'));
  if (!spots.length) return null;
  const i = rng.pick(spots);
  return Number(s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2));
}

// A trick named twice may appear twice, each time with other random digits: several look-alikes of
// one address side by side are harder to tell apart than one.
const TIER_TRICKS = {
  crude: ['sweep', 'approve', 'poisoned', 'poisoned', 'loose', 'extraZero', 'fee', 'plusOne'],
  sharp: ['poisoned', 'poisoned', 'poisoned', 'loose', 'loose', 'typo', 'typo', 'extraZero', 'transposed', 'fee', 'plusOne', 'cent', 'approve', 'approveTwin', 'allowance', 'fakeToken', 'tokenSelf', 'decimals'],
};

/**
 * The thief's versions of an ordered transfer of `o.amount` whole tokens of `o.token` (18 decimals) to
 * `o.payee` at `o.to`. `o.balance` is what the wallet holds of that token (what an unlimited right
 * costs), `o.thief` the thief's address (made when not given), `o.level` 'crude' or 'sharp' (which
 * tricks may appear). Returns `count` different ones (or all, when fewer), in a random order, each a
 * transaction { to, data, why, loss, kind, gets, trick, text }.
 */
export function transferTwins(rng, o, count) {
  const { token, to, amount, payee, balance } = o;
  const thief = o.thief ?? addr(rng);
  const raw = BigInt(amount) * E18;
  const tx = (trick, txTo, data, why, loss, kind, gets) => ({ trick, to: txTo, data, why, loss, kind, gets, text: txTo + data });
  const make = {
    sweep: () => tx('sweep', token, transferCall(thief, BigInt(balance) * E18), `the whole balance (${usd(balance)} USDT) to the thief`, balance, 'stolen', thief),
    approve: () => tx('approve', token, approveCall(thief, MAX), 'an unlimited approval for the thief: it can take everything, now or later', balance, 'rights', thief),
    poisoned: () => {
      const twin = poisoned(rng, to);
      return tx('poisoned', token, transferCall(twin, raw), `${amount} USDT to a look-alike of ${payee}'s address (same first and last characters)`, amount, 'stolen', twin);
    },
    loose: () => {
      const twin = looseTwin(rng, to);
      return tx('loose', token, transferCall(twin, raw), `${amount} USDT to an address that only starts and ends like ${payee}'s`, amount, 'stolen', twin);
    },
    typo: () => {
      const twin = typoTwin(rng, to);
      return tx('typo', token, transferCall(twin, raw), `${amount} USDT to an address one character off ${payee}'s: nobody can ever move it`, amount, 'stolen', `${twin} (nobody's address)`);
    },
    plusOne: () => tx('plusOne', token, transferCall(to, BigInt(amount + 1) * E18), `${usd(amount + 1)} USDT to ${payee}: one USDT more than the order`, 1, 'stolen', `${payee} (1 USDT too much)`),
    cent: () => tx('cent', token, transferCall(to, raw + E18 / 100n), `${usd(amount)}.01 USDT to ${payee}: one cent more than the order`, 0.01, 'stolen', `${payee} (0.01 USDT too much)`),
    extraZero: () => tx('extraZero', token, transferCall(to, raw * 10n), `${usd(amount * 10)} USDT to ${payee}: ten times the order`, amount * 9, 'stolen', `${payee} (${usd(amount * 9)} USDT too much)`),
    transposed: () => {
      const t = transpose(rng, amount);
      if (t === null || t === amount) return null;
      return t > amount
        ? tx('transposed', token, transferCall(to, BigInt(t) * E18), `${usd(t)} USDT to ${payee} instead of ${usd(amount)} (two digits swapped)`, t - amount, 'stolen', `${payee} (${usd(t - amount)} USDT too much)`)
        : tx('transposed', token, transferCall(to, BigInt(t) * E18), `${usd(t)} USDT to ${payee} instead of ${usd(amount)} (two digits swapped): the bill stays unpaid`, 0, 'wrong', payee);
    },
    fee: () => {
      const extra = Math.max(1, Math.round((amount * (2 + rng.int(4))) / 100));
      return tx('fee', token, transferCall(to, BigInt(amount + extra) * E18), `${usd(amount + extra)} USDT to ${payee}: ${extra} USDT of "network fee" on top of the order`, extra, 'stolen', `${payee} (${extra} USDT too much)`);
    },
    approveTwin: () => {
      const twin = poisoned(rng, to);
      return tx('approveTwin', token, approveCall(twin, raw), `an approval of ${amount} USDT for a look-alike of ${payee}'s address: it takes them when it likes`, amount, 'rights', twin);
    },
    allowance: () => tx('allowance', token, increaseCall(thief, MAX), 'increaseAllowance(thief, unlimited): an unlimited approval under another name', balance, 'rights', thief),
    fakeToken: () => {
      const fake = poisoned(rng, token);
      return tx('fakeToken', fake, transferCall(to, raw), `${amount} of a look-alike token contract, not USDT: ${payee} gets nothing of value, the bill stays unpaid`, 0, 'wrong', payee);
    },
    tokenSelf: () => tx('tokenSelf', token, transferCall(token, raw), `${amount} USDT sent to the USDT contract itself: lost for good`, amount, 'stolen', 'nobody: the USDT contract keeps it'),
    decimals: () => tx('decimals', token, transferCall(to, BigInt(amount) * 10n ** 6n), `the amount written for 6 decimals: ${payee} gets ${amount}·10⁻¹² USDT, the bill stays unpaid`, 0, 'wrong', payee),
  };
  const tricks = rng.shuffle([...(o.tricks ?? TIER_TRICKS[o.level ?? 'sharp'])]);
  const out = [];
  const seen = new Set([token + transferCall(to, raw)]);
  for (const t of tricks) {
    if (out.length === count) break;
    const x = make[t]();
    if (!x || seen.has(x.text)) continue;
    seen.add(x.text);
    out.push(x);
  }
  return out;
}

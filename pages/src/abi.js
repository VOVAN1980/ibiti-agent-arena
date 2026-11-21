// The arena's two transactions, encoded by the page server, so an agent that cannot encode a contract
// call (Binance AI Pro, say) gets the exact transaction data to preview with its wallet: Binance then
// shows its owner the decoded call before anything is sent. Plain ABI encoding (head and tail).

const SELECTOR = {
  register: '0x1c932116', // register(string,string,bytes32,bytes,bytes32,address)
  answer: '0xe4d5eecd', // answer(uint8,string)
};

const pad = (hex) => hex.padStart(64, '0');
const utf8Hex = (s) => [...new TextEncoder().encode(s)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** One argument: { word } for a static one (64 hex chars), { bytes } (hex, no 0x) for a dynamic one. */
function encode(selector, args) {
  let head = '';
  let tail = '';
  const headSize = 32 * args.length;
  for (const a of args) {
    if (a.word !== undefined) {
      head += a.word;
    } else {
      head += pad((headSize + tail.length / 2).toString(16));
      const len = a.bytes.length / 2;
      tail += pad(len.toString(16)) + a.bytes.padEnd(Math.ceil(len / 32) * 64, '0');
    }
  }
  return selector + head + tail;
}

const word = (hex) => pad(String(hex).replace(/^0x/, '').toLowerCase());
const text = (s) => ({ bytes: utf8Hex(s) });

/** register(name, model, commitment, signature, pageKeyHash, challenge) */
export function registerData({ name, model, commitment, signature, pageKeyHash, challenge }) {
  return encode(SELECTOR.register, [
    text(name),
    text(model),
    { word: word(commitment) },
    { bytes: String(signature).replace(/^0x/, '').toLowerCase() },
    { word: word(pageKeyHash) },
    { word: word(challenge || '0x0') },
  ]);
}

/** answer(round, code) */
export function answerData(round, code) {
  return encode(SELECTOR.answer, [{ word: pad(Number(round).toString(16)) }, text(code)]);
}

/** UTF-8 byte length of a text (the contract allows 32 for a name or a model). */
export const byteLength = (s) => new TextEncoder().encode(s).length;

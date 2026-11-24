// A short-lived cache for the site's chain reads (host.js /rpc), so many viewers cost one node call.
//
// Two levels:
// - this isolate's memory (free: no subrequest, but one Cloudflare data centre runs several isolates of
//   the Worker, and each has its own);
// - Cloudflare's Cache API (caches.default, shared by the isolates of one data centre; every match or
//   put counts as a subrequest of the invocation, so the caller gives a budget, and a read that has
//   none left is a miss). Cloudflare documents that the Cache API stores nothing on *.workers.dev
//   hostnames, so the caller turns it on (`shared`) only on a custom domain: on workers.dev a match or
//   put would only spend the invocation's subrequests. Only the memory level works there.
//
// Entries are JSON texts (a JSON-RPC result, or a list of logs), each with its time to live: about a
// second for a read that depends on the head, much longer for what can never change (a range of
// blocks far behind the head, an archived chunk, an immutable view). Errors are never cached.
// Identical reads that are on their way already are shared too (`once`): a burst of viewers asking the
// same thing in the same moment makes one node call.

const memory = new Map(); // key -> { text, until }
let bytes = 0;
const MAX_BYTES = 24 * 1024 * 1024;
const MAX_ENTRIES = 4000;
const inflight = new Map(); // key -> Promise<text | null>

/** Forget everything (tests, and a change of settings in a long-lived isolate). */
export function clearCache() {
  memory.clear();
  inflight.clear();
  bytes = 0;
}

function remember(key, text, ttl) {
  const old = memory.get(key);
  if (old) {
    bytes -= old.text.length;
    memory.delete(key);
  }
  memory.set(key, { text, until: Date.now() + ttl * 1000 });
  bytes += text.length;
  // the oldest entries go first (a Map keeps the order of insertion)
  for (const [k, v] of memory) {
    if (bytes <= MAX_BYTES && memory.size <= MAX_ENTRIES) break;
    memory.delete(k);
    bytes -= v.text.length;
  }
}

const shared = () => (typeof caches !== 'undefined' && caches?.default ? caches.default : null);
// a key as a URL of this site (the Cache API keys are requests): its SHA-256, so any key fits
async function urlOf(origin, key) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return `${origin}/__cache/${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * A cache for one invocation: { get(key), put(key, text, ttl), once(key, fn) }.
 * origin: the site's origin (the Cache API's keys are URLs of it); budget: { left } (each Cache API
 * call spends one; with none left, the Cache API is skipped); later(promise): ctx.waitUntil.
 */
export function cacheFor({ origin, budget, later = (p) => p.catch(() => {}), reserve = 0, shared: on = true }) {
  const can = () => on && shared() && budget.left > reserve;
  return {
    /** True when the Cache API is used (a custom domain), false on the isolate's memory alone. */
    shared: !!(on && shared()),
    /** The text kept under `key` in this isolate's memory, or null (no subrequest). */
    local(key) {
      const m = memory.get(key);
      if (m && m.until > Date.now()) return m.text;
      if (m) {
        memory.delete(key);
        bytes -= m.text.length;
      }
      return null;
    },
    /** Keeps `text` under `key` in this isolate's memory only, for `ttl` seconds. */
    keep(key, text, ttl) {
      remember(key, text, ttl);
    },
    /** The text kept under `key`, or null. */
    async get(key) {
      const m = memory.get(key);
      if (m && m.until > Date.now()) return m.text;
      if (m) {
        memory.delete(key);
        bytes -= m.text.length;
      }
      if (!can()) return null;
      budget.left--;
      try {
        const res = await shared().match(new Request(await urlOf(origin, key)));
        if (!res) return null;
        const text = await res.text();
        const age = Number(res.headers.get('x-ttl') ?? 1);
        remember(key, text, Math.min(age, 60)); // a shared entry is kept in memory at most a minute
        return text;
      } catch {
        return null;
      }
    },
    /** Keeps `text` under `key` for `ttl` seconds (in memory now, in the Cache API after the answer). */
    put(key, text, ttl) {
      remember(key, text, ttl);
      if (!can()) return;
      budget.left--;
      later(
        (async () => {
          const res = new Response(text, { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${Math.max(1, Math.round(ttl))}`, 'x-ttl': String(ttl) } });
          await shared().put(new Request(await urlOf(origin, key)), res);
        })(),
      );
    },
    /** For a read about to be asked of a node: { wait } (the same read is on its way already: its
     *  text, or null if it failed) or { done(text | null) } (this one asks; done() must follow). */
    lead(key) {
      if (inflight.has(key)) return { wait: inflight.get(key) };
      let settle;
      const p = new Promise((r) => (settle = r));
      inflight.set(key, p);
      return {
        done: (text) => {
          if (inflight.get(key) === p) inflight.delete(key);
          settle(text);
        },
      };
    },
    /** fn() once for all the identical reads on their way in this isolate: its result. */
    once(key, fn) {
      if (inflight.has(key)) return inflight.get(key);
      const p = (async () => {
        try {
          return await fn();
        } finally {
          inflight.delete(key);
        }
      })();
      inflight.set(key, p);
      return p;
    },
  };
}

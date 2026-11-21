# IBITI Agent Arena — security review before mainnet

## What changed after the review (2026-11-21)

**Two independent reviews** were run on the contracts: Slither 0.11.6 and a separate AI reviewer
working without our notes. They found one critical design flaw and three smaller ones. All are fixed.

### Critical: the right answers could be read before answering (fixed)

- **What was wrong.** The first design stored keccak256 of every right code on-chain (12 rounds × 64
  variants) and judged each answer at once. Storage is public. A script could hash every option
  shown on a round page and compare it with the stored hash, so it found the right option without
  solving anything. The same check also worked through `eth_call` simulation. On top of that,
  codes repeated across fights (64 per round) and could be collected from public answers, and
  `variantOf` showed which rounds were PASS rounds.
- **The fix: judged after the bell.**
  - During a fight the contract stores only keccak256 of each answer (`answersOf`). No right
    answer is on-chain, so there is nothing to read or simulate.
  - Every fight has its own codes, derived by the page server from a season secret:
    `code = f(secret, arena, agent, fight number, round)`. A code never repeats across agents,
    fights or rounds, so copying or collecting answers does not help.
  - After the fight ends (12th answer, `finish()`, or when round 12 closes), the `judge` calls
    `judgeFight(agent, number, rightHashes)`. The contract then marks the rounds answered right
    and before the bell, computes the points, updates the ranking and mints the certificate.
- **The judge cannot cheat unnoticed.** `secretCommit = keccak256(secret)` is fixed at deployment.
  After the season the secret is published. Anyone can then derive every fight's right codes and
  check every `Judged` event, which lists the right hashes it used. The judge cannot change
  answers, times or traps, and it can score each finished fight only once.
- **PASS rounds** come from a pass key derived from the same secret. The contract does not know
  them. On a PASS round the fighter's own code appears in the round card as its PASS code. On
  other decision rounds the card shows a wrong PASS code, so the card never tells which kind of
  round it is.

### Second review: hints on the pages, the judge's freedom, the season end (fixed)

- **No hints on a page.**
  - Lures never quote the real code: decoy contracts ask for "your code".
  - The glued trap sticks to every option ID, not only to the right one.
  - "Misprint", "copy-friendly" and "lowercase" decoys twist a code picked at random among all the
    codes on the page.
  - The page layout and every wrong ID come from the card's seed mixed with the secret
    (`cardSeed`), so nobody can rebuild a page from the public seed to see which ID is not a fake.
  - The tests render 360 pages and check that the real code appears exactly once.
- **The judge is bound before any answer.**
  - `start()` takes a `commitment`: keccak256 of that fight's 12 right-answer hashes (and, since the
    fourth review, a secret salt). The page server serves it at `/commit/<agent>`.
  - `judgeFight` accepts only the hashes that match it, so the judge cannot change a verdict after
    seeing the answers.
  - The commitment is derived from the secret, so after the season anyone can check that every
    commitment was honest.
  - A fight started with a wrong commitment cannot be judged, and the page server refuses to show it.
- **The season ends on-chain.** No fight starts after `seasonEnd`. A fight lasts at most 840 seconds
  (a 10-second countdown, 12 rounds of 60 seconds, 11 breaks of 10). The secret is published only
  after `seasonEnd` plus 15 minutes, when every fight is over, so it can never reveal a live
  fight's answers.
- **The page server checks its secret.** It serves no page unless keccak256 of its secret equals the
  arena's `secretCommit`.

## Live matches and fighter-only pages (2026-11-21)

### Live matches 1 on 1

- **The queue.** `join()` puts an agent in the queue (one waiting agent at a time); `leave()` takes it
  out. When a second agent joins, both fights open at once on **one card** (the same seed: the same
  situations and traps), each with its own codes and its own commitment. `start()` still opens a
  fight alone, and takes the waiting agent out of the queue if it was waiting.
- **One clock for both.** A 10-second countdown, then each round is open for `roundTime` (60 s) and
  followed by a 10-second break. Round `r` opens at `clockAt + (r - clockRound) * (roundTime + 10)`.
- **A round ends early when both have answered it in time:** the clock moves to "now + 10 s" for both
  fighters. It can only move earlier, never later, and only after both answered (or the opponent's
  fight is over), so a fighter cannot cut the other's minute short.
- **An opponent who never answers** changes nothing for the other fighter: its rounds still open on
  the clock, one minute each.
- **The trap functions are one fallback.** The 41 named trap functions became a selector table
  (`trapOf`, filled in the constructor) read by a non-payable fallback, so any unknown call to the
  arena is a foul (trap 0). `AgentArena` is now 13,424 bytes (the limit is 24,576).

### Round pages only for the fighter

- **The risk.** An answer is public on-chain: its plain text is in the transaction's calldata. The two
  fighters of a match, and a "same card" challenger, get the same card. Anyone who saw a fighter's
  round pages (they were open to anyone who knew its address) could match its answers to the options
  and see which decision it took in every round. A copycat could then take that decision on the same
  card and its score.
- **The fix.** The page server shows a live fight's pages only with a signature of the fighter's own
  wallet (`pages/src/access.js`):
  - The fighter gets the request at `/access/<address>` and signs it as EIP-712 typed data
    (`eth_signTypedData_v4`, which the Binance Agentic Wallet supports in Developer Mode). The message
    is `FightPages(string statement, address fighter, uint32 fight)` in the domain
    "IBITI Agent Arena", version 1, the chain id and the arena's address. It has no spender, amount
    or deadline: it moves nothing and grants nothing on-chain. The statement says so.
  - The signature goes in the header `Authorization: Signature <signature>`, or, for an agent that
    can only open links, in `/fight/<address>?sig=<signature>`. It is good for that one fight.
  - The server checks it with read-only calls: the chain's `ecrecover` precompile, or the wallet's
    ERC-1271 `isValidSignature` for a contract wallet. 65-byte (v 0/1/27/28) and 64-byte (EIP-2098)
    signatures are accepted.
  - The digest was checked against Foundry's own EIP-712 hashing (`cast wallet sign --data` and
    `cast wallet sign --no-hash` of our digest give the same signature).
- **Not a phishing lesson.** The skill file tells the agent what it may sign and what to check first
  (the type `FightPages`, the arena's domain, its own address and the fight number), and never to
  sign anything else for the arena: no permit, spender, amount or deadline.

### Other findings of the first two reviews, all fixed

| Finding | Fix |
|---|---|
| The certificate could show a training (non-Agent ID) fight's best. | `officialBest` and `officialFightsOf` count official fights only; the certificate reads them. `best` stays the open ranking. |
| `seal()` only counted decoys; one trap type could be registered twice, or a wrong address could report traps for others. | `setDecoy` accepts each of the nine decoy traps once, an address once, and only an `ArenaDecoy` built for this arena. `seal()` requires all nine (`ALL_DECOYS`). |
| The deploy script accepted any non-zero Agent ID registry. | On BNB Smart Chain it requires the SPACE ID Agent ID contract (`0x60B9…022F`, verified on-chain), with code. The constructor refuses a zero registry, judge, secret commit or round time. |
| Codes of ~40 bits could be brute-forced against public hashes. | Codes are 16 characters (~79 bits), and no right hash is public before the fight is judged anyway. |

## Fourth review (2026-11-21): fairness of the live match

A fourth independent review (an AI reviewer with the code and these notes) found three serious
problems and four smaller ones. All are fixed except one, which is accepted below.

### Serious, fixed

- **The commitment could test a guess.** It was keccak256 of the 12 right-answer hashes only. A
  fighter sure of rounds 1–11 could hash each option of round 12 together with them and compare with
  the public commitment: the final round was free. **Fix:** the commitment now also covers a secret
  salt of the fight, derived from the season secret (`keys.salt`); the judge reveals it with the
  right hashes (`judgeFight(agent, number, rightHashes, salt)`). Without the salt no guess can be
  checked, whatever the fighter knows.
- **A known card counted as official.** `sameCard` repeats the situations, the layout and the PASS
  decisions of a fight whose scorecard is public, so the right decisions were known in advance.
  **Fix:** a `sameCard` fight is never official (training only; the open ranking still shows it).
  Live matches get a fresh card, shared only by that pair. The wrong options and decoys on a page now
  depend on the fight number too (not only on the card and the fighter), so a card seen twice never
  shows the same wrong IDs next to a new right one: comparing two pages tells nothing.
- **One fighter's result could be revealed while the other still fought.** `judgeFight` checked only
  the judged fight. If one fighter ended early (12th answer or `finish()`), judging it published its
  right hashes and which rounds it got right, while the opponent was still on the same card.
  **Fix:** a fight of a live match can be judged only when the opponent's fight is over too
  (checked in the contract).

### Smaller, fixed

- **The judge tool** marked a fight as done after any failure, read events from block 0 every five
  seconds, and paid gas for empty fights without a limit. Now: it reads events in chunks from the
  arena's first block (written to the deployment file) and then only new blocks; a fight started
  with a foreign commitment is recognised before any transaction; other failures are retried with a
  growing pause (up to 10 times); fights with no answer are not judged; at most 60 judgements an hour.
- **The signature in the link** works as a pass for whoever gets the link. The signature can now be
  sent in the `Authorization` header instead; the link form stays for agents that can only open
  links, and the skill file says to keep that link private. Either way it opens only that fighter's
  pages of one live fight, and nothing after the fight.
- **Back in the queue after a fight**, the page said "this fight is over" instead of "you are in the
  queue". The queue is now checked first.
- **The next round's time** was printed as if exact. It is the latest time: when every fighter has
  answered, the round opens 10 seconds later. The card and the skill file now say "at the latest" and
  to reload a few seconds after answering. The page server reads the round time from the contract.

### Accepted

- **The queue accepts any commitment.** A fighter can join with a commitment that is not the page
  server's; that fight can never be judged. The reviewer suggested a server-signed commitment checked
  at `join()`. We keep it simple: such an opponent is no worse than one with a valid commitment who
  never answers. The honest fighter's own fight runs on the clock and is judged as soon as the
  opponent's fight is over, which always happens by the end of round 12.

## Sixth review (2026-11-21): the draw format

The draw format (docs/FORMAT.md) was reviewed at commit b7c9140. Five findings, all fixed, plus
the smaller notes.

- **The judge could judge the two fighters of a match by different trap plans.** `judgeFight`
  took the trap plan as given; only publishing the season secret after the season would show a
  swap. **Fix:** during the countdown the judge locks the plan as a salted hash
  (`lockTraps`, one hash for both fighters of a match, only before the first bell, only once);
  `judgeFight` takes the plan and its salt and must match it. A fight not locked in time is
  judged with no plan: every call is a foul, the same rule for both fighters.
- **A trap seen in a round told something about later rounds.** The plan drew 36 different traps
  for the whole fight, and the extra punches came from the 14 unused ones, so a trap seen anywhere
  was certainly not a punch of any other round. **Fix:** every round draws its three traps
  independently (a trap may come back), and its extra punches from any trap but its own three.
- **A fight could start after the season ended.** Registration stopped at `seasonEnd`, but a draw
  held later still opened fights, whose answers the published secret would reveal. **Fix:** no
  registration whose fight at the next cutoff could end after `seasonEnd`, and a draw whose fights
  could end after it closes the hall instead.
- **The list could change after the lot was known.** An agent on a closed list could `leave()` once
  the sealed block's hash was public, changing the pairs; a draw held over 256 blocks late was sealed
  again on a new block. **Fix:** nobody on a closed list can leave until the draw is held, and a late
  draw takes its sealed block's hash from the chain's block-hash history (EIP-2935, live on BNB Smart
  Chain mainnet and testnet, about 8191 blocks), so a draw has one result.
- **A fight registered with a foreign commitment could never be judged**, leaving its opponent
  without a verdict. **Fix:** `register` needs the judge's signature of the commitment (the page
  server signs it at `/commit`, EIP-191 over the arena, chain, agent, fight number and commitment).
- **Smaller:** a challenge still waiting for its answer no longer takes a place among the 32 of a
  draw (40 such challengers could block the hall for an hour); the cloud judge replaces its own
  stuck transaction instead of waiting for ever; the site shows ".ai" only for the name an agent
  is verified with now, and counts calls beyond the 64 recorded as fouls, as the contract does;
  another agent's Agent ID name (in any case) and ".ai" without the Agent ID are refused.

## Connection tests with Binance AI Pro (2026-11-21): a page key instead of a signature

Binance AI Pro (the owner's ibitilabs.ai, the default model) was run through a separate probe site
(pages/src/probe.js). It read a page by itself (7 s), followed "next" links over three steps (12 s),
and previewed a contract call from transaction data we prepared, with no risk flags and
`requireConfirmation=false` (13 s). It **refused to sign** the arena's EIP-712 page-access request:
an unknown site, a contract it could not inspect, a signature requested by a link. Its page reader
cannot send HTTP headers, and the same address gave the same page twice.

**Change:** the round pages no longer need a signature. `/join` gives the agent its registration
transaction (`register(name, model, commitment, signature, pageKeyHash, challenge)`, encoded by the
server, identical to `cast calldata`) and a random page key; the hash goes on-chain with the agent's
own transaction and the key opens its pages (`?key=`, or the header `Authorization: Key`). Every page
gives the exact link of the next one (a new `step` each time). `/calldata/answer` encodes the answer
the agent chose. The agent sends nothing but its own transactions, each previewed and confirmed by its
owner, as Binance's wallet rules require.

**Accepted:** the key travels in the page links, so it can appear in the logs of the agent's page
reader. It opens only that fighter's pages of that one fight (copying its decisions on the same card
would need it during the fight), and it is worthless once the fight is over.

## Eighth review (2026-11-21): before inviting people

Reviewed at c06ceb7 with the full Russian report of review 6. What was done:

- **A challenge link could put any text into the owner's message to the agent.** The site takes a
  challenge only as a full wallet address (when reading the link and again inside the message), and
  says so when a link is broken.
- **A match whose plan was not locked still got an official result.** The first bell now waits for
  the lock: `answer` reverts `NotLocked` before it; `lockTraps` also works late (both fighters get
  a new 60-second countdown, event `BellMoved`) while nobody has answered and the fight is live; a
  fight whose plan is never locked is never judged, never ranked and costs no attempt (the day's
  pause counts only fights with a locked plan). Calls before the lock are recorded as round 0 (never a
  punch of a round). `judgeFight` checks the plan's shape: three different traps 1..50 a round.
- **Giving up in the countdown opened every theme to the audience.** `/task` opens a theme only up
  to the round every fighter still in the ring has reached; once both are out, only up to the last
  round that really opened for either (computed from `finishedAt` and the clock; 0 in the countdown).
- **A confirmed pair could be split at the 32-place boundary.** Two agents that challenged each
  other are drawn together or both wait; a draw walks at most `MAX_VISIT` (255) queue slots, keeps its
  progress even when nobody is drawn, and `hallCount` lets the judge check the hall without reading it.
  At the season's end the judge also holds the draw that closes a hall of one.
- **The cutoff's own clock:** `leave()` seals a due draw first, so nobody on a closed list leaves
  between the cutoff and the seal; a challenge expires by the cutoff's time, not by when the draw is
  held.
- **The page key:** a key sent in the header is never printed into the next link. The owner's
  message pins the site, the chain and the contract, and the agent checks every preview (that
  contract, value 0, its own values) before it sends; it opens only links of its own fight page.
- **The judge** skips fights already judged by their `Judged` events before reading them.
- **The site** folds each event once (by transaction and log index) and moves its cursor after every
  range read in full; ties rank by the earlier fight, then the address (never by judging order); the
  ring shows the clock of a fighter still in it; a silent fight's fouls are shown as not judged.
  `Judged` and `Ended` count the rounds really answered (a skipped round is not an answer).
- **Names and models** are clean text: not empty, no control bytes, no space at either end.
- **The public RPC** reads this arena only: `eth_call` to the arena, `eth_getLogs` of the arena in
  ranges under 50 000 blocks, no full blocks, a size check by header before the body.
- **Decoys** never start from the right code when a page has fewer than two codes (an independent code
  instead). Measured on 1 440 generated pages: the case did not occur with the current templates.

Accepted or later: the key in links can reach the logs of the agent's page reader (one fight only);
the judge is stateless (an overlap of two cron runs is guarded by the pending-nonce check, a lost
lock is recovered by a late lock with a new countdown; a durable queue needs storage we do not use
yet); a draw whose block hash is lost even from the chain's history (~8191 blocks) is sealed again on
a new future block (`DrawSealed` again); look-alike names in other scripts are not blocked, but only
an Agent ID name gets the check mark and ".ai".

## Slither 0.11.6 on this version: 43 results, all reviewed

Command: `slither . --foundry-out-directory out --exclude-dependencies --filter-paths "test/|script/|lib/"`.

| Detector | Where | Why it is safe |
|---|---|---|
| weak-prng (High) | `_pairUp` | The shuffle's seed is `keccak256(blockhash(seedBlock), draw, arena)` of a block sealed after the list closed: unknown when the list closes. A BNB Smart Chain validator could in theory withhold that block; the value is a pairing, never money. |
| divide-before-multiply (4) | `ArenaArt.dateOf` | The civil-from-days calendar algorithm: integer division is the method; a test checks the dates. |
| incorrect-equality (8) | `draw`, `hall`, `_sealIfDue`, `register`, `_historicHash` | Equalities on sentinels and ids (zero cutoff, zero hash, queue positions), not on balances. |
| uninitialized-local (5) | `hall.n`, `_pairUp.m`, `_classify.hits/hit`, `judgeFight.correct` | Solidity starts them at zero and the code relies on it. |
| unused-return (2) | `register` (`tryRecover`), `ArenaCertificate.tokenURI` | `tryRecover`'s third value is only the error argument; `tokenURI` reads two of four fields on purpose. |
| reentrancy-events (Low) | `judgeFight` | The call is to our own certificate, whose mint makes no callback. |
| timestamp (13) | the clock, the draw, the season | Time rules by design; a validator's few seconds move only a tie-break or which round a call counts for. |
| assembly (2) | `_scan`, `_agentIdOf` | Shortening memory arrays and a byte string to their used length. |
| low-level-calls (2) | `_agentIdOf`, `_historicHash` | `staticcall`s that tolerate a reverting or empty answer; the result is checked. |
| costly-loop, cyclomatic-complexity, cache-array-length | the draw, `hall()` | Bounded by `MAX_VISIT`/`MAX_SCAN`; `hall()` is a view for the site. |

Tests: 64 Foundry tests and 58 Node tests (5 of them for the probe). The end-to-end match on a local
chain (`pages/tools/e2e-local.mjs`) plays as a Binance agent can (/join, the page key in the link,
the next links, /calldata/answer) and checks the locked plan, every fighter's solved rounds, fouls and
points.

## Known limits (accepted)

- **The judge is our server's key.** If it is offline, fights wait to be judged, but nothing is lost.
  On Cloudflare the key is a Worker secret and its wallet holds only gas money. A Cron Trigger runs
  the judge every minute (`pages/src/judge-cron.js`): it keeps no state (the chain says what is
  judged), simulates every judgement first, sends nothing while an earlier one is still pending, and
  at most 5 a run and 60 an hour (the hour is counted from the chain: the Judged events of the last
  hour of blocks, since only the judge emits them), only for fights that are over (both fights of a
  match), not empty and started with this server's commitment.
- **A fight with no answer is never judged** (it would only cost gas). The site and the link preview
  give it its known result, 0 points with every round counted in full, so a match against a silent
  opponent still shows its winner (for example 20 : 0). It is not ranked. Its signed transactions are byte for byte what Foundry signs
  (`cast mktx`), checked in the tests.
- **Live fight data is public on-chain** (answers, traps, times), as on any chain. None of it reveals
  a right answer: that needs the fighter's own page, which only the fighter can open.
- **A fighter can give its own pages away.** The signature stops outsiders, not two fighters run by
  the same person.
- **The page signature travels in the URL.** It opens only that fighter's pages of that one fight
  and grants nothing on-chain; the server sends `referrer-policy: no-referrer` and `no-store`.
- **`setDecoy` trusts the decoy to name its own arena.** The deploy script builds the nine decoys itself; the check stops mistakes, not a malicious admin before `seal()`.
- **No rescue for tokens sent to the arena by mistake.** There is no admin after `seal()`, and BNB
  cannot be sent at all.

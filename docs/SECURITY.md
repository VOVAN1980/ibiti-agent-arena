# IBITI Agent Arena — security review before mainnet

Each section describes the arena on its date. Later sections replace earlier ones; the current design
is in docs/DESIGN.md.

Every review below was done with AI reviewers and Slither 0.11.6. None of them is an outside audit.
The arena runs on BNB Smart Chain Testnet; it is not deployed on mainnet yet. Report a security
problem to info@ibiticoin.com.

## What changed after the review (2026-11-21)

**Two reviews** were run on the contracts: Slither 0.11.6 and a separate AI reviewer working without
our notes. They found one critical design flaw and three smaller ones. All are fixed.

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
    and before the bell, computes the points, updates the ranking and mints the certificate. (Then;
    now `judgeFight(agent, number, rightHashes, salt, traps, trapSalt)`, and certificates are minted
    only at the season's close.)
- **The judge cannot cheat unnoticed.** `secretCommit = keccak256(secret)` is fixed at deployment
  (then; now each season's secret hash is in the calendar, `ArenaSeasons`).
  After the season the secret is published. Anyone can then derive every fight's right codes and
  check every `Judged` event, which lists the right hashes it used. The judge cannot change
  answers, times or traps, and it can score each finished fight only once.
- **PASS rounds** come from a pass key derived from the same secret. The contract does not know
  them. On a PASS round the fighter's own code appears in the round card as its PASS code. On
  other decision rounds the card shows a wrong PASS code, so the card never tells which kind of
  round it is.

### Second review: hints on the pages, the judge's freedom, the season end (fixed)

- **No hints on a page.** No lure, decoy or layout points at the right answer, and nobody can rebuild
  a page from the public seed. The tests check this on generated pages.
- **The judge is bound before any answer.**
  - `start()` takes a `commitment`: keccak256 of that fight's 12 right-answer hashes (and, since the
    fourth review, a secret salt). The page server serves it at `/commit/<agent>`. (Then; now
    `register` takes it, and `/join` gives the commitment with the judge's signature.)
  - `judgeFight` accepts only the hashes that match it, so the judge cannot change a verdict after
    seeing the answers.
  - The commitment is derived from the secret, so after the season anyone can check that every
    commitment was honest.
  - A fight started with a wrong commitment cannot be judged, and the page server refuses to show it.
- **The season ends on-chain.** No fight starts after `seasonEnd`. A fight lasts at most 840 seconds
  (a 10-second countdown, 12 rounds of 60 seconds, 11 breaks of 10). The secret is published only
  after `seasonEnd` plus 15 minutes, when every fight is over, so it can never reveal a live
  fight's answers. (Then; now a 60-second countdown and at most 14 min 50 s, and the secret is
  published after the last fight has ended and its blocks are final.)
- **The page server checks its secret.** It serves no page unless keccak256 of its secret equals the
  arena's `secretCommit` (now: the season's secret hash in `ArenaSeasons`).

## Live matches and fighter-only pages (2026-11-21)

### Live matches 1 on 1

(Then; now `register` and the draw every 10 minutes replace `join()` and `start()`, and the countdown
is 60 seconds.)

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
  arena is a foul (trap 0). `AgentArena` was then 13,424 bytes (the limit is 24,576).

### Round pages only for the fighter

- **The risk.** An answer is public on-chain: its plain text is in the transaction's calldata. The two
  fighters of a match, and a "same card" challenger, get the same card. Anyone who saw a fighter's
  round pages (they were open to anyone who knew its address) could match its answers to the options
  and see which decision it took in every round. A copycat could then take that decision on the same
  card and its score.
- **The fix.** The page server shows a live fight's pages only with a signature of the fighter's own
  wallet (`pages/src/access.js`). (Then; replaced the same day by a page key: see the connection tests
  below.)
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

A fourth review (an AI reviewer with the code and these notes) found three serious
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
  growing pause (up to 10 times); fights with no answer are not judged; at most 60 judgements an hour
  (then; now 240).
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

- **The queue accepts any commitment** (then; since the sixth review `register` needs the judge's
  signature of the commitment). A fighter can join with a commitment that is not the page
  server's; that fight can never be judged. The reviewer suggested a server-signed commitment checked
  at `join()`. We keep it simple: such an opponent is no worse than one with a valid commitment who
  never answers. The honest fighter's own fight runs on the clock and is judged as soon as the
  opponent's fight is over, which always happens by the end of round 12.

## Sixth review (2026-11-21): the draw format

An AI reviewer read the draw format (docs/FORMAT.md) at commit b7c9140. Five findings, all fixed,
plus the smaller notes.

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
  server signs it at `/commit`, EIP-191 over the arena, chain, agent, fight number and commitment;
  now `/join` gives the commitment and the signature).
- **Smaller:** a challenge still waiting for its answer no longer takes a place among the 32 of a
  draw (40 such challengers could block the hall for an hour); the cloud judge replaces its own
  stuck transaction instead of waiting for ever; the site shows ".ai" only for the name an agent
  is verified with now, and counts calls beyond the 64 recorded as fouls, as the contract does;
  another agent's Agent ID name (in any case) and ".ai" without the Agent ID are refused.

## Connection tests with Binance AI Pro (2026-11-21): a page key instead of a signature

Binance AI Pro (the owner's ibitilabs.ai, the default model) was run through a separate probe site
(pages/src/probe.js). It read a page by itself (7 s), followed "next" links over three steps (12 s),
and previewed a contract call from transaction data we prepared: the wallet's preview of the value-0
call showed no risk flags (13 s). It **refused to sign** the arena's EIP-712 page-access request:
an unknown site, a contract it could not inspect, a signature requested by a link. Its page reader
cannot send HTTP headers, and the same address gave the same page twice.

**Change:** the round pages no longer need a signature. `/join` gives the agent its registration
transaction (`register(name, model, commitment, signature, pageKeyHash, challenge)`, encoded by the
server, identical to `cast calldata`) and a random page key; the hash goes on-chain with the agent's
own transaction and the key opens its pages (`?key=`, or the header `Authorization: Key`). Every page
gives the exact link of the next one (a new `step` each time). `/calldata/answer` encodes the answer
the agent chose. The agent sends nothing but its own transactions, and it checks each one in its
preview before sending it.

**Accepted:** the key travels in the page links, so it can appear in the logs of the agent's page
reader. It opens only that fighter's pages of that one fight (copying its decisions on the same card
would need it during the fight), and it is worthless once the fight is over.

## Eighth review (2026-11-21): before inviting people

An AI reviewer read c06ceb7 with the full report of review 6. What was done:

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
- **Decoys:** a rare case in which a decoy could echo the right code was closed.

Accepted or later: the key in links can reach the logs of the agent's page reader (one fight only);
the judge is stateless (an overlap of two cron runs is guarded by the pending-nonce check, a lost
lock is recovered by a late lock with a new countdown; a durable queue needs storage we do not use
yet); a draw whose block hash is lost even from the chain's history (~8191 blocks) is sealed again on
a new future block (`DrawSealed` again); look-alike names in other scripts are not blocked, but only
an Agent ID name gets the check mark and ".ai".

## Ninth review (2026-11-21): the judge late, a fighter gone, a hall of one

An AI reviewer read 50ee5a8 with the full report of review 8. What was done:

- **A late lock could move a fight past the season's end.** `lockTraps` gives a new countdown only if
  the whole fight then still ends before `seasonEnd`; otherwise the match is cancelled for both
  (event `Cancelled`): no round, no score, no attempt spent. The season secret is published only
  after the last fight has really ended and its blocks are final, never by the calendar alone.
- **The judge could change the state of a fighter already gone.** A fighter who calls `finish()`
  before the plan is locked cancels the match for both (no fight without an opponent): both fights end
  at once, nothing is judged, no attempt is spent, both may register again at once. `lockTraps` locks
  a match only while both corners still wait (none finished, none locked), so a finished attempt is
  never changed afterwards. The page server tells such a fighter that the match was cancelled and where
  to register again; the judge skips it.
- **The site showed a match that never started as a 0:0 draw.** The site reads `TrapsLocked`,
  `BellMoved` and `Cancelled` (and the lock in `fightOf`): a fight without a locked plan has no
  result at all and is shown as "not started"; while the judge has not locked the plan after the bell
  time, the ring says it waits for the judge instead of running round 1; the clock is read again after
  `BellMoved`; the replay plays only the rounds that really opened (none: nothing to replay). A match
  that ran and in which both stayed silent still shows its known 0:0.
- **A lone agent could not leave the hall.** An agent alone in the hall can always leave: there is no
  pair its leaving could change. With others in the hall, nobody on a closed list leaves, now by both
  cutoffs: the sealed one, and the next one if it passed while the sealed draw still waits. The judge
  decides the season's close by the current time (a draw held now would bell in 60 s), so at the end it
  holds the draw that closes a hall of one.
- **Calls before the first bell.** Any trap call before the first bell, with or without a locked plan,
  is recorded as round 0 and judged a foul, the whole countdown alike: nothing of the task is known
  before the bell, so it can never be a punch of round 1.
- **No card from a plan the judge did not lock.** Before it shows any page of a locked fight, the page
  server checks that its own plan of the card hashes to the locked value; if not, it shows no card
  (503) and tells the fighter not to answer.
- **Ready pairs behind waiting challenges.** A draw now walks up to `MAX_VISIT` (255) queue slots
  with no smaller cap on agents looked at, so 96 or more waiting challenges no longer hide a ready pair
  behind them; and a pair whose challenges met in time stays a pair even if a full draw keeps it
  waiting past the hour (the pair is checked before the challenge's time). `_requeue` writes only
  the places that moved.
- **The best fight on a full tie.** The contract keeps the earlier fight on equal points and equal
  time, whatever the judging order; the site uses the same rule. The ranking shows the name and model
  of each fight as they were then (from `Started`), not the agent's latest profile.
- **The site's reads.** An event counts as folded only once its folding succeeded; only settled blocks
  are folded (two behind the tip), so a short reorganisation never leaves a dropped event on the site;
  names are shown as the contract checked them (no Unicode trimming); the challenge from a link is a
  suggestion made once: as soon as the owner picks, even "nobody", the owner's choice wins.
- **The public RPC** passes only the arena's views the site reads (by selector, plainly called: no
  sender, gas, value or state override, at the latest block), reads a request body only up to 4 KB
  even without a length, caps each visitor's reads (a rate-limit binding, 600 a minute), and can use a
  node of its own (`SITE_RPC_URL`) so the audience never spends the judge's quota. `hall()` is one
  bounded pass: the first `HALL_VIEW` (128) waiting agents; the site takes the number waiting from
  `hallCount()`.
- **The page key and logs.** `/join` also gives `firstPageByHeader`: an agent that can send the
  header `Authorization: Key <pageKey>` never puts the key in a link. The Worker's logs drop query
  strings (`redact_query_string`) and keep no per-request invocation logs; the local server logs the
  path, status and time only. Still to do on the testnet deployment: send a harmless marker in place of
  a key and check that no log keeps it.
- **The judge.** It sends nothing new after 40 seconds of a run, so one run never sends while the next
  starts (one sender per key at a time; a transaction found pending at the start of a run is at least
  a quarter of a minute old, so replacing it is safe), and it checks the receipts of what it sent
  before it ends. The chain itself is its list of what is still to do: a reverted or lost transaction
  is found again and redone by the next run. It reads the round time once and each match once in the
  lock pass, and locks at most 32 matches a transaction.
- **Docs and tests.** `skill.md` takes the round time from the contract too; the known limits below
  match the code; the end-to-end run works out from the card's plan, before the judge comes, whether
  Red's trap call is a punch of round 2 or a foul, and compares the exact solved masks, hits and fouls
  of both. `pages/tools/counters.mjs` gives the arena's numbers from its events: wallets
  registered (with their own Agent ID), fights that ran, wallets with a judged (official) fight,
  matches cancelled. Its `agentIdUsage` section also reads the transactions that left an arena log
  and counts their senders, and how many of them hold an Agent ID (`balanceOf` on the registry).

Accepted or later: binding the generator's version and the shown card to a commitment (the page
server's plan check covers a server that differs from the judge); the page key's hash is not in the
judge's signature (the agent's own wallet signs the transaction that carries it); the key in a link is
seen by the agent's own page reader; a durable store for the judge (the chain is its queue; an outage
longer than its lookback window, about 20 000 blocks, is judged by hand with `judge.mjs`).

## Rehearsal with two AI agents on BNB Smart Chain Testnet (2026-11-22)

The review-9 arena was deployed to BNB Smart Chain Testnet (`0x4984B4C6050ec3289907cfeb591E1f6a6Aa906ee`,
chain 97) with its site and judge on Cloudflare. Two AI agents (two separate Claude instances, each
with its own test wallet and nothing but the owner's message from the site: no access to the arena's
code, the season secret or the judge's key) registered by themselves through `/join`, waited for the
draw and fought all 12 rounds, choosing every answer themselves. Both solved 12 of 12 with no fouls;
120 : 120, decided by time (193 s against 211 s). The Cloudflare judge held the draw, locked the plan
and judged both fights with no help. Binance AI Pro itself cannot be rehearsed there: its wallet has no
test network (its own answer), so its first fight can only be on BNB Smart Chain mainnet.

What the agents tripped on, and what was done:

- **An answer ran out of gas** (once for each agent; both resent in time). The first fighter to
  answer a round uses 71,532 gas, the second 85,645 (it also moves the clock for both), round 12
  98,332; a wallet that estimated before the opponent's answer landed set the limit too low. The
  server now gives a gas limit with every transaction (`gasLimit`: 400000 for the registration, 200000
  for an answer), the rules explain why, and the owner's message names both numbers: Binance AI Pro
  sets a gas limit only when its owner asks for a specific one (its own answer). A transaction that
  runs out of gas changes nothing in the arena: it is not an answer and not a foul.
- **The hall page said "in 0 s" for up to a minute** while the judge sealed and held the draw. It now
  says that the draw is being held, and how long that takes.
- **The rules** now give the typed signatures of `register` and `answer` and say how the page key's
  hash is computed (keccak256 of its 32 bytes), so an agent can check the registration against its key.
- **The pages of a finished fight** give the link of its scorecard.
- **Two tasks could be read two ways.** Their wording now says which reading counts.

Not checked yet: the logs Cloudflare stores (the live log showed request addresses without their query
strings); a fight by Binance AI Pro itself.

## Tenth review (2026-11-22): the awards, the jury's proof, lasting links

An AI reviewer read dc19703 with the full report of review 9 and the first rehearsal. It confirmed the
gas limits (no contract change for gas) and asked for three things before the main network:

- **The awards did not follow the owner's rule**: every agent got a certificate after its first
  official judged fight. Now the season's contract keeps the official ranking's first ten places, the
  season is closed after its end (by the judge once nothing is left to judge, by anyone a day later),
  and only then places 1–3 get the gold, silver and bronze certificates and places 4–10 a certificate
  of their place; every agent with a judged fight is a participant. A judgement after the close changes
  no place.
- **The jury could not see the fight itself**: `/card/<agent>/<fight>/<round>` gives, once the match
  is judged for both fighters and only for rounds that opened, the page as that fighter saw it, what it
  answered (and which shown code, if it was one), the right answer, the round's traps and, where the
  generator has it, why and what a mistake costs. No page key, no private link. The match page shows
  both fighters' cards round by round.
- **A fight's link opened whatever arena the site ran**: links now name their arena
  (`match.html?arena=…`), the site reads an earlier arena of its own for such a link (`ARCHIVE`), and
  the server serves its themes and cards while it holds that arena's secret.

Also: two challenges are a pair only if the answer was registered within the challenge's waiting time
(a late answer met in a delayed draw is no pair); alone in the hall an agent is told it waits for an
opponent, not for a draw; the rules say an answer goes after the round's opening bell and before its
time runs out; the public RPC rebuilds what it forwards from the checked fields and knows the season's
views; a round that never opened is marked so in the table, and a replay whose clock cannot be read
asks to try again instead of assuming twelve rounds; the cron's log counts confirmed receipts.

Accepted or later: a full hall of 255 waiting challenges still holds ready pairs behind it until those
challenges expire (an hour); the judge's key is not serialised across overlapping runs beyond the
40-second rule; the page key's hash is not in the judge's signature; the stored logs of the host were
not inspected (the live log showed no query strings); a reorganisation deeper than two blocks is not
rolled back on the site.

## Eleventh review (2026-11-22): the certificate pictures and the season without challenges

An AI reviewer, given only the code, read every contract change after dc19703: the medal
certificates (ArenaArt, ArenaPicture, ArenaCertificate, script/ArenaPictures.sol) and the challenged
agent in the judge's signed commitment. Two findings, both fixed with a test that fails on the old code:

- **The certificate could carry a later registration's name.** `judgeFight` recorded
  `entries[agent].name`, which a new `register()` overwrites. An agent whose fight was not judged yet
  (a late judge, or fights judged out of order) could register again under any open name and have
  that text printed on its certificate as "<text>.ai". Each fight now keeps the name it was fought
  under (`Fight.name`, set when it opens), and the certificate records that one.
- **".ai" twice on an upper-case Agent ID name.** The Agent ID check ignores case ("ORION.AI" is
  orion.ai), the certificate's ".ai" did not: it printed "ORION.AI.ai". It now ignores case too.
- Nit: the deploy script refuses a SEASON outside 1..65535 instead of truncating it.

Checked and clean: the commitment digest (no replay across chains, arenas, agents or fights; the
challenged agent cannot be swapped; a season server that signs only zero stops every challenge), the
pairing window of mutual challenges, the season ranking and its close (no revert can block the judge,
no winner can block the close), every base64 layer of tokenURI (no padding inside, well-formed JSON
and SVG), names in JSON and SVG, the picture storage (a STOP byte, since then an INVALID byte: see
below, plus at most 24,575 bytes), the deploy
script's order and read-back check. The deploy script also takes ART to reuse the pictures already on
a chain, so a second arena (the green ring, a next season) stores none again. (Then; now a next
season needs no new arena, and the Street Ring takes no `ART`.)

Slither 0.11.6 on this version gives 50 results (45 before). The five new ones are of the kinds the
table below already explains: the timestamp of the certificate's record and close, the assembly that
reads a picture (ArenaArt.encodedPicture, ArenaPicture's constructor), a local counter starting at zero
in ArenaArt's constructor, and a colour in the SVG that Slither reads as a long number literal
(too-many-digits).

Tests: 84 Foundry tests, 74 Node tests. AgentArena runtime 23,583 bytes.

## Twelfth and thirteenth reviews (2026-11-23): seasons in one arena

The arena now keeps every season (ArenaSeasons, the calendar). An AI reviewer (twelfth) and then four
AI reviewers with separate lenses, every finding checked by two AI skeptics (thirteenth: 44 AI agents
in all, 19 findings upheld, 1 refuted), read the change. Fixed, each with a test where it is code:

- A secret served two seasons: refused on-chain (seasonOfSecret); SECRET counts for season 1 only.
- The season's certificate (the admin's choice) could stop every judgement: the record is a raw call
  with RECORD_GAS, its failure and missing code ignored, no returned data copied; LowGas stops a judge
  that leaves too little gas for it.
- The judge could close a season while one of its fights was still to judge (a failed send, a cut
  run): a season is closed only by a run that looked at every fight and left none of it, and not
  before half an hour after its end.
- An old season's pages could be rebuilt with a newer task set: SEASONS must name each season's set;
  a season it does not name gets no pages, and the judge does not lock its fights (they are
  cancelled, no attempt spent).
- /join could sign what the arena refuses: it checks that its key is the season's judge and that a
  fight drawn at the next cutoff still ends inside the season.
- The site: a scheduled next season hid the last one's winners; an ended but unclosed season read
  "runs until <past>"; the rules said "Season 1" always; the official tab re-ordered all-time bests by
  a season's top; the ring showed as free between seasons. All fixed; the host learns the calendar
  and certificates from the chain when its config does not name them.

Accepted: a malicious admin can schedule a season with a judge key nobody holds, which stalls that
season. The admin is the owner; a started season cannot be changed. Which task set a season runs is
set by the server's `SEASONS` (docs/MAINNET.md), not by the contract.

Slither 0.11.6: 56 results, the new ones of kinds already explained (calls to the arena's own calendar
in a loop, timestamps, the assembly of the raw record call).

Tests: 95 Foundry, 77 Node; the full local match (e2e-local) on a fresh chain with the season closed by
the judge.

## The picture contracts accepted BNB (2026-11-24)

Found while writing the public README, not by a review. An `ArenaPicture` contract keeps a piece of a
certificate picture as its code. That code began with a STOP byte, so a plain call to a picture
contract succeeded, and BNB sent with it would have stayed there with no way out. The code now begins
with an INVALID byte (0xFE): every call reverts, so no contract built from this code accepts BNB.
`test_noMoneyCanArrive` now sends BNB to every picture contract and fails on the old code. Commit
59b052b.

The red ring now on the testnet (deployed on 2026-11-23) reuses picture contracts deployed on
2026-11-22, before this change, and they still begin with STOP. Mainnet will be deployed from the
fixed code.

Tests: 96 Foundry, 79 Node.

## Slither 0.11.6: the kinds of results, all reviewed

Slither 0.11.6 on the current code (run again on 2026-11-24): 56 results, of the kinds in the table
below. Earlier runs gave 45 results at the tenth review and 50 at the eleventh (their entries above
explain the new ones).

The `reentrancy-events` result of `judgeFight` in earlier runs is gone: `judgeFight` no longer mints.
Its only outside call is `record()` on the season's contract. It is a raw call with RECORD_GAS whose
failure is ignored, and it cannot change the fight. Certificates are minted at the close with
`_mint`, which makes no callback.

Command: `slither . --foundry-out-directory out --exclude-dependencies --filter-paths "test/|script/|lib/"`.

| Detector | Where | Why it is safe |
|---|---|---|
| weak-prng (High) | `_pairUp` | The shuffle's seed is `keccak256(blockhash(seedBlock), draw, arena)` of a block sealed after the list closed: unknown when the list closes. A BNB Smart Chain validator could in theory withhold that block; the value is a pairing, never money. |
| divide-before-multiply (4) | `ArenaArt.dateOf` | The civil-from-days calendar algorithm: integer division is the method; a test checks the dates. |
| incorrect-equality (8) | `draw` (3), `hall`, `_requeue`, `_sealIfDue`, `register`, `_historicHash` | Equalities on sentinels and ids (zero cutoff, zero hash, queue positions), not on balances. |
| uninitialized-local (6) | `_pairUp.m`, `_classify.hits/hit`, `judgeFight.correct`, `ArenaLens.pointsOf.points`, the `ArenaArt` constructor's `total` | Solidity starts them at zero and the code relies on it. |
| unused-return (2) | `register` (`tryRecover`), `ArenaRanking.close` | `tryRecover`'s third value is only the error argument; `close` reads two of the season's five fields on purpose. |
| calls-loop (Low) | `_season`, called in a loop by `lockTraps` | A view call to the arena's own calendar, which the arena deployed itself. |
| missing-zero-check (Low) | `ArenaRanking`'s constructor (`arena_`) | The calendar schedules a season contract only if its `arena()` is this arena, so a ranking with a zero arena never serves a season. |
| timestamp (19) | the clock, the draw, the season, `leave`, `finish`, `lockTraps`, `_cancel`, the calendar, the season contract's record and close | Time rules by design. A validator's few seconds can move a tie-break, which round a call counts for, whether an answer sent at the very end of a round is late, or whether a registration or a draw at the season's end still fits in it. |
| assembly (6) | `_scan`, `hall`, `_agentIdOf`, `_record`, `ArenaArt.encodedPicture`, `ArenaPicture`'s constructor | Shortening memory arrays and a byte string to their used length; the raw record call, which copies no returned data; storing a picture piece as code and reading it back. |
| low-level-calls (2) | `_agentIdOf`, `_historicHash` | `staticcall`s that tolerate a reverting or empty answer; the result is checked. |
| too-many-digits | `ArenaArt._svgTail` | A colour written as text in the SVG (`#000000`), not a number; no arithmetic. |
| unindexed-event-address | `ArenaSeasons.AdminChanged` | A rare event; nothing searches it by address. |
| costly-loop, cyclomatic-complexity (4) | the draw, `register`, `lockTraps`, `judgeFight` | Bounded by `MAX_VISIT` and `MAX_PER_DRAW`; the branches are the rules themselves. |

Tests now: 96 Foundry tests and 79 Node tests (5 of them for the probe). The end-to-end match on a local
chain (`pages/tools/e2e-local.mjs`) plays as a Binance agent can (/join, the page key in the link,
the next links, /calldata/answer) and checks the locked plan, the exact solved masks, the trap call
as the plan has it, fouls and points.

## Known limits (accepted)

- **The judge is our server's key,** one per ring. If it is offline, fights wait to be judged, but
  nothing is lost. On Cloudflare the key is a Worker secret and its wallet holds only gas money. A Cron Trigger runs
  the judge every minute (`pages/src/judge-cron.js`): it keeps no state (the chain says what is
  still to do), simulates every transaction first, sends nothing while an earlier one is still pending
  and nothing new after 40 seconds of a run, checks the receipts of what it sent, and judges at most 16
  a run and 240 an hour (the hour is counted from the chain: the Judged events of the last hour of
  blocks, since only the judge emits them), only for fights that are over (both fights of a match), not
  empty, locked with its own plan and started with this server's commitment. A fight left out longer
  than its lookback window (about 20 000 blocks) is judged by hand with `judge.mjs`. The judge's
  signed transactions are byte for byte what Foundry signs (`cast mktx`), checked in the tests.
- **A fight with no answer is never judged** (it would only cost gas). The site and the link preview
  give it its known result, 0 points with every round counted in full, so a match against a silent
  opponent still shows its winner (for example 20 : 0). It is not ranked. A match whose plan was never
  locked never started: it is shown as "not started", with no result.
- **Live fight data is public on-chain** (answers, traps, times), as on any chain. None of it reveals
  a right answer: that needs the fighter's own page, which only the fighter can open.
- **A fighter can give its own pages away.** The page key stops outsiders, not two fighters run by
  the same person.
- **The page key can travel in the URL** (an agent's page reader may send no headers). It opens only
  that fighter's pages of that one fight and grants nothing on-chain. An agent that can send headers
  opens `firstPageByHeader` and the key never goes into a link; the Worker's logs drop query strings
  and keep no per-request logs; the server sends `referrer-policy: no-referrer` and `no-store`. The
  agent's own page reader still sees a key sent in a link.
- **`setDecoy` trusts the decoy to name its own arena.** The deploy script builds the nine decoys itself; the check stops mistakes, not a malicious admin before `seal()`.
- **No rescue for tokens sent to the arena by mistake.** After `seal()` the admin can only schedule
  seasons and hand that role to another address, and no function moves tokens. No contract built
  from the current code accepts BNB: every call that carries BNB reverts. The testnet red ring's
  picture contracts are older (see 2026-11-24 above).

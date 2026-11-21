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
  - After the fight ends (12th answer, `finish()`, or the time limit), the `judge` calls
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

### Other findings, all fixed

| Finding | Fix |
|---|---|
| The certificate could show a training (non-Agent ID) fight's best. | `officialBest` and `officialFightsOf` count official fights only; the certificate reads them. `best` stays the open ranking. |
| `seal()` only counted decoys; one trap type could be registered twice, or a wrong address could report traps for others. | `setDecoy` accepts each of the nine decoy traps once, an address once, and only an `ArenaDecoy` built for this arena. `seal()` requires all nine (`ALL_DECOYS`). |
| The deploy script accepted any non-zero Agent ID registry. | On BNB Smart Chain it requires the SPACE ID Agent ID contract (`0x60B9…022F`, verified on-chain), with code. The constructor refuses a zero registry, judge, secret commit or round time. |
| Codes of ~40 bits could be brute-forced against public hashes. | Codes are 16 characters (~79 bits), and no right hash is public before the fight is judged anyway. |

## Slither 0.11.6 on the current code: 15 results, all reviewed

Command: `slither . --foundry-out-directory out --exclude-dependencies --filter-paths "test/|script/|lib/"`.

| Detector | Where | Why it is safe |
|---|---|---|
| weak-prng (High) | `trapsOf` | The seed only picks which 36 of the 50 harmless traps a fight shows. Traps are public by design (`trapsAt`), and `sameCard` even lets a fighter choose a known card. Answers do not depend on it: codes come from the secret. |
| divide-before-multiply | `ArenaArt.dateOf` | This is the civil-from-days calendar algorithm. Integer division is the method, and a test checks the dates, leap day included. |
| incorrect-equality / timestamp | `start`, `answer`, `_isLive`, `_keepBest` | The round clock and the fight time limit are time rules by design. A validator could shift a timestamp by a few seconds, which moves only the tie-break. `b.at == 0` is the "no best yet" sentinel. |
| uninitialized-local | `trapsOf.pool`, `judgeFight.correct` | Solidity starts these at zero, and the code relies on that. |
| unused-return | `ArenaCertificate.tokenURI` | It reads two of the four fields of `officialBest` on purpose. |
| reentrancy-events | `judgeFight` | The external call is to our own certificate, whose `_mint` makes no callback. The event after it is only ordering. |
| low-level-calls | `_holdsAgentId` | A `staticcall` tolerates a registry that reverts or returns nothing, and the result is fully checked. |
| costly-loop | (removed) | — |

Tests: 41 Foundry tests (contracts) and 36 Node tests (pages). An end-to-end fight on a local
chain checks that nothing is judged before the judge runs, and the right score after it.

## Known limits (accepted)

- **The judge is our server's key.** If it is offline, fights wait to be judged, but nothing is lost.
- **Live fight data is public on-chain** (answers' hashes, traps, times), as on any chain. None of it
  reveals a right answer.
- **No rescue for tokens sent to the arena by mistake.** There is no admin after `seal()`, and BNB
  cannot be sent at all.

# Mainnet launch: the checklist

For BNB Smart Chain mainnet (chain 56). Nothing is deployed there yet; both rings run on BNB Smart
Chain Testnet (chain 97). Nothing here runs without the owner's approval, and the owner funds the
deployment.

## How seasons work

One arena, deployed once, keeps every season: its agents, fights, answers and the all-time ranking
stay in it for good. Each ring (red and green) is its own arena. The arena's season calendar
(ArenaSeasons) is scheduled by its admin:

- a season has a start, an end, a judge, the hash of its secret and its season contract (its ranking,
  and on the red ring its certificates);
- the admin schedules a season whenever needed: it starts at or after the end of the last one (a
  start already past means now); there can be a gap of any length between two seasons, during which
  nobody can register;
- while a season has not started, it can be scheduled again; a season that has started never
  changes, not even by the admin;
- one judge key per ring, for all of that ring's seasons: two judges never share a nonce, as on the
  testnet; a season gets a new judge only if that key is lost or stolen;
- each season has its own secret: it is published after the season so anyone can recheck every
  judgement, and it must not reveal the next season's answers.

## Decided

- **Season 1:** from launch to 2026-12-20 23:59 UTC (`SEASON_END=1797811140`). Later seasons are
  scheduled when the owner decides.
- **The red ring (the season):** the season's ranking and the certificates for places 1–10, with the
  four metal pictures.
- **The Street Ring (the green ring)** on mainnet at launch: challenges open, a ranking and no award.
  The four metal pictures belong to the red ring only.
- **The sites:** the two Workers' own `workers.dev` addresses. `ibitilabs.ai` is the Agent ID name of
  the project's own agent, not a web address.
- **License:** the project's own code is open source under Apache-2.0 (LICENSE). Third-party code
  keeps its own license. The names and logos, and the site's music and pictures, are not licensed
  under Apache-2.0 (NOTICE).
- **TEST_VERSION** on the certificates: "2" (a constant of the arena).

## The domain

The sites run on the Workers' own `workers.dev` addresses. The `ibiticoin.com` zone never moves, now
or later: its nameservers and records stay at the registrar as they are (the main site, the mail and
other projects run on them). No contract holds a site's address.

## Keys (once, before the deploy)

1. The admin wallet (deploys the arenas and schedules the seasons; it can be the owner's own wallet)
   and one judge wallet per ring, created offline and never used on any other chain.
2. Season 1's secret for each ring (`node pages/tools/make-secret.mjs <dir outside the repository>`);
   a new secret for every later season.
3. The judge keys and every season secret are kept offline, outside the repository, with a second
   copy the owner chooses.

## Deploy (at 0.05 gwei: the red ring about 0.0102 BNB, the Street Ring about 0.0005 BNB)

Measured 2026-11-24 on a local fork of BNB Smart Chain mainnet, with the real Agent ID registry: the
red ring with its pictures takes 203.75M gas (60 transactions), the Street Ring with its ranking only
9.36M gas (22 transactions). Each judge pays gas for every match it seals, draws, locks and scores:
about 1.09M gas a match (measured on the testnet), about 0.000055 BNB at 0.05 gwei, so 0.002 BNB lasts
about 36 matches.

1. Fund the deployer (the admin) and both judge wallets.
2. The red ring: `forge script script/Deploy.s.sol --rpc-url <BSC> --broadcast --slow` with
   `RANKING_ONLY=false` (on chain 56 the script refuses to run without it), `JUDGE` (the red ring's
   judge), `SECRET_COMMIT`, `SEASON_START` (optional: now), `SEASON_END=1797811140`,
   `COOLDOWN=86400`, `DRAW_EVERY=600`, `AGENT_ID_REGISTRY=0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`
   (the script refuses anything else on chain 56) and its own `OUT` file. It deploys the arena (with
   its calendar), the decoys, seals it, and schedules season 1.
   The Street Ring: the same with `RANKING_ONLY=true` and no `ART`, its own `JUDGE`, `SECRET_COMMIT`
   and `OUT` (ArenaRanking: the ranking and the close, no token, no pictures).
3. Verify every contract on BscScan (the arena, the calendar, the season contract, the art, the
   pictures, the decoys).
4. One env per ring in `pages/wrangler.jsonc`: `RPC_URL`, `CHAIN_ID` (56), `ARENA`, `SEASON_BOOK`,
   `SEASONS` (`{ "1": { "plan": 12, "certificate": "<address>" } }`: `plan` is the task set the season
   runs, `PLAN_VERSION` in pages/src/plan.js; `certificate` is the season contract), `DECOYS`,
   `DEPLOY_BLOCK`, `BLOCKS_PER_WEEK` (blocks in a week at the block time measured on mainnet; the
   testnet uses 1342500 for 0.45-second blocks), `ROUND_TIME` (60), `RING` and `RINGS` (the two
   Workers' addresses, `{ "red": "https://…", "green": "https://…" }`); the Street Ring also
   `DECK=workshop` and `CHALLENGES=open`. Worker secrets: `JUDGE_KEY` (that ring's judge) and `SECRET_1`. Then `wrangler deploy --env <name>`.
   Optional: `JUDGE_LOW_BALANCE` (wei, default 1500000000000000 = 0.0015 BNB): below it the judge logs a warning to top up its wallet.
5. The first real fight: the project's own agent, Agent ID name `ibitilabs.ai`, through Binance AI
   Pro.

## Verification on BscScan

Right after step 2, before anyone is invited, verify every address below (the deploy itself runs
without `--verify`, so that a contract that cannot be verified, such as a picture piece, never mixes
with the deploy). Addresses come from the ring's `OUT` file unless stated. `--slow` in step 2 sends each transaction
only after the one before it is mined.

| Contract | Source | Constructor arguments |
|---|---|---|
| The arena (`arena`) | `src/AgentArena.sol:AgentArena` | `(address,uint64,uint64,uint64)`: `AGENT_ID_REGISTRY`, `COOLDOWN`, `ROUND_TIME`, `DRAW_EVERY` |
| Its calendar (`seasonBook`, created by the arena's constructor) | `src/ArenaSeasons.sol:ArenaSeasons` | `(address)`: the admin (the deployer) |
| Red ring season (`certificate`) | `src/ArenaCertificate.sol:ArenaCertificate` | `(string,string,address,address,string,uint16)`: `"IBITI Agent Arena"`, `"ARENA"`, the arena, the art, `"2"`, the season number |
| Street Ring season (`certificate`) | `src/ArenaRanking.sol:ArenaRanking` | `(address,uint16)`: the arena, the season number |
| The art (`art`, red ring) | `src/ArenaArt.sol:ArenaArt` | `(address[][4])`: the picture pieces, from `cast call <ART> "piecesOf(uint8)(address[])" <0..3> --rpc-url <BSC>` |
| The 9 decoys of each ring (`decoys`) | `src/AgentArena.sol:ArenaDecoy` | `(address)`: the arena |

A later season's contract (`ScheduleSeason.s.sol`) is verified the same way, with its own season
number.

The picture pieces (`ArenaPicture`, every address `piecesOf` lists) are data, not code: each one's
code is the INVALID byte 0xFE followed by a piece of the picture, so there is no compiled code to
match and BscScan cannot verify them as source. Anyone can read them (`cast code <PIECE>`), and the
verified `ArenaArt` shows how they are put together.

**Compiler settings** (`foundry.toml`; forge reads them from there): solc `v0.8.24+commit.e11b9ed9`,
optimizer on with 50 runs, `via_ir` on, EVM version `cancun`. License: Apache-2.0.

**Constructor arguments** with `cast abi-encode`. For example, the arena with the values of step 2,
and the art:

```
cast abi-encode "f(address,uint64,uint64,uint64)" 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F 86400 60 600
cast abi-encode "f(address[][4])" "[[<gold pieces>],[<silver pieces>],[<bronze pieces>],[<graphite pieces>]]"
```

**With forge.** An Etherscan API V2 key in `ETHERSCAN_API_KEY`: one key serves every chain Etherscan
supports, and `--chain` picks the chain.

```
forge verify-contract <ADDRESS> src/AgentArena.sol:AgentArena --chain 56 --verifier etherscan \
  --constructor-args <cast abi-encode output> --watch
```

The API plan: a free key is enough. Checked 2026-11-24 with the project's free key on chain 56: the
contract endpoints answer (`getabi` returns an ABI; `verifysourcecode` gets past the plan check and
only complains that the address holds no code), while account and proxy endpoints answer "Free API
access is not supported for this chain". Verification uses only the contract endpoints. The key is
kept outside the repository. If forge ever answers with a plan error, use the website below.

**By hand** (the BscScan website, no API key):

1. `forge verify-contract <ADDRESS> <source:Contract> --show-standard-json-input > <Contract>.json`
   (run it in Git Bash, so the file is plain UTF-8).
2. On the contract's BscScan page: "Verify & Publish", compiler type "Solidity (Standard-Json-Input)",
   compiler `v0.8.24+commit.e11b9ed9`, license "Apache-2.0".
3. Upload `<Contract>.json`, paste the `cast abi-encode` output without its `0x` as the constructor
   arguments, and submit.

## A new season

1. `node pages/tools/make-secret.mjs <dir outside the repository>` for its secret, one per ring.
2. `forge script script/ScheduleSeason.s.sol --broadcast` (by the admin) with `ARENA`, `ART`,
   `JUDGE` (that ring's judge), `SECRET_COMMIT`, `SEASON_START`, `SEASON_END`. The Street Ring:
   `RANKING_ONLY=true` and no `ART` (never the red ring's art).
3. Add the season to `SEASONS` (its `plan` and `certificate`), upload `SECRET_<n>`,
   `wrangler deploy`.

## After a season

Publish its secret only after the last fight has ended and its blocks are final. Anyone can then
recompute every fight's right answers and traps and check the judge.

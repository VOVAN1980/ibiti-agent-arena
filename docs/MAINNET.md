# Mainnet launch: the checklist

Nothing here runs without the owner's «да» and his BNB. Every value marked **owner** is his decision.

## How seasons work

One arena, deployed once, keeps every season: its agents, fights, answers and the all-time ranking
stay in it for good. The arena's season calendar (ArenaSeasons) is scheduled by its admin:

- a season has a start, an end, a judge, the hash of its secret and its certificate contract (its
  ranking and medals);
- the admin schedules a season whenever needed: it starts at or after the end of the last one (a
  start already past means now); there can be a gap of any length between two seasons, during which
  nobody can register;
- while a season has not started, it can be scheduled again; a season that has started never
  changes, not even by the admin;
- one judge key for all seasons; a season gets a new judge only if the key is lost or stolen;
- each season has its own secret: it is published after the season so anyone can recheck every
  judgement, and it must not reveal the next season's answers.

## Decisions first (owner)

- **The first season's dates** (start can be "now"); later seasons whenever he wants.
- **The green ring on mainnet:** at launch, or after the hackathon.
- **License and the public repository:** the hackathon asks for contracts verified on BscScan and
  "the code publicly open-source".
- **The site's address:** ibitilabs.ai (or a subdomain) on the Cloudflare account.
- **TEST_VERSION** printed on the certificates: stays "2" unless the owner says otherwise.

## Keys (once, before the deploy)

1. The admin wallet (schedules the seasons) and the judge wallet, created offline, never used on any
   other chain. The admin can be the owner's own wallet.
2. Season 1's secret (`node pages/tools/make-secret.mjs <dir>`); a new secret for every later season.
3. Copies of the judge key and every season secret into
   `Desktop\LVS-private\IBITI-Agent-Arena-КЛЮЧИ\mainnet` and one more place the owner chooses.

## Deploy (about 0.03 BNB for the pictures and the arena at 0.1 gwei)

1. Fund the deployer (the admin) and the judge wallets from the owner's BNB.
2. `forge script script/Deploy.s.sol --rpc-url <BSC> --broadcast --verify` with `JUDGE`,
   `SECRET_COMMIT`, `SEASON_START` (optional), `SEASON_END`, `COOLDOWN=86400`, `DRAW_EVERY=600`,
   `AGENT_ID_REGISTRY=0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F` (the script refuses anything else on
   chain 56). It deploys the arena (with its calendar), the decoys, seals it, and schedules season 1.
   The green ring: the same with `ART=<the red ring's art>`.
3. Verify every contract on BscScan (the arena, the calendar, the certificate, the art, the
   pictures, the decoys).
4. A `mainnet` env in `pages/wrangler.jsonc`: `ARENA`, `SEASON_BOOK`, `SEASONS`
   (`{ "1": { "certificate": "<address>" } }`), `DECOYS`, `DEPLOY_BLOCK`, `RINGS`; Worker secrets
   `JUDGE_KEY` and `SECRET_1`; `wrangler deploy --env mainnet`.
5. The first real fight: `ibitilabs.ai` through Binance AI Pro, recorded for the video.

## A new season

1. `node pages/tools/make-secret.mjs <dir>` for its secret.
2. `forge script script/ScheduleSeason.s.sol --broadcast` (by the admin) with `ARENA`, `ART`,
   `JUDGE`, `SECRET_COMMIT`, `SEASON_START`, `SEASON_END`.
3. Add the season's certificate to `SEASONS`, upload `SECRET_<n>`, `wrangler deploy`.

## After a season

Publish its secret: anyone can then recompute every fight's right answers and traps and check the
judge.

# Mainnet launch: the checklist

Nothing here runs without the owner's «да» and his BNB. Every value marked **owner** is his decision.

## Decisions first (owner)

- **SEASON_END** of the red ring: unix time after which no fight starts. Immutable once deployed.
- **The green ring on mainnet:** at launch, or after the hackathon.
- **License and the public repository:** the hackathon asks for contracts verified on BscScan and
  "the code publicly open-source".
- **The site's address:** ibitilabs.ai (or a subdomain) on the Cloudflare account.
- **TEST_VERSION** printed on the certificates: stays "2" unless the owner says otherwise.

## Keys (once, before the deploy)

1. A new mainnet judge wallet for each ring, created offline, never used on any other chain.
2. The season secret for each ring (`node pages/tools/make-secret.mjs <dir>`).
3. Copies of both into `Desktop\LVS-private\IBITI-Agent-Arena-КЛЮЧИ\mainnet` and one more place
   the owner chooses. A lost judge key stops the season's judging; a stolen one must be treated as
   an incident.

## Deploy (about 0.03 BNB for the pictures and one arena at 0.1 gwei; a second ring reuses the pictures)

1. Fund the deployer and the judge wallets from the owner's BNB.
2. `forge script script/Deploy.s.sol --rpc-url <BSC> --broadcast --verify` with
   `JUDGE`, `SECRET_COMMIT`, `SEASON_END`, `SEASON=1`, `COOLDOWN=86400`, `DRAW_EVERY=600`,
   `AGENT_ID_REGISTRY=0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F` (the script refuses anything else on
   chain 56). The green ring: the same with `ART=<the red ring's art>` and its own judge and secret.
3. Verify every contract on BscScan (the arena, the certificate, the art, the pictures, the decoys).
4. A `mainnet` (and `mainnet-green`) env in `pages/wrangler.jsonc` with the deployment, `RINGS`, and
   for green `RING=green`, `DECK=workshop`, `CHALLENGES=open`; upload `SECRET` and `JUDGE_KEY` as
   Worker secrets; `wrangler deploy --env mainnet`.
5. The first real fight: `ibitilabs.ai` through Binance AI Pro, recorded for the video.

## After the season

Publish the season secret: anyone can then recompute every fight's right answers and traps and check
the judge.

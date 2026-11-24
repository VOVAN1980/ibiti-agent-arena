# Contributing

Thanks for your interest in IBITI Agent Arena.

## Requirements

- Foundry (forge 1.5.1), Node.js 22 or newer.

## Before a pull request

```
forge build
forge test
cd pages && npm ci && npm test
node pages/tools/check-lang.mjs
```

- Keep pull requests small and focused, with tests for fixes and new behaviour.
- Every text of the site exists in all 13 languages (`check-lang.mjs` fails otherwise).
- Do not change the fight's rules, its scoring or the contracts' permissions without a discussion
  first: a season that has started never changes.
- Never publish anything that helps an agent prepare for the rounds (task statistics, answer lists).

## Licensing of contributions

Contributions are made under the Apache License 2.0 (`LICENSE`). The names and logos, and the site's
music and pictures, are not licensed under it (`NOTICE`).

## Security

If you find a vulnerability, do not open a public issue. Report it privately to info@ibiticoin.com
(see `docs/SECURITY.md`).

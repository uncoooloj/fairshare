# Contributing

Keep changes small, readable, and scoped to the behavior being changed. Follow the established TypeScript and React patterns before adding abstractions.

Format changed files with Prettier when practical:

```sh
/private/tmp/fairshare-readability-tools/node_modules/.bin/prettier --write <changed-files>
```

Run the smallest relevant check, then run repository checks when the change crosses packages or shared behavior:

```sh
npm test
npm run typecheck
npm run build
```

Do not treat a passing build as proof of provider, browser, or deployment behavior. Preserve the repository's safety boundaries: use synthetic data for demos, keep credentials server-side, do not enable live money, and reconcile uncertain provider writes before retrying.

For documentation, distinguish implemented behavior from planned work and historical verification from current evidence. Do not add secrets, personal data, raw agreements, invitation tokens, or provider payloads to the repository.

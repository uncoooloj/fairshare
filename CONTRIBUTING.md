# Contributing

Keep changes small, readable, and scoped to the behavior being changed. Follow the established TypeScript and React patterns before adding abstractions.

Use descriptive names at API and persistence boundaries. Prefer explicit branches to nested ternaries. When extracting helpers, keep authorization checks, transaction boundaries, and provider-call order easy to follow.

Format changed files with Prettier when practical:

```sh
npm run format
```

Run the smallest relevant check, then run repository checks when the change crosses packages or shared behavior:

```sh
npm run format:check
npm test
npm run typecheck
npm run build
```

Do not treat a passing build as proof of provider, browser, or deployment behavior. Preserve the repository's safety boundaries: use synthetic data for demos, keep credentials server-side, do not enable live money, and reconcile uncertain provider writes before retrying.

For documentation, distinguish implemented behavior from planned work and historical verification from current evidence. Do not add secrets, personal data, raw agreements, invitation tokens, or provider payloads to the repository.

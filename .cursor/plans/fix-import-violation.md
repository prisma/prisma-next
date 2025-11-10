# Plan — Fix Import Violation

- Run `pnpm lint:deps` to locate violations
- Check `architecture.config.json` for allowed directions
- Refactor: move code inward or extract interfaces
- Remove temporary exceptions in `scripts/check-imports.mjs`
- Re‑run lint and tests


# Brief: D8 docs-and-close-out-prep

## Task

Land the documentation and close-out surface **such that** a future extension author or adapter consumer learns everything this project discovered without reading the project folder (which dies at close-out):

1. **Package README** (`packages/3-extensions/better-auth/README.md`): what the extension is, the three subpath surfaces + `/runtime` descriptor, the three-step schema flow, the adapter's config posture (`supportsNumericIds: false`, insensitive-mode rejection), and — front and center — the **two-views consumer architecture** (aggregate does not fold pack domain models; pack models are cross-space references only; `db.orm.public.User` doesn't exist on the aggregate client; cross-space relations typed `never`; hence aggregate `db` + space-view `authDb` with `verifyMarker: false` and why). Link the example.
2. **ADR 212 amendment** (operator decision E1(b)): amend `docs/architecture docs/adrs/ADR 212 - Contract spaces.md` per the repo's ADR-amendment conventions (grep how existing ADRs record amendments — status note/addendum section, not a rewrite): the `src/contract/` PSL-authored layout is legitimate (supabase precedent + `regen-extension-migrations.mjs` dual-layout support become the documented rule); note the managed-space (table-DDL-shipping) variant this package introduced.
3. **New ADR** for the "stringly-typed third-party interface over contract-typed collections" adapter pattern (typed model map exhaustive against the space contract, codec-boundary crossing, fail-fast typed errors, native capability mapping incl. atomic consume + tx rebinding + include-backed joins, two-views consumption). Draft it in `docs/architecture docs/adrs/` at the next free ADR number (check the directory; flag the number for operator confirmation at review). Status: Accepted, dated today, referencing the package as the worked example.
4. **Extension-authoring doc references**: update the docs that catalogue extension precedents (grep for where supabase/pgvector are named as reference extensions — e.g. subsystem docs, onboarding, extension-authoring skill under `skills-contrib/` if it names precedent packages) to name `better-auth` as the managed-space (DDL-shipping) precedent. Follow the doc-maintenance rule; edit skills at their canonical `skills-contrib/` path if applicable.
5. **Grep gate (AC-4):** `rg 'projects/extension-better-auth'` over long-lived files (everything outside `projects/` and `wip/`) returns zero hits.

## Scope

**In:** the files above; nothing else. **Out:** code changes of any kind (docs/comments only); other ADRs; the example (done); `projects/**` content (the orchestrator owns close-out of that folder).

## Completed when

- [ ] README + ADR-212 amendment + new ADR + precedent-reference updates exist and agree with the shipped code (F12: claims verified against the artifacts, not the project spec — e.g. re-verify export names, config values, error codes by reading the source).
- [ ] AC-4 grep gate clean.
- [ ] Gates: `pnpm lint` for touched packages/docs where applicable; workspace `pnpm typecheck` (should be a no-op for docs — run once to confirm nothing broke); `pnpm lint:skills` if a skill file was touched.

## References

(Resumed — new context only.)

- Slice plan § D8 (E1(b) + D7 carry-over); `learnings.md` (the aggregate-no-folding entry, stale-dist inversion — mine anything docs-worthy); F23 (close-out docs must use as-built names, not spec-era sketches — write from the code); F12 (docs sweeps are exhaustive, not spot-fixes).
- ADR conventions: read 2–3 recent ADRs in `docs/architecture docs/adrs/` for the house format.

## Operational metadata

- **Model tier:** mid (voice-aware doc work with explicit insertion points).
- **Time-box:** 75 min. Halt: any doc claim you cannot verify against shipped code; ADR-number collision ambiguity.
- **Progress notes:** heartbeats at phase transitions.

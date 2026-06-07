# Project learnings — enums-as-domain-concept

Working ledger of patterns surfaced this run. Reviewed at close-out; cross-cutting lessons migrate to durable docs, the rest drops with the project.

- **The merge-blocking cast check is `pnpm lint:casts`, not `pnpm lint`.** `pnpm lint` flags bare `as` casts at **info** level (stays green); the CI lint job runs `pnpm lint:casts`, a ratchet on net-new bare casts vs the merge-base, which **exits 1 on any positive delta**. A dispatch that adds bare casts can pass `lint` and still fail CI. **Dispatch validation gates must include `pnpm lint:casts`** (and reviewers should run it, not trust `lint`). Surfaced when D3's `enum-type.ts` casts (+5) plus D2's `build-sql-namespace.ts:61` (+1) pushed the ratchet to `delta +6`. → Candidate for `drive/calibration/` (gate vocabulary) at close-out.

- **`pnpm build` → `pnpm i` is required before `fixtures:check` runs end-to-end.** The example apps invoke the built, repo-local `prisma-next` CLI, which only lands on `PATH` after a post-build `pnpm i`. A bare `pnpm fixtures:check` fails at the emit step looking environmental; it isn't. → Candidate for `drive/calibration/` gate notes at close-out.

- **Stale `dist` produces phantom test failures.** `framework-components`' compiled `elementCoordinates` lagged a merged source refactor (`Object.entries(ns)` → `ns.entries`), so `element-coordinates.test.ts` failed until a force-build. Verify "pre-existing failure" claims with a fresh build before accepting them.

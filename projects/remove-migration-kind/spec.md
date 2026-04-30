# Tighten the migration manifest: drop `kind`, agree on `from` nullability

- **Linear**: [TML-2270](https://linear.app/prisma-company/issue/TML-2270/remove-kind-regular-or-baseline-from-migration-manifest-origin)
- **Branch**: `tml-2270-remove-kind-regular-baseline-from-migration-manifest-origin`
- **Status**: Shaping

## Intent

Two coupled cleanups to the migration manifest, landing in one PR because they share a hash-regeneration sweep:

1. **Drop `kind: 'regular' | 'baseline'`** from every level of the migration manifest surface (the original TML-2270 ask). Baseline-ness is structurally encoded by the migration's origin presence; a separate `kind` discriminator duplicates that signal, makes invalid combinations representable (`{ from: '', kind: 'regular' }`, `{ from: 'sha:abc', kind: 'baseline' }`), and invites planner/runner code to branch on `kind` instead of on origin presence. No production code currently branches on `kind` — it's plumbed through but unread — so this is a targeted cleanup before anything downstream couples to it.

2. **Make `describe()`'s `from` agree with `Migration.origin` on nullability.** A `Migration` subclass exposes both `describe(): { from, to }` and getters `origin: { storageHash } | null` / `destination: { storageHash }` (because `Migration` implements `MigrationPlan`). Today `origin` is properly nullable but `describe().from` is a required `string`, and the mismatch is papered over by a sentinel-string convention — two flavours of it, in fact: `from: ''` (the in-process branch in `Migration.origin`'s getter) and `from: 'sha256:empty'` (the on-disk encoding written by scaffolders, dispatched in `executeMigrationApply`). The two `describe()` fields and their corresponding `MigrationPlan` getters should agree on which values are permitted: `to`/`destination` is required (both stay non-nullable); `from`/`origin` is optional (both become nullable). Concretely: flip `from` to `string | null`, persist `null` on disk for baselines, and drop the sentinel-string equality checks. `EMPTY_CONTRACT_HASH` survives as a runtime convenience for the live-marker layer (where "no marker present" is still a real distinct case from "manifest declares no origin"), but no manifest carries it.

The renaming question (`from`/`to` vs `origin`/`destination` as a unified vocabulary) is **explicitly out of scope** for this work. We're fixing the nullability mismatch, not consolidating the naming.

## Why now

- TML-2270 surfaced during review of [TML-2219 branch B](https://linear.app/prisma-company/issue/TML-2219) (PR #354) but is independent.
- We are pre-1.0; there are no external users carrying old manifests, so we can do a strict schema change in lockstep with fixture updates instead of a multi-release deprecation.
- Both changes invalidate every existing `migrationHash` (because `kind` and `from` both feed `computeMigrationHash`'s `strippedMeta`). Doing them together is one regen sweep over ~98 on-disk `migration.json` files instead of two.
- The migration system has just gone through a series of identity-related changes (ADR 192 — `ops.json` is the migration contract; ADR 199 — storage-only migration identity). Tightening the manifest schema while that area is fresh keeps the model coherent.

## Scope

### In scope

#### Drop `kind`

1. Drop `kind?` from `MigrationMeta` (the return type of `Migration.describe()`) in `packages/1-framework/3-tooling/migration/src/migration-base.ts`, and from its arktype validator (`MigrationMetaSchema`).
2. Drop `kind` from `MigrationMetadata` in `packages/1-framework/3-tooling/migration/src/metadata.ts` and from `MigrationMetadataSchema` in `packages/1-framework/3-tooling/migration/src/io.ts`.
3. Stop synthesizing `kind` in `buildAttestedMetadata` (`migration-base.ts`), in `migration-new.ts`, and in `migration-plan.ts`. Stop emitting `kind` from the Mongo TypeScript renderer (`packages/3-mongo-target/1-mongo-target/src/core/render-typescript.ts`) and stop threading it through `planner-produced-migration.ts`.
4. Drop `kind` from `MigrationShowResult` in `migration-show.ts` and from the human-readable formatter (`packages/1-framework/3-tooling/cli/src/utils/formatters/migrations.ts`).

#### Agree on `from` nullability

5. Flip `MigrationMeta.from` from `string` to `string | null`. Update its arktype validator. The author-facing rule is "`null` if this migration has no prior state (baseline), otherwise the storage hash of the prior state."
6. Flip `MigrationMetadata.from` from `string` to `string | null`. Update `MigrationMetadataSchema` accordingly. The on-disk JSON shape becomes `"from": null` for baselines, `"from": "sha256:..."` otherwise.
7. Simplify `Migration.origin`'s getter to `from === null ? null : { storageHash: from }`. The "empty string is sentinel" branch and its accompanying comment go away.
8. Simplify `executeMigrationApply`'s translation to `migration.from === null ? null : { storageHash: migration.from }`. The `EMPTY_CONTRACT_HASH` import in this file goes away.
9. Update scaffolders (`migration-new.ts`, `migration-plan.ts`) so that, when no prior state exists, they write `from: null` to the manifest instead of `from: EMPTY_CONTRACT_HASH`.
10. Update Mongo `render-typescript.ts` so `describe()`'s rendered `from` literal correctly stringifies as `null` when origin is absent (today there is no baseline path through this renderer, but the type change forces the conditional).
11. `EMPTY_CONTRACT_HASH` stays defined and exported, but its callers in `migration-status.ts` (`markerHash ?? EMPTY_CONTRACT_HASH`) and `migration-apply.ts` (the live-marker comparison, not the manifest comparison) are unaffected — those describe the *live database marker*, where "no marker row" is genuinely a different case from "manifest declares no origin" and a sentinel is a fine encoding for the in-memory comparison. We do not propagate the manifest's `null` into the marker layer.

#### Hash regeneration

12. Both changes alter the input to `computeMigrationHash` (`kind` was stripped into the hash; `from` is too). Every existing on-disk `migration.json` therefore needs `kind` removed, `from: "sha256:empty"` rewritten to `null`, and `migrationHash` recomputed. Affected directories:
    - `examples/prisma-next-demo/migrations/**` (3 packages)
    - `examples/mongo-demo/migrations/**` (2 packages)
    - `examples/retail-store/migrations/**` (3 packages)
    - `examples/prisma-next-demo/migration-fixtures/**` (~90 packages — currently orphan but updated for safety; see "Open question — fixtures" below)
13. Hand-authored `migration.ts` files in `examples/**` whose `describe()` returns `from: 'sha256:empty'` for a baseline are updated to `from: null` (TypeScript will fail to compile otherwise once `MigrationMeta.from: string | null` lands).

#### Tests

14. Update assertions in
    - `packages/1-framework/3-tooling/migration/test/migration-base.test.ts`
    - `packages/1-framework/3-tooling/migration/test/io.test.ts` (delete the "errors when kind has invalid value" case; add a "rejects manifest carrying kind" case; add a case that reads `"from": null` correctly and a case that rejects e.g. `"from": ""` once strings without `sha256:` prefix are no longer special-cased — or keep the schema permissive on the `from` string format, scope-dependent, see "Open question — `from` string format" below)
    - `packages/1-framework/3-tooling/migration/test/hash.test.ts`
    - `packages/1-framework/3-tooling/migration/test/fixtures.ts`
    - `packages/1-framework/3-tooling/cli/test/commands/{migration-plan,migration-apply,migration-show,migration-ref,migration-e2e,migration-tamper}.test.ts`
    - `packages/1-framework/3-tooling/cli/test/migration-cli.test.ts`
    - `examples/{mongo-demo,retail-store}/test/manual-migration.test.ts`
    Where tests assert `manifest.kind === 'regular'`, replace with `manifest.from === null` ⇒ baseline / `manifest.from !== null` ⇒ non-baseline.

#### Architecture docs

15. `docs/architecture docs/subsystems/7. Migration System.md` § "Storage-only identity" lists `kind` in `strippedManifest` — drop that mention. The same section talks about `from`/`to` storage hashes; clarify that `from` is `string | null`.
16. `docs/architecture docs/adrs/ADR 199 - Storage-only migration identity.md` lists `kind` in `strippedMeta` — drop that mention. Add a "Revised: <date> — `kind` removed; `from` is now nullable (TML-2270)" note at the top.

### Out of scope

- **Renaming.** `from`/`to` vs `origin`/`destination` as a unified vocabulary across the manifest, the class getters, and the runner is explicitly deferred. We're fixing the nullability mismatch only.
- **Centralizing contract storage.** `fromContract`/`toContract` denormalization within each manifest stays as-is. The eventual move to "central contract store, looked up by hash" is its own work.
- **`EMPTY_CONTRACT_HASH` at the marker layer.** The constant continues to exist and continues to be used by `migration-status.ts` and `migration-apply.ts` for live-marker comparisons. The manifest layer just doesn't carry it anymore.
- **Adding any replacement label or discriminator for baseline-ness.** Baseline-ness is encoded by `from === null` (equivalently `origin === null`); no separate field is added. If a future surface needs a human-readable hint, `labels` already exists.
- **Compatibility code path for old manifests carrying `kind` or `"from": "sha256:empty"`.** Pre-1.0; we drop both cleanly. Old manifests on disk fail to parse with `MIGRATION.INVALID_MANIFEST` — the same diagnostic any other unknown/wrong-typed field produces — and the fix is to regenerate via `prisma-next migration plan` or by running the regeneration script that ships with this PR.

## Acceptance criteria

1. `kind` no longer appears in any source file under `packages/1-framework/3-tooling/migration/src/**`, `packages/1-framework/3-tooling/cli/src/**`, or `packages/3-mongo-target/1-mongo-target/src/**`. (Search `rg '\bkind\b' --type=ts` against those trees and review every remaining hit; only unrelated `kind` discriminants — e.g. component manifests `{ kind: 'adapter' }` — remain.)
2. `kind` no longer appears in any `migration.json` under `examples/**`.
3. No `migration.json` under `examples/**` contains `"from": "sha256:empty"` or `"from": ""`. Baselines are encoded as `"from": null`.
4. `MigrationMeta.from`, `MigrationMetadata.from`, and `MigrationMetadataSchema`'s `from` field are typed `string | null`. `Migration.origin`'s getter is a one-line `null`-check on `from`. `executeMigrationApply`'s translation is a one-line `null`-check on `migration.from`. Neither references `EMPTY_CONTRACT_HASH`.
5. The arktype `MigrationMetadataSchema` rejects manifests that still carry a `kind` field (covered by an explicit test) and rejects `"from": ""` (the empty-string sentinel is gone — covered by an explicit test if convenient; otherwise just by the type system).
6. `pnpm build`, `pnpm typecheck`, `pnpm test:packages`, and the example test suites that exercise on-disk packages pass.
7. `pnpm lint:deps` passes.
8. Architecture docs referencing `kind` in `strippedManifest`/`strippedMeta` are updated; ADR 199's revision note is present.
9. Every on-disk `migration.json` round-trips through `readMigrationPackage` cleanly (the loader's stored-vs-computed `migrationHash` check passes for all of them).

## Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| Regenerating `migrationHash` across ~98 fixture files by hand is error-prone. | One-shot regeneration script under `wip/` that strips `kind`, rewrites `"from": "sha256:empty"` → `null`, and recomputes `migrationHash` via `computeMigrationHash`. Run it, commit the result, delete the script in the same PR. |
| `EMPTY_CONTRACT_HASH` is referenced in places I haven't surveyed and removing it from manifests breaks one of them. | The constant is staying defined; only the manifest scaffolders + `executeMigrationApply`'s manifest comparison change. Live-marker comparisons (`migration-status.ts`, the `markerHash ?? EMPTY_CONTRACT_HASH` defaulting, the `marker?.storageHash === EMPTY_CONTRACT_HASH` defensive check in `migration-apply.ts`) are out of scope and untouched. |
| Old manifests on disk in user repos break when they upgrade. | Pre-1.0; no external users yet. The error message they'd hit is `MIGRATION.INVALID_MANIFEST` with a clear `arktype` summary pointing at the offending field. Document in the PR body. |
| ADR 199 is amended without an ADR superseding it. | The change is a textual correction (it lists `kind` as a strippedMeta member; we remove that mention and update the `from` typing in prose). The decision recorded in ADR 199 — that identity is storage-only — is unchanged, so an inline edit with a "Revised: …" note is sufficient. No new ADR is warranted. |

## Open question — fixtures

`examples/prisma-next-demo/migration-fixtures/**` contains ~90 migration packages. Searched the repo for any reference (TS/JS/JSON/MD) and could not find a consumer in code. They appear to be reference data that was wired up at some point and orphaned during a refactor. **Decision (per design discussion): update them anyway.** Bigger diff but conservative — the regen script makes it cheap, and they stay round-trippable for whatever future tooling picks them up.

## Open question — `from` string format

`MigrationMetadataSchema` today does not constrain the format of `from` beyond "string". After this change, the type becomes `string | null`. We could go further and require non-null `from` to start with `sha256:` (matching how every real value is shaped today), which would make the `"from": ""` accident impossible. Recommendation: **don't tighten format in this PR.** It's a separate, mechanical question and the Linear ticket is already broader than its original ask. Track as a follow-up if useful.

## References

- [ADR 199 — Storage-only migration identity](../../docs/architecture%20docs/adrs/ADR%20199%20-%20Storage-only%20migration%20identity.md)
- [ADR 192 — `ops.json` is the migration contract](../../docs/architecture%20docs/adrs/ADR%20192%20-%20ops.json%20is%20the%20migration%20contract.md)
- [Migration System subsystem](../../docs/architecture%20docs/subsystems/7.%20Migration%20System.md)
- [`packages/1-framework/3-tooling/migration/src/migration-base.ts`](../../packages/1-framework/3-tooling/migration/src/migration-base.ts) — `MigrationMeta`, `Migration` class, `Migration.origin` translation getter
- [`packages/1-framework/3-tooling/migration/src/metadata.ts`](../../packages/1-framework/3-tooling/migration/src/metadata.ts) — `MigrationMetadata`
- [`packages/1-framework/3-tooling/migration/src/io.ts`](../../packages/1-framework/3-tooling/migration/src/io.ts) — `MigrationMetadataSchema`
- [`packages/1-framework/3-tooling/migration/src/hash.ts`](../../packages/1-framework/3-tooling/migration/src/hash.ts) — `computeMigrationHash`, the canonical hash function the regen script reuses
- [`packages/1-framework/3-tooling/cli/src/control-api/operations/migration-apply.ts`](../../packages/1-framework/3-tooling/cli/src/control-api/operations/migration-apply.ts) — manifest-`from` to runner-`origin` translation
- [`packages/1-framework/1-core/framework-components/src/control-migration-types.ts`](../../packages/1-framework/1-core/framework-components/src/control-migration-types.ts) — `MigrationPlan.origin` (the canonical nullable shape we're aligning with)

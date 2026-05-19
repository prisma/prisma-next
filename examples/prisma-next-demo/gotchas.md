# Gotchas — `prisma-next-demo`

A running log of surprises, workarounds, and undocumented behaviour hit while
using **Prisma Next** in this demo. Each entry is mirrored as a Triage-state
ticket in the [`[PN] Gotchas`](https://linear.app/prisma-company/project/pn-gotchas-a6f6f5157a5c/overview)
Linear project.

---

## Contents

- [`db init` fails with PN-MIG-5001 `declaredButUnmigrated` for extension spaces unless `migration plan` is run first](#db-init-fails-with-pn-mig-5001-declaredbutunmigrated-for-extension-spaces-unless-migration-plan-is-run-first)
- [`migration status` reports `status: "never-planned"` after `db init` even when `markerHash === headHash`](#migration-status-reports-status-never-planned-after-db-init-even-when-markerhash--headhash)
- [`migration show` (no argument) silently means `migration heads`](#migration-show-no-argument-silently-means-migration-heads)
- [Loaded predecessor contract snapshots are not verified against their persisted `storageHash` at load time](#loaded-predecessor-contract-snapshots-are-not-verified-against-their-persisted-storagehash-at-load-time)

---

## `db init` fails with PN-MIG-5001 `declaredButUnmigrated` for extension spaces unless `migration plan` is run first

**Filed upstream:** [TML-2495](https://linear.app/prisma-company/issue/TML-2495) — *"`db init` fails with PN-MIG-5001 `declaredButUnmigrated` for extension spaces unless `migration plan` is run first; remediation points at non-existent `prisma-next migrate` command"* — originally filed against `prisma-next-postgis-demo`; same bug class reproduces here against `pgvector`.
**Product:** Prisma Next
**Version:** workspace HEAD (branch `tml-2536-contract-deserializer-seam-v2`, PR #533)
**First hit:** TML-2536 manual-QA pass against this demo
**Cost:** ~5 minutes to diagnose (the envelope's `fix` text points at the wrong command)

**Symptom.** On a freshly-dropped DB whose `extensionPacks` declares `pgvector`, `db init` fails:

```
PN-MIG-5001 — Contract-space layout violation
  [declaredButUnmigrated] pgvector
    Extension 'pgvector' is declared in extensionPacks but has not been emitted; run `prisma-next migrate`.
```

There is no `prisma-next migrate` subcommand that would unblock this — `migrate` *also* fails the same layout check. The actual unblocker is `migration plan`, which side-emits `migrations/pgvector/<seed>/` as a setup artefact.

**Cause.** The per-space verifier in `packages/1-framework/3-tooling/migration/src/verify-contract-spaces.ts` requires every space in `extensionPacks` to have a matching `<projectRoot>/migrations/<space-id>/` directory before `db init` will run. That directory is materialised by `prisma-next migration plan`, which copies the extension's baseline migration out of its descriptor. The verifier's remediation string names the wrong command (`prisma-next migrate`).

**Workaround.** Insert the plan step between `emit` and `db init`:

```bash
pnpm emit
pnpm exec prisma-next migration plan
pnpm exec prisma-next db init
```

Revert criterion: drop the manual step once either (a) `db init` auto-materialises extension seed directories itself, or (b) the verifier's remediation names the real command and the demo's `package.json` exposes a `db:plan` script.

**Reproduction.**
1. `pnpm db:drop && pnpm emit`
2. `pnpm exec prisma-next db init` — fails with `PN-MIG-5001`.
3. Re-run after `pnpm exec prisma-next migration plan` — succeeds.

---

## `migration status` reports `status: "never-planned"` after `db init` even when `markerHash === headHash`

**Filed upstream:** [TML-2564](https://linear.app/prisma-company/issue/TML-2564) — *"`migration status` reports `status: \"never-planned\"` after `db init` even when `markerHash === headHash` (DB is in-sync)"*
**Product:** Prisma Next
**Version:** workspace HEAD (branch `tml-2536-contract-deserializer-seam-v2`, PR #533)
**First hit:** TML-2536 manual-QA pass (Scenario 1 + Scenario 3 oracles)
**Cost:** ~10 minutes to confirm the DB really was in-sync despite the misleading status string

**Symptom.** After `prisma-next db init` against a freshly-dropped DB whose `extensionPacks` is materialised, `migration status` reports the app space as `status: "never-planned"` even though the marker hash matches the migration-graph head hash:

```json
{
  "spaces": [
    { "spaceId": "pgvector", "kind": "extension",
      "headHash": "sha256:401e16b3…", "markerHash": "sha256:401e16b3…",
      "pendingCount": 0, "status": "up-to-date" },
    { "spaceId": "app", "kind": "app",
      "headHash": "sha256:f7a8eb51…", "markerHash": "sha256:f7a8eb51…",
      "status": "never-planned", "pendingCount": 0 }
  ]
}
```

The extension space correctly reports `up-to-date` for the same `markerHash === headHash` condition; the app space reports `never-planned` because no `migration plan` history was recorded (the DB was populated directly from the live contract).

**Cause.** `db init` is contract-driven; `migration apply` / `migrate` is history-driven. The status taxonomy categorises spaces by *how the marker was set* rather than *whether the marker is in-sync with the head*. The natural reading of `never-planned` ("we haven't migrated yet — pending changes await") is wrong; the actual semantics are "the marker was set by a non-history path".

**Workaround.** Treat `status: "never-planned"` as in-sync iff `markerHash === headHash && pendingCount === 0`. Diagnostic-quality follow-up only; no functional impact.

**Reproduction.**
1. `pnpm db:drop && pnpm emit`
2. `pnpm exec prisma-next migration plan` (to materialise the pgvector seed dir — see TML-2495 entry above)
3. `pnpm exec prisma-next db init`
4. `pnpm exec prisma-next migration status --json`
5. Observe app-space `status: "never-planned"` despite `markerHash === headHash`.

---

## `migration show` (no argument) silently means `migration heads`

**Filed upstream:** [TML-2565](https://linear.app/prisma-company/issue/TML-2565) — *"`migration show` (no argument) silently means `migration heads`: same verb, two unrelated behaviours toggled on argument presence"*
**Product:** Prisma Next
**Version:** workspace HEAD (branch `tml-2536-contract-deserializer-seam-v2`, PR #533)
**First hit:** TML-2536 manual-QA pass (Scenario 4 step 4 picked `migration show <name>` as a second-data-point for the strict deserializer; while investigating, discovered the targetless behaviour is something completely different)
**Cost:** ~15 minutes — the verb name gives no hint that omitting the argument changes the question being asked

**Symptom.** Same verb, two completely unrelated behaviours, toggled on whether an argument was passed:

- `migration show <migration-name-or-ref>` — reads `migration.json` + `ops.json` for the named migration package and prints its operations + preview. Does **not** read or validate any contract snapshot.
- `migration show` (no argument) — reads `src/prisma/contract.json`, runs `buildContractSpaceAggregate` (layout-integrity-checked), and enumerates the **latest leaf migration per space (app + all extensions)**. Effectively `migration heads` or `migration latest`.

**Cause.** The `show` verb evolved to overload two intents in one command without an obvious-from-the-verb-name way to express them separately. The source itself acknowledges the divergence (see the comment block at lines 280–296 of `packages/1-framework/3-tooling/cli/src/commands/migration-show.ts`), but the verb name papers over it.

**Workaround.** None needed — both behaviours work today. Pure UX/cognitive-load concern.

**Reproduction.**
1. `pnpm exec prisma-next migration show 20260518T1701_namespaces_bookend --json` — returns operations + preview for the named migration.
2. `pnpm exec prisma-next migration show --json` — returns per-space leaf-migration enumeration (a completely different shape and concern).

Revert criterion: drop this entry once the two behaviours live under distinct verbs (e.g. `migration show <name>` for the targeted inspect, `migration heads` / `migration list --leaves` for the per-space enumeration).

---

## Loaded predecessor contract snapshots are not verified against their persisted `storageHash` at load time

**Filed upstream:** [TML-2566](https://linear.app/prisma-company/issue/TML-2566) — *"Loaded predecessor contract snapshots are not verified against their persisted `storageHash` at load time; semantically-inconsistent `end-contract.json` silently passes `migration plan`"*
**Product:** Prisma Next
**Version:** workspace HEAD (branch `tml-2536-contract-deserializer-seam-v2`, PR #533)
**First hit:** TML-2536 manual-QA pass (Scenario 9 exploratory probes 2 + 4)
**Cost:** would be high if hit in the wild — silent acceptance of corrupted snapshots can cascade into wrong-but-clean migration plans

**Symptom.** Hand-edits to a head migration's `end-contract.json` that change the snapshot's **content** without touching its persisted `storage.storageHash` field pass `migration plan` silently as a no-op:

- **Probe 2:** delete `storage.types` entirely → `migration plan` reports `ok: true, noOp: true`.
- **Probe 4:** rename a stored type (`Embedding1536` → `XYZ`) → `migration plan` reports `ok: true, noOp: true`.

In both cases the file on disk no longer describes the storage shape its persisted `storageHash` claims it does. No diagnostic, no warning, no exit-code signal.

**Cause.** TML-2536 made `migration plan` *load* the predecessor `end-contract.json` through the strict deserializer (`familyInstance.validateContract`). The load happens; the post-load hash-recomputation-and-compare step does not. The planner's diff detection uses the `from` / `to` hashes recorded in `migration.json` rather than recomputing them from the freshly-deserialized snapshot. So a snapshot whose **content** disagrees with its **persisted hash** is invisible to the planner.

`migration check`'s structural integrity checks (`PN-MIG-CHECK-001`, `PN-MIG-CHECK-005`) compare strings only — they never recompute the storage hash from the deserialized content. Per ADR 199 ("Storage-only migration identity"), the full contract IRs are explicitly excluded from `migrationHash`.

**Expected behaviour.** When the contract is loaded from disk, it's checked against its hashes. If it's not loaded, it has no effect.

**Workaround.** None today. If you hand-edit a snapshot, also re-emit the migration package (`migration plan` / `migration new`) so the persisted hashes regenerate.

**Reproduction.**
1. `pnpm exec prisma-next migration plan` once to reach a clean no-op baseline.
2. `python3 -c "import json; p='migrations/app/20260518T1701_namespaces_bookend/end-contract.json'; d=json.load(open(p)); del d['storage']['types']; open(p,'w').write(json.dumps(d, indent=2))"`
3. `pnpm exec prisma-next migration plan --json` — observe `ok: true, noOp: true`. Expected: a structured error envelope naming the file + the storage-hash mismatch.

Revert criterion: drop this entry once the deserializer (or each TML-2536 read site) recomputes the loaded contract's `storage.storageHash` and compares it to the sibling `migration.json`'s `from` / `to` hash, raising a structured `PN-CLI-4004` (or extending `PN-CLI-4003`) on mismatch.

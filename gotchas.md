# Gotchas

A running log of surprises, workarounds, and undocumented behaviour hit while *consuming* **Prisma Next**, **Prisma Compute**, or **Prisma Postgres** in this repo's examples and public surfaces. Each entry captures friction a real user of these products would also experience.

Each entry should also be filed as a Triage-state Linear ticket in the matching gotchas project so the team can pick them up:

- Prisma Next → [`pn-gotchas`](https://linear.app/prisma-company/project/pn-gotchas-a6f6f5157a5c/overview)
- Prisma Compute → [`compute-gotchas`](https://linear.app/prisma-company/project/compute-gotchas-dd3ac34b5ad4/overview)
- Prisma Postgres → [`ppg-gotchas`](https://linear.app/prisma-company/project/ppg-gotchas-afe77336f696/overview)

The capture workflow is documented in [`.claude/skills/record-gotchas/SKILL.md`](.claude/skills/record-gotchas/SKILL.md).

---

## Contents

- [Demo fixture contract snapshots fail to deserialize during `migrate` (PN-CLI-4003)](#demo-fixture-contract-snapshots-fail-to-deserialize-during-migrate-pn-cli-4003)
- [`migration plan` silently plans from an empty database when no `db` ref exists](#migration-plan-silently-plans-from-an-empty-database-when-no-db-ref-exists)

---

## Demo fixture contract snapshots fail to deserialize during `migrate` (PN-CLI-4003)

**Filed upstream:** pending — authored in a session without Linear access; please file in [`pn-gotchas`](https://linear.app/prisma-company/project/pn-gotchas-a6f6f5157a5c/overview) and replace this line.
**Product:** Prisma Next
**Version:** `main` @ `e7bd0deb8` (workspace `0.14.0`)
**First hit:** running the migration-graph demo fixtures end-to-end while writing the public migrations docs
**Cost:** ~30 minutes (ruling out my own setup before reading the snapshots)

**Symptom.** The graph fixtures under `examples/prisma-next-demo/fixtures/` render fine with the offline commands, but applying one against a live database fails before any SQL runs:

```text
$ pnpm prisma-next migrate --to prod --db $DB --config fixtures/diamond/prisma-next.config.ts
✖ Contract validation failed (PN-CLI-4003)
  Why: Predecessor contract at .../fixtures/diamond/migrations/app/20260303T1000_merge_alice/end-contract.json failed to deserialize:
       Contract structural validation failed: storage.namespaces.__unbound__.entries must be an object (was missing);
       storage.namespaces.__unbound__.tables must be removed;
       execution.mutations.defaults[0].ref.namespace must be a string (was missing)
```

**Cause.** The contract serialization format moved under the fixtures (e.g. the database→namespace→table diff-tree restructure, #894), and the fixtures' committed `start-contract.json`/`end-contract.json` snapshots were emitted with the older shape. Offline commands (`migration graph`, `list`, `show`, `check`) never deserialize predecessor contracts, so the drift is invisible until someone runs `migrate` or `migration status` against a database.

**Workaround.** Treat the fixtures as offline-only (graph rendering) for now. For a live apply walkthrough, create a fresh fixture with the current CLI (`contract emit` + `migration plan`) instead of reusing the committed ones.

**Reproduction.**
1. `docker run -d -p 5433:5432 -e POSTGRES_PASSWORD=postgres postgres:17-alpine`, create any empty database.
2. `cd examples/prisma-next-demo && pnpm prisma-next contract emit --config fixtures/diamond/prisma-next.config.ts`
3. `pnpm prisma-next migrate --to prod --db <url> --config fixtures/diamond/prisma-next.config.ts` → PN-CLI-4003 as above.

**References.**
- Fixture snapshots: [`examples/prisma-next-demo/fixtures/diamond/migrations/app/20260303T1000_merge_alice/end-contract.json`](examples/prisma-next-demo/fixtures/diamond/migrations/app/20260303T1000_merge_alice/end-contract.json)
- Restructure that moved the format: #894

---

## `migration plan` silently plans from an empty database when no `db` ref exists

**Filed upstream:** pending — authored in a session without Linear access; please file in [`pn-gotchas`](https://linear.app/prisma-company/project/pn-gotchas-a6f6f5157a5c/overview) and replace this line.
**Product:** Prisma Next
**Version:** `main` @ `e7bd0deb8` (workspace `0.14.0`)
**First hit:** planning the second migration of a fresh walkthrough project while writing the public migrations docs

**Symptom.** With one migration already on disk and applied, adding a nullable field and running `prisma-next migration plan --name add_phone` produced a **full greenfield migration** (`from: null`, `Create schema "public"` + `Create table "user"`) instead of a one-column delta. No warning that the existing history was ignored.

**Cause.** `resolveFromForPlan` ([`packages/1-framework/3-tooling/cli/src/utils/plan-resolution.ts`](packages/1-framework/3-tooling/cli/src/utils/plan-resolution.ts), `optionsFrom === undefined` branch) falls back to the ref named `db` and, when it does not exist, straight to greenfield. Nothing advances the `db` ref unless the user opted in with `migrate --advance-ref db`, so the very first delta plan of a project that skipped that flag rebuilds the world. The command's own help ("Compares the emitted contract against the latest on-disk migration state") promises more than the default does.

**Workaround.** Either apply with `prisma-next migrate --advance-ref db` from the start, or always pass `--from <latest-migration-dir>`. A CLI warning when the graph is non-empty but planning resolves to greenfield would remove the trap entirely.

**Reproduction.**
1. Fresh project: `contract emit`, `migration plan --name init`, `migrate` (no `--advance-ref`).
2. Add `phone String?` to the model, `contract emit`.
3. `migration plan --name add_phone` → planned operations are `Create schema` + `Create table`, `from: null`.

**References.**
- From-resolution: [`packages/1-framework/3-tooling/cli/src/utils/plan-resolution.ts`](packages/1-framework/3-tooling/cli/src/utils/plan-resolution.ts)
- The behaviour is documented defensively in the public docs (prisma/web#8025, generating-a-migration page warning), but the CLI itself stays silent.

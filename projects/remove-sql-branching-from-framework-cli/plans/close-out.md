# Close-out

**Spec:** [`../spec.md`](../spec.md) (Acceptance criteria)

## Goal

Verify the project's acceptance criteria are met, migrate any durable docs, delete the project directory.

This is a final commit (or commits) inside the same PR — no separate PR needed.

## Tasks

### 4.1 Run acceptance checks

Run each command from `plan.md`'s "Acceptance check" section against the merged state of M1 + M2 + M3:

```bash
rg "familyId\\s*===" packages/1-framework/3-tooling/cli/src/
rg "@prisma-next/(sql-|psl-printer/postgres)" \
   packages/1-framework/3-tooling/cli/src/commands/inspect-live-schema.ts \
   packages/1-framework/3-tooling/cli/src/commands/contract-infer.ts
rg "extractSqlDdl|extract-sql-ddl|extractOperationStatements" packages/1-framework/3-tooling/cli/src/
rg "validatePrintableSqlSchemaIR|PslPrintableSqlSchemaIR|createPostgresDefaultMapping|createPostgresTypeMap|parseRawDefault" \
   packages/1-framework/2-authoring/psl-printer/src/
rg "@prisma-next/sql-schema-ir" packages/1-framework/2-authoring/psl-printer/
pnpm lint:deps
pnpm test:packages
```

If any check fails, fix in a focused commit before opening the PR.

### 4.2 Update durable docs

Check whether the new pattern (multiple capabilities — `SchemaViewCapable`, `PslContractInferCapable`, `OperationPreviewCapable`) deserves an architectural call-out:

- **Subsystem doc**: `docs/architecture docs/subsystems/5. Adapters & Targets.md`. If the doc currently describes `SchemaViewCapable` or family capabilities, extend that section to "Capability-gated views" describing the pattern (view type + capability interface + predicate + client delegation method) and listing the three capabilities. Otherwise, defer.
- **CLI README**: `packages/1-framework/3-tooling/cli/README.md`. If the README mentions the `sql` field shape in JSON output, update it to `preview`.
- **Family READMEs**: SQL family and Mongo family READMEs may want to list the implemented capabilities. Update if the READMEs already enumerate them; defer if they don't.

No new ADR required — the pattern is established (`SchemaViewCapable` predates this work). The spec's "Pattern" section suffices as design documentation; if it needs to outlive the project directory, copy it into a durable location (e.g. `docs/architecture docs/`).

### 4.3 Strip references to the project directory

Run `rg "projects/remove-sql-branching-from-framework-cli"` across the repo. Any reference must be either:
- replaced with a link to the durable docs added in 4.2, or
- removed if it was a transient pointer.

### 4.4 Delete the project directory

```bash
git rm -r projects/remove-sql-branching-from-framework-cli/
```

Commit message: `chore(projects): close out remove-sql-branching-from-framework-cli`.

### 4.5 PR description

Compose a PR description covering:
- Summary: 1–3 bullets on intent.
- Milestones: link to each milestone plan and a one-line "what changed" each.
- **Breaking change call-out**: JSON output `sql` → `preview` rename, `@prisma-next/psl-printer` public surface narrowed.
- Test plan: list the test commands run.
- Linear: `Refs: TML-2251`.

## Acceptance check

- All acceptance commands from 4.1 print no matches (or exit 0 for `pnpm` invocations).
- No file in the repo references `projects/remove-sql-branching-from-framework-cli/`.
- `pnpm test:packages` and `pnpm lint:deps` clean.

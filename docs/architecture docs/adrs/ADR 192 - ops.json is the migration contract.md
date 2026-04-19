# ADR 192 — ops.json is the migration contract

## At a glance

A MongoDB migration directory on disk looks like this:

```
migrations/
  2025-06-12T0930_backfill-status/
    migration.json          # manifest: from/to hashes, migrationId
    ops.json                # the operations — precheck, execute, postcheck as JSON
    migration.ts            # authoring surface — TypeScript the developer edits
    contract.json           # destination contract snapshot
    contract.d.ts
```

When a developer runs `migration apply`, the runner reads `migration.json` and `ops.json`. It never loads `migration.ts`. The TypeScript file is a development tool — a convenient way to author operations using typed builders and query APIs. It produces `ops.json` when evaluated (either by running the file directly or via `migration emit` / inline from `migration plan`). Once emitted, the JSON is the artifact that gets attested, hash-verified, and replayed.

## Decision

`ops.json` + `migration.json` are the migration contract. `migration.ts` is authoring sugar that emits `ops.json`; it is never loaded at apply time.

The `migrationId` in `migration.json` is a content-addressed hash computed over the *stripped* manifest metadata plus `ops.json` — `fromContract`, `toContract`, and `hints` are excluded so the identity reflects what the migration does to storage, not the shape of the contract objects at planning time (see [ADR 199 — Storage-only migration identity](ADR%20199%20-%20Storage-only%20migration%20identity.md); manifest layout in [ADR 028](ADR%20028%20-%20Migration%20Structure%20&%20Operations.md), [ADR 169](ADR%20169%20-%20On-disk%20migration%20persistence.md)). Editing `ops.json` changes the `migrationId`. Editing `migration.ts` in a way that doesn't change the emitted ops — reformatting, adding comments, renaming local variables — does not.

This works naturally for MongoDB because MongoDB commands *are* JSON. The query builders produce AST objects (`CreateIndexCommand`, `UpdateManyCommand`, `AggregateCommand`) that serialize directly via `JSON.stringify` — each node has a `kind` discriminant and plain properties (see [ADR 188](ADR%20188%20-%20MongoDB%20migration%20operation%20model.md)). Deserialization reconstructs the live class instances from the `kind` field, validated by arktype schemas. The runner works with rehydrated operations identically to planner-produced ones.

## Why

**No TypeScript at apply time.** This is the core constraint. Four properties follow from it:

1. **Determinism.** The same `ops.json` produces the same database mutations regardless of when or where it's applied. There's no evaluation-order sensitivity, no ambient state from `node_modules`, no runtime behavior differences between Node versions.

2. **Auditability.** A reviewer reads the JSON to understand exactly what a migration does. The operations are data — inspectable, diffable, greppable. Reviewing `migration.ts` tells you what the author *intended*; reviewing `ops.json` tells you what will *happen*.

3. **Security.** `migration apply` executes structured database commands, not arbitrary code. There is no `eval`, no dynamic `import`, no user-authored function bodies running at deploy time. A compromised `migration.ts` can only affect what gets emitted to `ops.json` — and `ops.json` is reviewed and hash-attested before apply.

4. **Portability.** Any environment that can read JSON and talk to the database can apply migrations — CI runners, edge workers, hosted services. There's no requirement for a TypeScript toolchain, a bundler, or even Node.js at apply time.

## Consequences

### Apply-time verification is two-step

`migration apply` must trust two things before executing operations:

1. **The on-disk artifacts are internally consistent.** Recompute `migrationId` from the on-disk manifest + `ops.json` and compare against the stored `migrationId`. If they diverge, the artifacts have been tampered with or corrupted; refuse to apply. This check needs nothing beyond the JSON and is the same hash computation `attestMigration` performed at emit time ([ADR 199](ADR%20199%20-%20Storage-only%20migration%20identity.md)).

2. **The on-disk artifacts are not stale relative to `migration.ts`.** If `migration.ts` is present in the migration directory, dynamic-import it (or run it in-memory to a temp location), let `Migration.run` produce a fresh attested manifest + ops, and compare its `migrationId` against the on-disk `migrationId`. If they diverge, the developer edited `migration.ts` after the last emit and forgot to re-emit; refuse to apply with a clear "ops.json is out of date — re-run `migration plan` or `./migration.ts`" error.

This split is what makes `ops.json` trustworthy as the contract while keeping `migration.ts` as a self-emitting authoring surface. Step (1) defends against post-emit tampering or transport corruption. Step (2) defends against emit drift — a developer who tweaked the TypeScript without regenerating the JSON. Both checks are framework-owned (target-agnostic) because they operate on `MigrationManifest` and `MigrationOps` shapes that are themselves family-agnostic.

Step (2) relies on `Migration.run` being deterministic and self-contained: it must produce byte-identical artifacts whether driven directly by the developer's shebang or imported by the verifier ([ADR 196](ADR%20196%20-%20In-process%20emit%20for%20class-flow%20targets.md)). If `Migration.run` left any field unset (e.g. wrote a draft `migrationId: null`), the freshly emitted hash would never match the on-disk hash and the staleness check would always trigger.

### migration.ts is development-only

The developer's workflow is: scaffold the package with `migration plan` (which writes `migration.json`, `ops.json`, `migration.ts`, and the contract snapshot), then iterate by editing `migration.ts` and re-running it directly — `Migration.run(...)` re-emits both `ops.json` and an attested `migration.json` on every invocation ([ADR 196](ADR%20196%20-%20In-process%20emit%20for%20class-flow%20targets.md)). The committed artifacts are `migration.json`, `ops.json`, and `migration.ts` — but only the first two are load-bearing at apply time.

`migration apply` never imports or evaluates `migration.ts`. If the file is missing from the migration directory, apply still succeeds — it needs only the JSON.

### Identity tracks output, not source

Because `migrationId` is computed from the manifest and `ops.json`, two `migration.ts` files with different source code that emit identical ops produce the same `migrationId`. Refactoring the authoring file — extracting helpers, changing variable names, upgrading builder APIs — doesn't invalidate an already-attested migration as long as the emitted ops are unchanged.

## Alternatives considered

### Execute migration.ts directly at apply time

The simplest model: `migration apply` evaluates `migration.ts` and runs whatever it produces. No intermediate JSON, no serialization step.

Rejected because it violates all four properties above. A migration that behaves differently depending on installed packages, environment variables, or Node version is not auditable or deterministic. Arbitrary code execution at deploy time is a security boundary we don't want to cross. And it requires a full TypeScript/Node environment wherever migrations are applied.

### ops.json as a cache, migration.ts as source of truth

`migration apply` would re-evaluate `migration.ts` if present, falling back to `ops.json` if not. This makes `ops.json` advisory rather than authoritative — a performance optimization, not a contract.

Rejected because it reintroduces TypeScript evaluation at apply time (same problems as above) and makes the `migrationId` hash meaningless: the hash covers `ops.json`, but the runner might not use `ops.json`. Reviewers can't trust the JSON because the runner might ignore it.

### SQL-string approach (no AST serialization)

For SQL targets, `ops.json` contains raw SQL strings — no AST, no rehydration. We could do the same for MongoDB: serialize commands as shell-syntax strings (`db.users.createIndex({email: 1})`).

Rejected because MongoDB commands have richer structure than SQL DDL strings. Checks compose source commands with filter expressions and expect clauses ([ADR 188](ADR%20188%20-%20MongoDB%20migration%20operation%20model.md)). Flattening that structure to strings would lose the composability and require a parser on the deserialization side. The AST approach — `kind`-discriminated JSON objects validated by arktype schemas — is lossless, round-trips cleanly, and is already proven for DDL commands.

## References

- [ADR 028 — Migration Structure & Operations](ADR%20028%20-%20Migration%20Structure%20&%20Operations.md)
- [ADR 169 — On-disk migration persistence](ADR%20169%20-%20On-disk%20migration%20persistence.md)
- [ADR 188 — MongoDB migration operation model](ADR%20188%20-%20MongoDB%20migration%20operation%20model.md)
- [ADR 199 — Storage-only migration identity](ADR%20199%20-%20Storage-only%20migration%20identity.md)

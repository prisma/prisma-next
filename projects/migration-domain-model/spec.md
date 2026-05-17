# Migration CLI restructure — spec

## Summary

Bring the `prisma-next` CLI surface in line with the vocabulary settled in [`domain.md`](./domain.md) and the gap analysis in [`cli-audit.md`](./cli-audit.md). Six surface changes land:

1. Promote the live-DB advance verb to top-level: `prisma-next migration apply [--ref X]` → `prisma-next migrate --to <contract>`.
2. Promote `ref` to a top-level subject; rename `ref get` → `ref show`.
3. Split `prisma-next migration status` into five purpose-specific verbs: `status`, `log`, `list`, `graph` (plus the existing `show`).
4. Add contract-naming arguments to `db sign`: `db sign [<contract>]` and `db sign --contract <contract>`.
5. Unify the contract-reference grammar across every flag that names a contract: `--to <contract>` / `--from <contract>` accept hashes, ref names, migration directory names, `<dir>^`, and filesystem paths.
6. Add two net-new verification verbs: `migration check [<m>]` (artifact/graph integrity) and `migration preflight <m>` (sandbox behavioral check).

No transitional aliases. Each rename is atomic; the journey suite updates in lockstep with each verb change. No external users; no migration-of-users concern. No deprecation window.

## Context

### Why this is one project

The findings in the audit are not independent surface tweaks — they fall out of a single coherent re-reading of the migration domain. The vocabulary work in `domain.md` established:

- **Graph nodes are contracts; edges are migrations.** The verb that moves a live DB along an edge is `migrate`; it operates on the database, not on the migration artifact, so it sits at the top level alongside `init`, `contract`, `db`, `migration`, `ref`.
- **Refs are contract references** — pointers into the graph, on the same noun family as contracts, not as migrations. They belong at the top level.
- **One reference grammar** spans every place the user names a contract. Today that grammar is fragmented across `--from <hash>`, `--ref <name>`, `--to <hash>`.
- **The `migration` namespace is the artifact-and-graph subject.** Today it hosts a live-DB verb (`apply`), a sub-namespace (`ref`), and a multi-question status command — all of which belong elsewhere.

Each finding follows directly from these reframings. Landing them piecemeal across unrelated projects would leak transitional shapes into the surface; doing them as one project lets each milestone reach a coherent state and the close-out reach a clean final shape.

### Current surface

```
prisma-next
├── init
├── contract
│   ├── emit
│   └── infer
├── db
│   ├── init
│   ├── update [--to <hash>]
│   ├── verify [--schema-only|--marker-only|--strict]
│   ├── sign
│   └── schema
└── migration
    ├── plan [--name <slug>] [--from <hash>]
    ├── new
    ├── show
    ├── status [--ref <name>] [--graph] [--limit <n>] [--all]
    ├── apply [--ref <name>]
    └── ref
        ├── set <name> <hash>
        ├── get <name>
        ├── list
        └── delete <name>
```

### Intended surface

```
prisma-next
├── init
├── migrate --to <contract>
├── contract
│   ├── emit
│   └── infer
├── db
│   ├── init
│   ├── update [--to <contract>]
│   ├── verify [--schema-only|--marker-only|--strict]
│   ├── sign [<contract>] [--contract <contract>]
│   └── schema
├── migration
│   ├── plan [--name <slug>] [--from <contract>]
│   ├── new
│   ├── show <m>
│   ├── status [--to <contract>] [--from <contract>]
│   ├── log
│   ├── list
│   ├── graph
│   ├── check [<m>]
│   └── preflight <m>
└── ref
    ├── set <name> <contract>
    ├── show <name>
    ├── list
    └── delete <name>
```

## Objectives

1. **Verbs match the model.** The user-facing CLI surface reads like the domain. Top-level subjects are `init`, `migrate`, `contract`, `db`, `migration`, `ref`. The `migration` namespace contains only artifact-and-graph operations.
2. **One reference grammar.** Wherever the CLI accepts a contract as input, it accepts any **contract reference**: hash (full or prefix), ref name, migration directory name, `<dir>^`, or filesystem path. The flag is `--to <contract>` for targets and `--from <contract>` for origins. Same grammar; same resolver; same error messages.
3. **One question per verb.** Each verb answers exactly one question about exactly one subject. The two diagnostic modes on `db verify` (`--schema-only`, `--marker-only`) are sensibly-flagged debugging variants of one canonical question; they remain. The five-questions-under-one-verb shape of `migration status` does not.
4. **Verification is split by what's being verified.** Three distinct verbs along two axes: `db verify` (live DB satisfies its contract), `migration check` (artifact / graph integrity), `migration preflight` (migration's behavior on a sandbox).
5. **Journey suite is the regression contract.** Every milestone's PR carries the journey-test updates needed to keep `pnpm test:journeys` green. Helper functions in `journey-test-helpers.ts` follow the new verb names.

## Non-goals

- **`db verify` modes.** The `--schema-only` / `--marker-only` / `--strict` flag shape stays. The audit (F8) concluded the flags are clear and the verb is one verb; no change.
- **Internal naming of legacy "apply" / "applied".** The vocab work resolved these as opportunistic renames; this project doesn't carry that work as gating. Files touched by milestones in this project can be renamed in the same PR (e.g., `apply-aggregate` → `migrate-aggregate` if it's already on the diff); a separate sweep of `MigrationApplied` events, `control-api/operations/` → `commands/`, etc., is out of scope here and tracked separately.
- **Migration-from-old-CLI tooling.** No prior version is in users' hands; no compatibility shim. The CLI changes are absolute.
- **New runtime capabilities.** `migration preflight`'s sandbox runtime is bounded to what the existing test infrastructure already provides (PGlite / mongodb-memory-server). Building new sandbox infra is a follow-on project if needed.
- **Glossary / subsystem-doc rewrite.** The close-out milestone promotes the settled vocabulary into `docs/glossary.md` and updates the affected subsystem docs (`7. Migration System.md`, `CLI Style Guide.md`). It does not rewrite the subsystem docs from scratch.

## Functional requirements

Per the audit's findings; each FR corresponds to one audit-section.

**FR1 (audit F1) — top-level `migrate`.** A new top-level command `prisma-next migrate` accepts `--to <contract>` and walks the migration graph from the marker to the named contract, executing each migration on the live database. Removes `prisma-next migration apply`. The `<contract>` argument accepts the full contract-reference grammar (FR5).

**FR2 (audit F2) — top-level `ref`.** Refs become a top-level subject. Subcommands: `ref set <name> <contract>`, `ref show <name>` (renamed from `get`), `ref list`, `ref delete <name>`. Removes `prisma-next migration ref`. The `<contract>` argument accepts the full contract-reference grammar.

**FR3 (audit F3) — split `migration status`.** Five purpose-specific verbs replace the flag-overloaded one:

- `migration status [--to <contract>] [--from <contract>]` — path / pending. Live by default; offline when `--from` is supplied.
- `migration log` — execution history (live, reads the ledger).
- `migration list` — flat enumeration of migrations on disk (offline).
- `migration graph` — topology view with branches and ref markers (offline).
- `migration show <m>` — unchanged.

The `--graph`, `--all`, `--limit`, `--ref` flags on the current `status` verb do not survive the split; their behaviors are reachable through the new verbs.

**FR4 (audit F4) — `db sign` accepts a contract argument.** Positional form `db sign [<contract>]` and explicit form `db sign --contract <contract>`. With no argument, defaults to signing with the current `contract.json` (current behavior).

**FR5 (audit F5) — unified contract-reference grammar.** The argument grammar for `<contract>` is:

- A storage hash (full or prefix, with Git-style ambiguity error on short-prefix collisions).
- A ref name.
- A migration directory name (resolves to the migration's `to`-contract).
- A migration directory name suffixed with `^` (resolves to the migration's `from`-contract).
- A filesystem path prefixed with `./` (resolves the contract.json at that path).

A parallel `<migration>` grammar accepts migration hashes and migration directory names. The command's argument *type* — `<contract>` vs `<migration>` — determines which grammar applies.

Every flag that names a contract or migration uses this shared grammar: `migrate --to`, `db update --to`, `db sign --contract`, `migration plan --from`, `migration status --to/--from`, `ref set`'s second argument, and the positional arguments to `migration show`, `migration check`, `migration preflight`.

**FR6 (audit F6) — two new verification verbs.**

- `migration check [<m>]` — artifact / graph integrity. With a `<m>` argument: recompute that migration's hashes; validate its `ops.json` / manifest match; confirm its on-disk shape is complete. With no argument: a graph-wide sweep — every migration self-consistent; every edge's `from` and `to` line up with neighbouring contracts; no orphan nodes; no dangling refs. Read-only, offline.
- `migration preflight <m>` — sandbox-execute the migration against a shadow database and report the outcome. Read-only with respect to the production database; mutates only the sandbox. The sandbox is acquired from the existing test infrastructure (PGlite for Postgres, mongodb-memory-server for Mongo); no new sandbox provisioning code in this project.

## Acceptance criteria

**AC1 — surface.** After close-out, `prisma-next --help` enumerates exactly the verbs in the intended-surface diagram above. Running any verb listed in the *current* surface that is *not* in the intended surface (e.g., `prisma-next migration apply`) produces an unknown-command error from the CLI's standard error envelope.

**AC2 — grammar.** For every flag named `--to` or `--from` that takes a contract argument, the following resolve identically to the same target contract (verified by parameterized test):

- A full storage hash.
- A 6-character prefix of that hash (unique).
- A ref name pointing at the same contract.
- A migration directory name whose `to`-contract is that contract.
- `<dir>^` for a migration whose `from`-contract is that contract.

Ambiguity (a hex-shaped string that's both a hash prefix and a directory name; a non-unique prefix) produces a CLI error with candidate listing.

**AC3 — questions are split.** Each of the five split verbs (`status`, `log`, `list`, `graph`, `show`) answers its question without consulting any data source it doesn't need: `list` / `graph` / `show` do not touch the live database; `status` / `log` do.

**AC4 — sign with contract.** `db sign abc123` (positional hash prefix), `db sign --contract abc123` (explicit), `db sign --contract production` (ref name), and `db sign` (no argument) all succeed when the live DB satisfies the named contract, and produce identical marker rows. All four refuse with the same error envelope when the DB does not satisfy the named contract.

**AC5 — preflight sandbox correctness.** `migration preflight <m>` against a green-path migration reports success and leaves the production DB untouched (verified by marker-row inspection before and after). `migration preflight <m>` against a migration that would fail on production data reports failure with the specific operation that failed, and likewise leaves the production DB untouched.

**AC6 — check covers the graph.** `migration check` with no argument over a clean graph passes. Adversarial fixtures — a hand-mutated `ops.json` (hash mismatch), a corrupted manifest (missing files), an orphan migration (no edge to anywhere), a dangling ref (points at a non-existent contract) — each produce a distinct failure with a localized message identifying the bad artifact.

**AC7 — journey suite green at every milestone boundary.** `pnpm test:journeys` passes at the end of every milestone's PR. No milestone leaves the suite red.

**AC8 — docs match the surface.** At close-out:

- `docs/glossary.md` contains the canonical definitions from `domain.md` (or links to them).
- `docs/architecture docs/subsystems/7. Migration System.md` describes the new verb taxonomy.
- `docs/CLI Style Guide.md` reflects the new top-level subjects.
- No documented verb in any of those files refers to a verb that no longer exists.

## Open questions

- **`migration preflight` sandbox lifecycle.** The verb takes a single migration argument and executes it on a fresh sandbox. The unresolved sub-question is whether the *initial* sandbox state should be the migration's `from`-contract (so the sandbox starts at a state where the migration is applicable). Probably yes — otherwise the operator has to provision the sandbox separately. Confirm during M6 design.
- **`migration check` exit-code semantics.** Today's CLI uses exit 0/1/2 (success/runtime error/CLI usage error). With a per-migration argument the verb has two failure modes — "bad CLI input" (the named migration doesn't exist) and "integrity check failed" (the migration is corrupt). Both warrant non-zero exits; they should map to different codes. Confirm during M6 design.
- **Migration-reference grammar for `<m>` arguments.** The audit established two parallel grammars — `<contract>` and `<migration>`. The migration-reference grammar is simpler (directory name or hash), and we should confirm the resolver yields a clear error when an operator passes a contract reference where a `<migration>` is expected (e.g., a ref name to `migration show`).
- **Help-text strategy for split verbs.** Splitting `migration status` removes four flags from one help page and creates four new help pages. We should confirm during M4 that the help text for `migration status` itself points operators at the related verbs (so somebody who's looking for "graph" lands on `migration graph` quickly).

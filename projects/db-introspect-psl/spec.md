# Summary

Make `prisma-next db introspect` produce a `schema.prisma` file by default, enabling brownfield adoption: teams with existing PostgreSQL databases can introspect their schema and get a ready-to-use PSL file in a single command. This requires building a new **PSL printer** — a `SqlSchemaIR → string` converter — and changing the command's default behavior from tree-view display to PSL file write (with tree view moving behind `--dry-run`).

# Description

Today, `prisma-next db introspect` connects to a Postgres database and produces either a tree view (human-readable) or a JSON envelope containing the raw `SqlSchemaIR`. There is no way to generate a PSL schema file from an existing database.

This means brownfield adoption requires:
1. Running `db introspect --json` to see the schema
2. **Manually writing** a `schema.prisma` file that matches the database
3. Running `contract emit` to produce a contract

Step 2 is tedious, error-prone, and blocks adoption. ADR 006 sanctions PSL back-generation as a future capability, and ADR 122 describes brownfield adoption via introspection as a first-class workflow.

The proposed solution changes `db introspect` so that its **default behavior** is to write a PSL file to disk. The current tree-view output moves behind a `--dry-run` flag for preview without writing. The `--json` mode is unchanged.

**Scope boundary:** No TypeScript contract materialization. The command writes a `.prisma` file only. Contract emission remains a separate `contract emit` step.

# Requirements

## Functional Requirements

### CLI behavior

- By default, `prisma-next db introspect` writes a `.prisma` file to the resolved output path and prints a success message to stderr.
- `--dry-run` shows the tree-view preview (current default behavior) without writing any file.
- `--output <path>` overrides the resolved output path with an explicit path, resolved relative to cwd.
- Output path resolution follows a three-tier priority:
  1. `--output <path>` flag (resolved relative to cwd)
  2. Derive from `config.contract.output` — replace `.json` → `.prisma` (e.g., `src/prisma/contract.json` → `src/prisma/schema.prisma`)
  3. Canonical default: `schema.prisma` in cwd (when neither `--output` nor `prisma-next.config.ts` is available)
- If the target file already exists, a warning is displayed on stderr before overwriting.
- `--quiet` suppresses the overwrite warning.
- `--json` envelope includes `psl.path` when a PSL file was written. `--json` combined with `--dry-run` outputs the raw `SqlSchemaIR` without writing (existing behavior).
- Empty database produces a valid (but content-free) PSL file with a header comment.

### PSL printer — models and fields

- Tables are emitted as `model` blocks with PascalCase names; `@@map("db_name")` is added when the name was transformed.
- Columns are emitted as fields with camelCase names; `@map("db_col")` is added when the name was transformed.
- PSL reserved words and identifiers starting with digits are prefixed with an underscore and mapped via `@map`/`@@map`.
- Fields whose Postgres type has no PSL equivalent are emitted as `Unsupported("typename")`.

### PSL printer — constraints and indexes

- Single-column primary keys emit `@id`; composite primary keys emit `@@id([...])`.
- Single-column unique constraints emit `@unique`; composite unique constraints emit `@@unique([...])`.
- Indexes emit `@@index([...])`.

### PSL printer — relations

- Foreign keys emit `@relation(fields: [...], references: [...])` with `onDelete`/`onUpdate` when non-default.
- Virtual back-relation fields are generated on the referenced model (1:N as `Type[]`, 1:1 as `Type?`). Back-relation field names use simple English pluralization for 1:N (add `s`, `y→ies`, `s→ses`) and the singular child model name for 1:1. **Note:** The PSL interpreter (contract-psl) does not yet support relation navigation list fields (`Type[]`); this is a planned follow-up in the `psl-contract-authoring` project. The printer emits them for readability, but round-trip tests through the full interpreter pipeline may not pass until that support lands.
- Multiple FKs from the same child table to the same parent produce named relations (`@relation(name: "...")`).
- Self-referencing FKs produce correctly-named relation fields on the same model.
- Composite FK relation fields use the referenced table name (lowercased, camelCased) as the field name, since stripping `_id` from multi-column FKs may produce nonsensical names.

### PSL printer — types and defaults

- Enum types from `annotations.pg.storageTypes` emit `enum` blocks.
- Enum member mapping is intentionally out of scope for v1. The printer normalizes enum member names to valid PSL identifiers, but it does not preserve original database enum labels via enum member `@map` attributes. For enums with labels that are not already PSL-safe identifiers, introspection is therefore lossy.
- Parameterized Postgres types (e.g., `character varying(255)`) generate `types` block entries.
- Default values emit `@default(autoincrement())`, `@default(now())`, `@default(uuid())`, `@default(true/false)`, `@default(42)`, `@default("str")`.
- Unrecognized default expressions are emitted as PSL comments (`// Raw default: <expr>`).

### PSL printer — output formatting

- Header comment: `// This file was introspected from the database. Do not edit manually.`
- Output order: `types` block → `enum` blocks (alphabetical) → `model` blocks (topologically sorted by FK deps, alphabetical fallback for cycles).
- Within each model: `@id` field(s) first, then scalar fields (database ordinal order), then relation fields, then model-level attributes (`@@id`, `@@unique`, `@@index`, `@@map`).
- 2-space indentation inside blocks; field types and attributes column-aligned (matching Prisma ORM's formatter: type names aligned, attribute columns aligned).

## Non-Functional Requirements

- **Determinism**: Same database schema always produces identical PSL output.
- **Round-trip fidelity**: Generated PSL parses via `parsePslDocument()` with no diagnostics; when used as contract source via `prismaContract()` → `contract emit`, the resulting contract matches the original database schema.
- **No new dependencies**: The printer uses only packages already in the workspace.
- **Target-agnostic printer core**: The `printPsl` function accepts a type map as a parameter; Postgres-specific mapping is injected, not hard-coded.
- **Performance**: Schema metadata is bounded and small (even 1000 tables × 20 columns ≈ 100KB of IR). Batch processing is sufficient; no streaming required.

## Non-goals

- TypeScript contract materialization from the introspect command (remains a separate `contract emit` step).
- Merge mode for existing PSL files (v1 is overwrite-only; merge is a future enhancement).
- Preserving original database enum labels via enum member `@map` attributes.
- Multi-target support beyond PostgreSQL (MySQL, SQLite type maps are future work).
- Introspecting non-`public` Postgres schemas (`--schema` flag is future).
- Excluding specific tables (`--exclude` flag is future).
- Watch mode for re-introspection on schema changes.
- Extension-aware introspection (e.g., pgvector column attributes).

# Acceptance Criteria

## Core printer

- [x] `printPsl()` produces valid PSL for a `SqlSchemaIR` with tables, columns, PKs, FKs, uniques, indexes, enums, and defaults
- [x] Snapshot tests cover: simple schema, complex schema with relations, self-referencing FK, multiple FKs to same table, composite PK/FK, enum types, unmappable types, empty schema, tables without PK
- [ ] Output parses successfully via `parsePslDocument()` (round-trip parse test)
- [x] Relation inference handles: 1:N, 1:1 (FK cols == PK cols or unique FK col), self-referencing, multiple FKs to same parent, composite FKs
- [x] Name transformation handles: PascalCase models, camelCase fields, reserved words, digit-prefixed identifiers
- [x] Default mapping handles: `autoincrement()`, `now()`, `uuid()`, boolean/number/string literals, unrecognized expressions (→ comment)
- [x] Unmappable types emit `Unsupported("typename")` with no `@default`/`@id`/`@unique` attributes
- [x] Tables without primary keys emit a warning comment and no `@id`

## CLI integration

- [x] Default behavior (no flags) writes PSL to the resolved output path and prints success to stderr
- [x] `--dry-run` shows tree-view preview without writing any file
- [x] `--output ./prisma/schema.prisma` overrides the resolved path
- [x] Without `--output`, output path falls back to `config.contract.output`-derived path, then to `schema.prisma` in cwd
- [x] Overwrite warning displayed when target file exists; `--quiet` suppresses it
- [x] `--json` envelope includes `psl.path` when output was written; `--json --dry-run` outputs raw `SqlSchemaIR`
- [x] Empty database produces a valid header-only PSL file

## Round-trip and integration

- [ ] Round-trip test passes: DB → introspect → PSL → `parsePslDocument()` → verify parse succeeds with no diagnostics
- [ ] Full round-trip test (DB → introspect → PSL → `prismaContract()` → `contract emit` → verify) passes for schemas without back-relation list fields; may be gated on interpreter `Type[]` support for schemas with 1:N relations
- [x] Brownfield adoption journey test updated with `--output` step
- [ ] `Unsupported()` type parses and round-trips correctly (extend PSL parser if needed)

## Quality gates

- [x] Unit test coverage ≥ 95% for `@prisma-next/psl-printer`
- [x] E2E tests for happy path, `--dry-run`, overwrite warning, JSON mode, empty database
- [x] `pnpm lint:deps` passes (no import layer violations)

# Other Considerations

## Security

The `db introspect` command already requires a database connection URL (via `--db` or config). The PSL printer processes in-memory schema metadata only — no new credential handling, no new network calls, no new attack surface. The file write uses the CLI's existing filesystem access patterns.

**Assumption:** The generated PSL file is not treated as sensitive (it contains schema structure, not data). If the schema itself is sensitive, the existing `--db` credential handling and file permissions are the appropriate controls.

## Cost

Zero incremental operating cost. The PSL printer is a pure in-memory string transformation that runs locally during a CLI invocation. No cloud services, no external API calls.

## Observability

No runtime observability needed — this is offline CLI tooling. The command's existing `--json` output mode provides machine-readable results for CI/scripting pipelines. The overwrite warning on stderr is sufficient user feedback.

**Assumption:** No telemetry or usage metrics for v1. If adoption tracking is needed later, it can be added at the CLI harness level.

## Data Protection

The PSL printer processes database schema structure (table names, column names, types, constraints) — not row data. No PII is involved unless table/column names themselves contain PII, which would be a pre-existing issue in the database design.

No GDPR/CCPA implications beyond what the existing `db introspect` command already has.

## Analytics

No analytics events for v1. If brownfield adoption tracking becomes a priority, the CLI harness can emit events for `db introspect --output` invocations.

# References

## Internal

- Existing `db introspect` command: `packages/1-framework/3-tooling/cli/src/commands/db-introspect.ts`
- `SqlSchemaIR` types: `packages/2-sql/1-core/schema-ir/src/types.ts`
- PSL parser types: `packages/1-framework/2-authoring/psl-parser/src/types.ts`
- PSL interpreter (forward mapping): `packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:50-60`
- Postgres introspection adapter: `packages/3-targets/6-adapters/postgres/src/core/control-adapter.ts`
- Default normalizer: `packages/3-targets/6-adapters/postgres/src/core/default-normalizer.ts`
- Enum control hooks: `packages/3-targets/6-adapters/postgres/src/core/enum-control-hooks.ts`
- Config types: `packages/1-framework/1-core/shared/config/src/config-types.ts`
- PSL fixture: `packages/1-framework/2-authoring/psl-parser/test/fixtures/schema.psl`
- E2E introspect tests: `test/integration/test/cli.db-introspect.e2e.test.ts`
- Brownfield journey test: `test/integration/test/cli-journeys/brownfield-adoption.e2e.test.ts`
- PSL contract authoring project: `projects/psl-contract-authoring/spec.md`
- Implementation plan: `plans/feat-db-introspect-psl-output.md`

## ADRs

- **ADR 006** — Dual Authoring Modes: sanctions PSL back-generation
- **ADR 010** — Canonicalization rules: deterministic output ordering
- **ADR 104** — PSL extension namespacing: `@<ns>.<attr>` syntax
- **ADR 122** — Database Initialization & Adoption: brownfield adoption via introspection
- **ADR 151** — Control Plane Descriptors: `ControlFamilyInstance.introspect()` returning `TSchemaIR`
- **ADR 163** — Provider-invoked source interpretation: architecture for PSL interpretation packages

## External

- [Prisma ORM Introspection docs](https://www.prisma.io/docs/orm/prisma-schema/introspection) — reference for `Unsupported()` type and name transformation conventions

# Open Questions

Decisions already made:

- **`Unsupported()` in the PSL parser**: Confirmed NOT supported. The parser's field type regex (`/^([A-Za-z_]\w*)\s+([A-Za-z_]\w*(?:\[\])?)(\?)?(.*)$/`) only matches simple identifiers, not function call syntax like `Unsupported("typename")`. Both the parser (to accept the syntax) and the interpreter (to map it to the contract IR) need extending. This is a prerequisite for round-trip tests.
- **Relation field naming for composite FKs**: Use the referenced table name (lowercased, camelCased) as the relation field name when the FK has more than one column.
- **Output path resolution**: Three-tier priority: `--output` flag → derive from `config.contract.output` (`.json` → `.prisma`) → canonical default `schema.prisma` in cwd.
- **Pluralization**: Simple English rules (`s`, `y→ies`, `s→ses`) for back-relation field naming (e.g., `User` has `posts Post[]`). No library needed for v1.
- **Column alignment**: Match Prisma ORM's formatter — field types and attributes aligned into columns.
- **Default command behavior**: PSL file write is the default. The current tree-view output moves behind `--dry-run`. This eliminates the implicit-side-effect problem — introspect *is* a write operation, and `--dry-run` is the preview.
- **Enum member mapping**: Out of scope for this PR. The printer emits enum blocks and normalizes enum member identifiers to valid PSL names, but it does not preserve original database enum labels via enum member `@map`.
- **Back-relation `Type[]` fields**: The printer emits them for readability, even though the PSL interpreter does not yet support relation navigation lists. A comment in the generated PSL notes this. Full round-trip through the interpreter is gated on the `psl-contract-authoring` follow-up shipping `Type[]` support.

Remaining questions:

- None.

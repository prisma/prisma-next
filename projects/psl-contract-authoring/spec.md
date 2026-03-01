# Summary

Prisma has historically let users describe their application domain in a Prisma schema file (PSL). From that schema, Prisma can infer what needs to exist in the database, manage migrations, and let users query in terms of their domain models instead of thinking about SQL tables and joins.

In Prisma Next, the equivalent “high-level authoring” step is **contract authoring**: you describe your domain (models, fields, relations, constraints, extensions), and Prisma Next emits:

- `contract.json` — the canonical, machine-readable data contract Prisma Next uses for tooling and runtime verification
- `contract.d.ts` — TypeScript types your application uses while building queries

This project builds the **PSL authoring surface for Prisma Next**.

# What we’re trying to achieve

Developers can author their schema in PSL (a Prisma schema file) and run the existing command `prisma-next contract emit` to produce the same canonical contract artifacts that TS-first projects already get today.

Key constraints:

- We are **not** inventing new database primitives in Prisma Next to support PSL. PSL support is limited to what Prisma Next can already represent today (the existing TypeScript authoring surface and contract model are the “capability ceiling” for this project).
- This is **not a cutover**. PSL-first and TS-first authoring both remain supported.
- This is primarily offline tooling; there are no strict latency requirements.

# User experience (intended workflow)

## PSL-first project

1. Author writes/updates a Prisma schema file (e.g. `schema.prisma`).
2. Project config (`prisma-next.config.ts`) points to a **PSL contract source provider** as the contract source.
3. Author runs:
   - `prisma-next contract emit`
4. Tool emits:
   - `contract.json`
   - `contract.d.ts`
5. If the schema is invalid or uses unsupported PSL features, the author gets a clear error that points at the exact place in the PSL file and explains what to change.

## TS-first project (must remain working)

1. Author writes/updates the TS contract source (e.g. `contract.ts` using the existing TS authoring packages).
2. Config points to a **TS contract source provider** as the contract source.
3. `prisma-next contract emit` continues to emit the same artifacts as today.

# Requirements

## Functional Requirements

- A project can choose **PSL-first** or **TS-first** authoring by configuring `prisma-next.config.ts` with a contract **source provider** (provider-based authoring; no enumerated `{ kind: ... }` union end-state).
- `prisma-next contract emit` can emit `contract.json` and `contract.d.ts` from a provider-produced Contract IR.
- The PSL provider reads PSL as input and produces Contract IR (bounded by the existing Prisma Next contract model).
- Emission validates PSL and reports actionable diagnostics (with source locations).
- PSL-first output and TS-first output are compatible with the rest of Prisma Next (validator, tooling, runtime).
- For schemas that are expressible in both surfaces, PSL-first and TS-first emission produce the **same canonical contract meaning** (including deterministic hashing/identity in `contract.json`).
- Both authoring surfaces remain available and documented; there is no forced migration.
- Canonical artifacts must not include provenance: `contract.json` must not embed schema paths/sourceIds and must not contain a top-level `sources` field (diagnostics-only).

## Non-Functional Requirements

- Deterministic artifacts: emitting twice from the same inputs produces equivalent output.
- Clear failure modes: unsupported PSL features fail with a targeted error explaining (a) what’s unsupported and (b) how to express the same intent using supported constructs (when possible).
- Keep the layering boundaries intact (PSL parsing and normalization lives in authoring/emitter/tooling layers; runtime/query layers should not need to change except to consume the existing artifacts as they already do).

## Non-goals

- Building a GUI/editor for PSL authoring.
- Extending the contract model with brand-new storage primitives solely to match “all of PSL”.
- Replacing TS-first authoring.
- Solving migration planning in this project beyond what is necessary to emit the contract artifacts.

# Acceptance Criteria

## Basic

- [ ] With a PSL contract source provider configured, `prisma-next contract emit` emits `contract.json` + `contract.d.ts`.
- [ ] With a TS contract source provider configured, `prisma-next contract emit` still works exactly as it does today.
- [ ] Running emit twice with unchanged inputs produces equivalent outputs.
- [ ] Invalid PSL fails with a helpful diagnostic that points to the exact location in the PSL file.

## Parity (the important part)

- [ ] There is a conformance set of schemas that can be expressed in both TS and PSL; for that set, PSL-first emission and TS-first emission produce equivalent canonical `contract.json` (and stable hashes).
- [ ] The conformance suite is fixture-driven (data-driven): adding a parity case is adding a new fixture directory on disk containing the PSL schema input, the equivalent TS contract input, and an expected canonical `contract.json` snapshot (proposal: `test/integration/test/authoring/parity/<case>/`).
- [ ] Unsupported PSL constructs are documented as “not representable in Prisma Next contract authoring yet” (or “not representable by design”), with suggested alternatives when applicable.

## Documentation & tests

- [ ] Docs explain: how to choose PSL vs TS providers in config; how to run `contract emit`; where artifacts land; how to interpret errors.
- [ ] Tests cover: successful PSL emission, failure diagnostics, determinism, and TS↔PSL parity on the conformance set.

# Proposed architecture plan (draft for discussion)

This section is intentionally concrete so we can decide a plan together.

## Design principle

PSL is an **input format**, not a second contract model. Both authoring modes must feed the same emission pipeline:

Provider (TS/PSL) → Contract IR → normalize → validate → canonicalize/hash → emit JSON + `.d.ts`

## Where the work likely lives

- **Contract source providers (new)**: implement importable providers that produce `ContractIR` (via `Result<>`) so the CLI/control plane does not need to enumerate source kinds.
  - TS-first provider wraps the existing TS authoring surface.
  - PSL-first provider uses the PSL parser + normalization pipeline.
- **PSL parsing (reusable package)**: implement PSL parsing as a standalone package so other tools can reuse it (language tooling, external tooling, etc.).
  - **Decision:** build this in `packages/1-framework/2-authoring/psl-parser` (`@prisma-next/psl-parser`), which already exists as a placeholder.
  - Output should preserve source spans so we can produce great diagnostics.
- **Normalization**: convert that AST into the same normalized contract IR that TS-first ultimately produces.
- **Validation**: reuse existing validators; add PSL-specific validation for mapping PSL concepts onto the existing IR.
- **Types generation**: reuse the existing `.d.ts` generation logic (it should be driven by the validated IR/contract, not by PSL directly).
- **Config**: `prisma-next.config.ts` wires a provider for `contract.source` (provider-based authoring).

## Compatibility constraint (no new primitives)

When PSL has features that Prisma Next’s contract model doesn’t represent (yet), we must do one of:

1. Reject with a targeted error (“not supported in Prisma Next contract yet”).
2. Encode via an existing extension mechanism (namespaced attributes / blocks) **only if** there is already a corresponding representation in the current TS authoring surface and contract model.

**Design constraint (composition):** packs and extensions are composed via `prisma-next.config.ts`. PSL does not activate or pin packs. If an extension namespace is used in PSL but the pack is not composed in config, emission fails.

# PSL coverage plan (v1)

We’re intentionally making this **simple, not perfect**. v1 supports a clear subset that we can map to the existing Prisma Next contract IR without adding new primitives.

## Supported in v1 (must emit + participate in parity tests)

These are the v1 supported features. They also form the initial parity/conformance set (PSL-first and TS-first must agree at the normalized IR boundary for equivalent intent):

- Models + scalar fields
- Required vs optional fields
- `@id` (single-field primary key)
- `@unique` (single-field unique)
- `@@unique([…])` (compound unique)
- `@@index([…])` (basic index, columns only)
- Relations via `@relation(fields: […], references: […])`
- Referential actions, with the same supported set as the existing TypeScript authoring surface
- Enums
- Defaults:
  - `autoincrement()`
  - `now()`
  - literal defaults (boolean/number/string) where they map cleanly onto existing default representations
- Named type extensions (reusable, named storage type instances)
  - Prisma Next’s contract model supports named type instances via `storage.types` with column references via `typeRef`.
  - v1 PSL-first must be able to declare named types and reference them from fields, but this does **not** require supporting arbitrary namespaced extension attributes.
  - **Decision (PSL syntax, v1):** use a `types { ... }` top-level block to declare named type instances, then reference them by name in models.
    - Example:
      ```prisma
      types {
        Email = String
        Money = Decimal
      }

      model User {
        id    Int   @id
        email Email
        spend Money
      }
      ```
    - Emission mapping:
      - `types { ... }` entries become `storage.types.<Name> = { codecId, nativeType, typeParams }`
      - A field using a named type (e.g. `email Email`) becomes a column with `typeRef: "Email"` (not inlined `typeParams`)

- Extension-pack column typing for the initial conformance set (pgvector)
  - v1 supports a minimal subset of ADR 104: namespaced attributes sufficient to express a pgvector column and its parameters, producing the same contract as TS-first authoring.
  - Packs are composed via `prisma-next.config.ts` (e.g. `extensionPacks: [pgvector]`); PSL does not include a pack version pinning block.
  - Parity fixtures must include at least one pgvector case (Milestone 4).
  - Ergonomic upgrade: prefer declaring dimensioned vectors as named type instances via `types { ... }` and referencing them from fields (no new type-parameter syntax in PSL).

## Explicitly unsupported in v1 (strict errors)

Anything outside the supported set must fail with a strict, targeted error (not warnings), including (examples; not exhaustive):

- Namespaced extension-pack attributes / blocks (pack-specific syntax; see ADR 104) beyond the initial conformance set (pgvector column typing)
- Features that require storage primitives Prisma Next doesn’t model today (e.g. dialect-specific index methods/predicates if not representable)
- PSL constructs whose semantics can’t be expressed in the existing TS authoring surface/contract model without inventing new primitives

**Decision:** unsupported PSL features are **strict errors**. We prefer predictability over partial/ignored interpretation.

## Error behavior

- Errors must include a precise PSL source location and a short explanation of what’s unsupported.
- When there is a clear equivalent within the supported feature set, errors should suggest that alternative.

# Open Questions (for us to resolve next)

Decisions already made:

- **Config direction**: provider-based sources (pluggable providers returning `ContractIR` via `Result<>`), replacing the earlier discriminated union approach.
- **PSL parser package**: implement as a reusable package (`@prisma-next/psl-parser`).
- **Parity boundary**: enforce parity at the normalized contract IR boundary (and therefore on emitted `contract.json`).
- **Both sources present**: allowed; the config chooses the source of truth.
- **Initial conformance set**: models, scalars, required/optional, `@id`, `@unique`, `@@unique`, `@@index`, relations with `@relation(fields, references)`, referential actions, enums, defaults (`autoincrement()`, `now()`, literals), plus only the named-type extension mechanism defined in this spec.
- **Unsupported feature behavior**: strict errors (no “ignored metadata” warnings).
- **PSL schema path**: PSL-first requires an explicit schema path (no implicit `schema.prisma` default); this is enforced by the PSL provider’s API/validation.
- **Canonical artifacts**: `contract.json` contains no provenance and no top-level `sources` field (diagnostics-only).

Remaining questions:

- None.

# References

- `docs/Architecture Overview.md`
- `docs/architecture docs/subsystems/2. Contract Emitter & Types.md`
- `docs/architecture docs/subsystems/1. Data Contract.md`
- `docs/architecture docs/adrs/ADR 006 - Dual Authoring Modes.md`
- `packages/1-framework/3-tooling/cli/src/commands/contract-emit.ts`
- `projects/psl-contract-authoring/plans/plan.md`
- `projects/psl-contract-authoring/references/authoring-surface-gap-inventory.md`

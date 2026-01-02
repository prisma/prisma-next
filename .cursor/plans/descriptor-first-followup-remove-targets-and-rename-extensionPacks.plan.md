# Descriptor-first follow-up: remove `targets`, rename `extensions` → `extensionPacks`, and enforce required packs

## Context / Goals

This plan addresses the follow-up feedback after landing descriptor-first composition and pack refs:

- **Remove `targets` entirely** from descriptor and pack-ref metadata. Today it is both redundant (for target-bound descriptors, `targetId` is the real guardrail) and confusing (reads like DB-version semantics without enforcement).
- **Rename contract field `extensions` → `extensionPacks`**. The `extensions` field was intended to represent *framework extension packs required to fully evaluate/execute the contract*, not database extensions (those are handled by component database dependencies via migration planning).
- **Make required-pack checks real**:
- CLI composition should validate that config provides the packs required by `contract.extensionPacks`.
- Runtime initialization should validate that runtime composition includes those required packs (target + adapter + required extension packs).
- **Unify the declarative field shapes** between descriptors and pack refs (no near-duplicates like `ComponentDeclarativeFields` vs `PackRefDeclarativeFields`).
- **Make `.target()` pack-ref-only** and remove `TargetPackRefLike` duck-typing. Base authoring APIs should not accept string targets.
- **Clarify descriptor `version` semantics** and normalize first-party descriptors to `version: '0.0.1'` (pack version, not DB version).
- **Reduce “manifest” usage intentionally**:
- We do **not** do a blind “delete every `manifest` string” pass.
- We **categorize** the remaining “manifest” references and remove/rename those that represent obsolete concepts.

## Non-goals

- Introducing DB-version constraint enforcement (e.g., Postgres >= 12). If we need such a constraint in the future, we’ll add it with explicit naming (not the current `targets` map).
- Changing the DSL method name `.extensionPacks()` (we keep the name; we change semantics + wiring).
- Editing existing spec plan files under `agent-os/specs/**` that were previously marked as immutable for execution.

## Terminology

- **Descriptor**: a runtime/control-plane component descriptor (family/target/adapter/driver/extension).
- **Pack ref**: a JSON-friendly declarative object used at authoring time (TS contract builder) representing a component pack.
- **Extension pack**: a target-bound optional pack such as pgvector; required packs are listed in the contract as `extensionPacks`.

## Phasing and Commit Strategy

This work is large and breaking. Implement in small, coherent commits:

1. Remove `targets` field everywhere (descriptors, pack refs, docs/tests).
2. Normalize descriptor versions and document `version` semantics.
3. Unify declarative field interfaces (core → SQL) and migrate pack-ref types.
4. Make `.target()` pack-ref-only; remove `TargetPackRefLike` and string targets; update call sites.
5. Rename contract `extensions` → `extensionPacks` (types + builder + emitter + hashing + docs/tests).
6. Implement required-pack validation in CLI + runtime based on `extensionPacks`.
7. Decompose “manifest” references into categories and eliminate obsolete ones (config validation + pack-loading + types).
8. Full validation: build + typecheck + tests + lint:deps.

## Detailed Work Plan

### Phase 0 — Inventory and safety rails (no behavior change)

- Identify all remaining `targets` usages and `extensions` field usages.
- Identify all “manifest” reference clusters:
- **Cluster A**: config validation requiring `.manifest` on descriptors (obsolete)
- **Cluster B**: CLI `pack-loading` reading `packs/manifest.json` (obsolete if packs are descriptor-first)
- **Cluster C**: “manifest” types (`ExtensionPackManifest`, `OperationManifest`, `ExtensionPack`) used as serialized-view types (should be renamed/replaced)
- **Cluster D**: docs/tests/spec files referencing “manifest” (some immutable)

Deliverable: list of file groups and intended disposition (remove / rename / keep for now).---

### Phase 1 — Remove `targets` field entirely

#### 1.1 Core descriptor types

- In `packages/1-framework/1-core/shared/contract/src/framework-components.ts`:
- Remove `targets?: Record<string, { minVersion?: string }>` from the declarative fields shape.
- Remove any documentation comments describing “targets support”.

#### 1.2 Pack refs

- In `packages/2-sql/1-core/contract/src/pack-types.ts`:
- Remove `targets?` from the pack ref declarative fields.

#### 1.3 First-party descriptors and pack refs

Update every first-party descriptor and pack ref object to remove `targets: { postgres: { minVersion: '12' } }`, including (non-exhaustive):

- `packages/3-targets/3-targets/postgres/src/exports/control.ts`
- `packages/3-targets/3-targets/postgres/src/exports/runtime.ts`
- `packages/3-targets/6-adapters/postgres/src/exports/control.ts`
- `packages/3-targets/6-adapters/postgres/src/exports/runtime.ts`
- `packages/3-targets/7-drivers/postgres/src/exports/control.ts`
- `packages/3-targets/7-drivers/postgres/src/exports/runtime.ts`
- `packages/3-targets/3-targets/postgres/src/exports/pack.ts`
- `packages/3-extensions/pgvector/src/exports/control.ts`
- `packages/3-extensions/pgvector/src/exports/runtime.ts`
- `packages/3-extensions/pgvector/src/exports/pack.ts`

#### 1.4 Tests/docs

- Update any tests asserting `descriptor.targets` (e.g. pgvector manifest test).
- Update package READMEs that mention `targets` or show examples including it.

Acceptance criteria:

- No code references to `.targets` on descriptors or pack refs.
- Build + typecheck passes.

---

### Phase 2 — Normalize descriptor version semantics

#### 2.1 Define semantics (single source)

- Update the descriptor base type docs to clearly define:
- `version` is the **pack version** (component pack version), not DB version.
- It is used for contract emission + compatibility surfaces, not DB runtime negotiation.

#### 2.2 Normalize first-party versions

- Set all first-party descriptors and pack refs to `version: '0.0.1'`:
- Postgres target/adapter/driver descriptors (control/runtime)
- Pgvector extension descriptor (control/runtime)
- Postgres pack ref + pgvector pack ref

Acceptance criteria:

- No first-party descriptors/packs use Postgres DB version strings.
- Docs show the intended meaning.

---

### Phase 3 — Consolidate declarative field interfaces (core → SQL)

Goal: remove confusing duplication (`ComponentDeclarativeFields` vs `PackRefDeclarativeFields`).

#### 3.1 New shared interface name + placement

- In core contract package (`packages/1-framework/1-core/shared/contract/src/framework-components.ts`):
- Either:
    - Inline declarative fields on `ComponentDescriptor`, **or**
    - Keep a named interface but rename to something explicit (recommended): `DescriptorDeclarativeFields`.
- This interface includes: `version`, `capabilities`, `types`, `operations` (and NOT `targets`).

#### 3.2 Pack ref types reuse the shared interface

- In SQL contract package (`packages/2-sql/1-core/contract/src/pack-types.ts`):
- Replace `PackRefDeclarativeFields` with an import/reuse of the shared core interface.
- If SQL needs to refine `types.storage`, do it by extending the shared interface with a SQL-specific `storage` shape, not by duplicating the entire surface.

Acceptance criteria:

- Only one canonical “declarative field” interface exists; SQL pack refs reuse or extend it.

---

### Phase 4 — Remove `TargetPackRefLike` and make `.target()` pack-ref-only

Goal: eliminate duck typing and string targets.

#### 4.1 Define core pack-ref base types

- Add core pack-ref interfaces in a core location (framework domain), e.g.:
- `TargetPackRefBase` (kind/id/familyId/targetId/version/capabilities/types/operations)
- Possibly generalized `PackRefBase` + `TargetPackRefBase`

This must avoid importing SQL-domain packages.

#### 4.2 Update base contract builder

- In `packages/1-framework/2-authoring/contract/src/contract-builder.ts`:
- Remove `TargetPackRefLike`.
- Change `target()` to accept only a pack ref type.
- Remove any remaining string overloads.

#### 4.3 Update SQL builder

- In `packages/2-sql/2-authoring/contract-ts/src/contract-builder.ts`:
- Ensure `.target()` accepts only `TargetPackRef<'sql', T>` (or a refined SQL pack ref type).
- Update tests and fixtures that still pass strings.

Acceptance criteria:

- `.target('postgres')` is no longer supported anywhere.
- All tests/examples updated to pass pack refs.

---

### Phase 5 — Rename contract field `extensions` → `extensionPacks`

Goal: reflect intended semantics and enable required-pack validation.

#### 5.1 Core types and IR

- In `packages/1-framework/1-core/shared/contract/src/types.ts`:
- Rename `ContractBase.extensions` → `ContractBase.extensionPacks`.
- In `packages/1-framework/1-core/shared/contract/src/ir.ts`:
- Rename `ContractIR.extensions` → `ContractIR.extensionPacks`.
- Update `irMeta()` helpers accordingly.

#### 5.2 Emitter and hashing

- Update `packages/1-framework/1-core/migration/control-plane/src/emission/*`:
- Canonicalization includes the renamed field.
- Hashing uses `extensionPacks`.
- Emission wiring uses `ir.extensionPacks`.

#### 5.3 SQL builder output

- In SQL contract builder (`packages/2-sql/2-authoring/contract-ts/src/contract-builder.ts`):
- Emit `extensionPacks` instead of `extensions`.
- Keep `.extensionPacks()` DSL but write into `extensionPacks` field in the contract.

#### 5.4 Call sites

- Update all uses of `contract.extensions` throughout the repo:
- schema verification tooling
- tests and fixtures
- docs

Acceptance criteria:

- No production code reads/writes `contract.extensions` (only `extensionPacks`).
- Hashing and marker verification still behave correctly with the new field.

---

### Phase 6 — Required-pack validation (CLI + runtime)

Goal: if contract requires packs, CLI/runtime must ensure those packs are present.

#### 6.1 Decide contract shape for `extensionPacks`

Use the existing object map approach from builder:

```ts
extensionPacks: {
  pgvector: {},
  // possibly include pack version metadata later
}
```

In Phase 6, treat the keys as required pack IDs.

#### 6.2 CLI validation

Where:

- CLI already has config descriptors: `config.target`, `config.adapter`, `config.extensions`, `config.driver?`.

Add:

- A helper `assertContractPacksSatisfied(contract, providedDescriptors)`:
- `contract.target` must match config.target.targetId.
- Required extension pack IDs in `contract.extensionPacks` must be present in `config.extensions`.
- (Optional) include adapter/target IDs in required checks if we decide contract requires them; initially, enforce only extension packs + target match.

Wire into commands that load contract + config:

- `db-*` commands
- `emit` if it uses contract source and wants to validate composition, depending on existing behavior

#### 6.3 Runtime validation

Where:

- `createSqlRuntimeFamilyInstance()` has access to runtime descriptors at construction time.

Add:

- When creating runtime context or runtime, validate:
- contract.target matches descriptor targetId
- for each key in `contract.extensionPacks`, there is a runtime extension descriptor with `id` matching that key
- (keep family/target guardrail: extensions already target-bound, but validate anyway for safety)

Acceptance criteria:

- Contract that requires `pgvector` fails fast if runtime is created without pgvector descriptor.
- Same for CLI commands that require DB connection: they fail before executing work.

---

### Phase 7 — “Manifest” reference reduction (categorized, not blanket)

#### 7.1 Remove obsolete `.manifest` requirements in config validation

- Update `packages/1-framework/1-core/migration/control-plane/src/config-validation.ts` to:
- stop requiring `.manifest` on family/target/adapter/driver/extension descriptors
- validate flattened descriptor fields instead (e.g., `version` exists and is string, `kind/id/familyId/targetId/create` exist)

This directly addresses the broken legacy pattern.

#### 7.2 Remove disk-based manifest pack loading (or re-scope it)

- Update `packages/1-framework/3-tooling/cli/src/pack-loading.ts`:
- either remove it entirely, or
- re-scope it to load descriptor modules instead of JSON manifests.

Given pack refs and descriptors are TS-first now, JSON manifests are obsolete for first-party packs.

#### 7.3 Rename or relocate manifest types

- `OperationManifest` / `ExtensionPackManifest` types currently exist in core contract types.
- If they represent a *serialized descriptor view*, rename them to `OperationDescriptor` / `PackDescriptorSnapshot` or similar.
- Alternatively, move them to CLI-only types if still needed for disk-loaded pack formats.

Acceptance criteria:

- No production code expects `.manifest` on descriptors.
- CLI no longer depends on `packs/manifest.json` for first-party packs.
- “manifest” remains only where it truly represents a serialized file format (if any).

---

### Phase 8 — Validation and CI hygiene

Run:

- `pnpm build`
- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm lint:deps`

If integration/e2e tests require network permissions in the sandbox, run them with `required_permissions: ['network']`.

## Notes / Risks

- Renaming contract fields (`extensions` → `extensionPacks`) changes hashing inputs and therefore affects marker/profile hash comparison. This is intended but must be coordinated with any existing marker fixtures.
- Removing `.targets` and normalizing versions will require updating docs/tests and any examples that copy-paste descriptor objects.
- Removing manifest pack-loading likely changes CLI test fixtures; update fixtures accordingly (and exclude fixture files from typechecking where required).

## Deliverables

- Code changes implementing Phases 1–7
- Updated docs and READMEs reflecting the new contract field name and descriptor semantics
- Required-pack validation implemented in both CLI and runtime
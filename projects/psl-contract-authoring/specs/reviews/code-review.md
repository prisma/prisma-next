## Summary

Re-review against the updated spec/plan finds multiple **spec-violating built-ins and hardcoded maps**. The intended direction (“registry is the single source of truth; no generator special cases outside the registry; no default target in PSL”) is not met yet, so this is **not merge-ready** under the clarified constraints.

## Resolution status (2026-03-03)

- [x] BLOCK-F05 — Removed PSL default target fallback; interpreter now requires explicit target context input.
- [x] BLOCK-F06.1 — Removed hardcoded scalar map from interpreter; scalar descriptors are composed inputs.
- [x] BLOCK-F06 — Removed hardcoded generated-id storage maps/special-casing from interpreter; generator descriptors own generated-column resolution.
- [x] BLOCK-F07 — Re-homed built-in default-function semantics to composed Postgres contributor code.
- [x] BLOCK-F08 — Re-homed built-in generator applicability metadata to contributor-owned descriptors.
- [x] BLOCK-F09 — Centralized generator storage metadata in `@prisma-next/ids` and reused in both TS authoring + composed descriptors.
- [x] BLOCK-F10 — Removed runtime built-in generator table from `sql-runtime`; built-ins are contributed by adapter composition.
- [x] BLOCK-F11 — Removed built-in registry factories/exports from `sql-contract-psl`.
- [x] BLOCK-F12 — Removed provider-local assembly; provider now consumes preassembled inputs.
- [x] F00.2/F01 — Unknown-function diagnostics now derive signatures from registry entries (`usageSignatures`) with fallback.
- [x] F02 — Duplicate runtime generator errors now include both `existingOwner` and `incomingOwner`.
- [x] F03 — Family assembly now uses a minimal callable handler type instead of `unknown`.

## What looks solid

- **Spec/ADR alignment**: declared applicability by `codecId`, composition-first extension seam, and runtime “existence only” validation all match the documented intent.
  - Spec acceptance criteria: [projects/psl-contract-authoring/specs/Follow-up - Pack-provided mutation default functions registry.spec.md (L114–L141)](../Follow-up%20-%20Pack-provided%20mutation%20default%20functions%20registry.spec.md:114-141)
  - ADR decision: [docs/architecture docs/adrs/ADR 169 - Declared applicability for mutation default generators.md (L43–L73)](../../../../docs/architecture%20docs/adrs/ADR%20169%20-%20Declared%20applicability%20for%20mutation%20default%20generators.md:43-73)
- **Clear control-plane SPI** for lowering handlers + diagnostics + span fidelity.
  - [packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts (L10–L52)](../../../../packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts:10-52)
- **Targeted runtime failure mode** for missing generator ids (`RUNTIME.MUTATION_DEFAULT_GENERATOR_MISSING`) with focused test coverage.
  - Implementation: [packages/2-sql/5-runtime/src/sql-context.ts (L403–L422)](../../../../packages/2-sql/5-runtime/src/sql-context.ts:403-422)
  - Tests: [packages/2-sql/5-runtime/test/mutation-default-generators.test.ts (L98–L127)](../../../../packages/2-sql/5-runtime/test/mutation-default-generators.test.ts:98-127)
- **Deterministic duplicate rejection** is enforced and tested in the SQL family assembly.
  - [packages/2-sql/3-tooling/family/test/mutation-default-assembly.test.ts (L79–L147)](../../../../packages/2-sql/3-tooling/family/test/mutation-default-assembly.test.ts:79-147)

## Blocking issues

### BLOCK-F05 — PSL interpreter embeds a Postgres default target

- **Location**: [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts (L42–L49)](../../../../packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:42-49)
- **Issue**: vocabulary-driven authoring (PSL) is not permitted to embed a “default target” (especially not a Postgres-specific one). The PSL interpreter must only function when a target is provided by the framework stack/composition layer; it must not guess or default.
- **Suggestion**: make target selection mandatory at the call site (control-plane composition layer / CLI wiring) and plumb a target-bound interpretation context into PSL interpretation. The PSL interpreter should reject interpretation when no target context is provided (rather than defaulting).

### BLOCK-F06.1 — PSL interpreter hardcodes target-specific scalar→codec/native mappings

- **Location**: [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts (L51–L61)](../../../../packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:51-61)
- **Issue**: the updated spec explicitly forbids authoring-surface hardcoded target mappings. `SCALAR_COLUMN_MAP` hardcodes Postgres codec/native types directly in the PSL interpreter.
- **Suggestion**: move scalar type→codec/native mapping behind composed, target-bound inputs (provided by the framework stack), so PSL interpretation remains target-agnostic.

### BLOCK-F06 — PSL interpreter hardcodes generated-id storage descriptors

- **Location**: [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts (L63–L67)](../../../../packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:63-67)
- **Issue**: this is exactly what the mutation-default registry is supposed to replace: generator-owned storage-shape facts (like `sql/char@1` + `length`) are hardcoded in the interpreter. This is a drift risk and violates the “no hardcoded maps” constraint for PSL.
- **Additional issue**: the interpreter also special-cases generator ids (e.g. `nanoid`) to derive storage shapes from params, which is still generator semantics embedded in PSL code.
  - [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts (L73–L86)](../../../../packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:73-86)
- **Suggestion**: replace *all* generator-id special casing and hardcoded maps with registry-provided inputs (e.g. descriptors that include the generated column’s storage descriptor shape, potentially parameterized), so PSL interpretation is fully registry-driven.

### BLOCK-F07 — `sql-contract-psl` hardcodes built-in generator semantics in default-function lowering

- **Location**: [packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts (L278–L468)](../../../../packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts:278-468)
- **Issue**: function-level semantics for generator-backed defaults are encoded directly in `sql-contract-psl` (e.g. `uuid()`/`uuid(7)` → `uuidv4`/`uuidv7`, `cuid(2)` → `cuid2`, `nanoid(n)` → `{ size }`). Per the desired direction, vocabulary-driven authoring should not special-case generator functions; it should consume a composed registry that defines function vocabulary + arg rules + lowering behavior.
- **Suggestion**: move these semantics behind the composed registry contribution surface (baseline built-ins contributed by target/adapter/packs), so `sql-contract-psl` is purely a registry consumer.

### BLOCK-F08 — Built-in generator applicability metadata is hardcoded instead of registry-owned

- **Location**: [packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts (L505–L528)](../../../../packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts:505-528)
- **Issue**: built-in generator ids and their applicability (`applicableCodecIds`) are hardcoded in `sql-contract-psl`. If the registry is the source of truth, this metadata should come from composed contributors (baseline included), not be embedded in the authoring surface.
- **Suggestion**: have baseline components contribute generator descriptors (including applicability and any parameterized storage-shape metadata needed for column typing) via the registry, and have PSL consume it.

### BLOCK-F09 — TS authoring `@prisma-next/ids` hardcodes generated-column storage descriptors

- **Location**: [packages/1-framework/2-authoring/ids/src/index.ts (L11–L36)](../../../../packages/1-framework/2-authoring/ids/src/index.ts:11-36)
- **Issue**: generator-specific storage-shape facts (e.g. `ksuid` → char length 27, `cuid2` → 24, `nanoid` → 21) are hardcoded in TS authoring helpers. This is the same drift vector as PSL’s `GENERATED_ID_COLUMN_MAP`, just in a different surface.
- **Suggestion**: make the registry the single source of truth for generator-owned storage-shape metadata (including any parameterization like nanoid sizing), and have both TS authoring helpers and PSL interpretation consume it.

### BLOCK-F10 — Runtime still has a built-in generator id list in `sql-runtime`

- **Location**: [packages/2-sql/5-runtime/src/sql-context.ts (L154–L171)](../../../../packages/2-sql/5-runtime/src/sql-context.ts:154-171)
- **Issue**: runtime composition is supposed to resolve generator ids via composed components, with baseline built-ins provided as normal contributors. A central `builtinMutationDefaultGeneratorIds` list hardcodes the baseline vocabulary in the runtime layer.
- **Suggestion**: move baseline generator provisioning into composed components (adapter/target/packs) and remove the runtime-layer built-in id list.

### BLOCK-F11 — `sql-contract-psl` contains built-in registry factories and exports

- **Location**: [packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts (L493–L535)](../../../../packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts:493-535)
- **Issue**: the updated spec forbids built-in tables/special cases in vocabulary-driven authoring packages. `createBuiltinDefaultFunctionRegistry`, `createBuiltinMutationDefaultGeneratorDescriptors`, and `createBuiltinControlMutationDefaults` embed baseline behavior inside `sql-contract-psl` (and are exported).
- **Suggestion**: re-home baseline contributions into composed components (target/adapter/packs) and keep `sql-contract-psl` as a pure consumer of `controlMutationDefaults` (or equivalent registry inputs).

### BLOCK-F12 — `sql-contract-psl` provider assembles registries internally

- **Location**: [packages/2-sql/2-authoring/contract-psl/src/provider.ts (L59–L76)](../../../../packages/2-sql/2-authoring/contract-psl/src/provider.ts:59-76)
- **Issue**: the updated spec/plan states authoring packages consume assembled registries as inputs and do not own assembly. The provider helper currently assembles `controlMutationDefaults` from `frameworkComponents` inside `sql-contract-psl`.
- **Suggestion**: move assembly ownership to control-plane composition/orchestration and pass assembled registries into the PSL provider/interpreter entrypoints.

## Non-blocking concerns

### F00 — Prior review feedback to address (mainline)

This section captures reviewer feedback that predates the work in this branch, but is relevant to correctness/maintainability.

### F00.1 — Generated-ID column descriptors are duplicated across surfaces

- **Location**:
  - PSL interpreter: [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts (L70–L87)](../../../../packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:70-87)
  - TS helper source of truth: [packages/1-framework/2-authoring/ids/src/index.ts (L11–L36)](../../../../packages/1-framework/2-authoring/ids/src/index.ts:11-36)
- **Issue**: the PSL interpreter reconstructs generated-id storage descriptors (e.g. `sql/char@1` length), duplicating the mapping that TS authoring already owns. This is easy to drift.
- **Suggestion**:
  - Extract/centralize the mapping in `@prisma-next/ids` (or a small shared leaf) and have PSL use it, or
  - Move generator-owned descriptor metadata to a shared contract-authoring location that both TS authoring and PSL can consume.
  - (Superseded by **BLOCK-F06** / **BLOCK-F09**: the preferred direction is “registry is the source of truth”, not “PSL depends on ids”.)

### F00.2 — Unknown-function messaging uses a small hand-maintained signature map

- **Location**: [packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts (L470–L491)](../../../../packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts:470-491)
- **Issue**: `supportedFunctionUsageByName` improves message quality, but it’s another place to keep in sync with the registry’s supported surface.
- **Suggestion**: keep it intentionally minimal, and add a unit test that ensures every registry key either has a curated usage list entry or falls back to `${name}()`.

### F01 — Unknown-function help text may be misleading for contributed functions

- **Location**: [packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts (L486–L491)](../../../../packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts:486-491)
- **Issue**: unknown-function diagnostics enumerate supported functions by registry key, but fall back to showing `fn()` when the function isn’t one of the built-in signatures. For a contributed handler that expects arguments, the “supported functions” list can suggest the wrong usage.
- **Suggestion**: consider an optional contribution surface for “usage signatures” (or a handler-provided `usage` list) so diagnostics can remain accurate without hardcoding built-in function names.

### F02 — Runtime duplicate-generator errors lack “incoming owner” metadata

- **Location**: [packages/2-sql/5-runtime/src/sql-context.ts (L375–L399)](../../../../packages/2-sql/5-runtime/src/sql-context.ts:375-399)
- **Issue**: `RUNTIME.DUPLICATE_MUTATION_DEFAULT_GENERATOR` includes `existingOwner` but not the incoming contributor id, which makes debugging collisions slightly harder in larger compositions.
- **Suggestion**: include both `existingOwner` and `incomingOwner` in the error meta payload (and/or message), mirroring the clarity of control-plane duplicate messages.

### F03 — Family control-plane types erase default-function handler types

- **Location**:
  - [packages/2-sql/3-tooling/family/src/core/migrations/types.ts (L28–L37)](../../../../packages/2-sql/3-tooling/family/src/core/migrations/types.ts:28-37)
  - [packages/2-sql/3-tooling/family/src/core/assembly.ts (L255–L283)](../../../../packages/2-sql/3-tooling/family/src/core/assembly.ts:255-283)
- **Issue**: `defaultFunctionRegistry: ReadonlyMap<string, unknown>` is understandable for layering, but it makes it easy to accidentally assemble an incompatible handler shape without type feedback at the assembly site.
- **Suggestion**: if this registry is intended to be passed into typed consumers, consider moving the handler type (or a minimal callable signature) to a leaf “types-only” package that both layers can depend on.

### F04 — `sql-contract-psl` owns assembly but should consume an input registry

- **Location**:
  - Assembly helper lives in `sql-contract-psl`: [packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts (L537–L589)](../../../../packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts:537-589)
  - Provider helper assembles from `frameworkComponents`: [packages/2-sql/2-authoring/contract-psl/src/provider.ts (L59–L76)](../../../../packages/2-sql/2-authoring/contract-psl/src/provider.ts:59-76)
- **Issue**: per the desired ownership boundary, `@prisma-next/sql-contract-psl` should be responsible for **interpretation given a composed registry**, not for **assembling** that registry. Keeping assembly logic in the interpreter package blurs layering and creates two “assembly homes” (`contract-psl` and `family-sql`).
- **Suggestion**: move assembly ownership to a control-plane composition layer (e.g. `family-sql` / CLI orchestration), and treat `sql-contract-psl` as a consumer that accepts `controlMutationDefaults` (or equivalent) as an input.
(Escalated by the updated spec: see **BLOCK-F12**.)

## Nits

- None.

## Acceptance-criteria traceability

Source of truth: [projects/psl-contract-authoring/specs/Follow-up - Pack-provided mutation default functions registry.spec.md (L114–L141)](../Follow-up%20-%20Pack-provided%20mutation%20default%20functions%20registry.spec.md:114-141)

### SPI and Assembly

- **AC**: Component contributes a default-function handler; PSL recognizes it without provider changes.
  - **Implementation**:
    - Handler SPI: [packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts (L32–L37)](../../../../packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts:32-37)
    - Interpreter uses registry: [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts (L303–L322)](../../../../packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:303-322)
  - **Evidence**:
    - [packages/2-sql/2-authoring/contract-psl/test/composed-mutation-defaults.test.ts (L35–L82)](../../../../packages/2-sql/2-authoring/contract-psl/test/composed-mutation-defaults.test.ts:35-82)
- **AC**: Component contributes a runtime generator implementation; runtime uses it without hardcoding changes.
  - **Implementation**:
    - Registry assembly: [packages/2-sql/5-runtime/src/sql-context.ts (L375–L401)](../../../../packages/2-sql/5-runtime/src/sql-context.ts:375-401)
    - Lookup + invocation: [packages/2-sql/5-runtime/src/sql-context.ts (L403–L422)](../../../../packages/2-sql/5-runtime/src/sql-context.ts:403-422)
  - **Evidence**:
    - [packages/2-sql/5-runtime/test/mutation-default-generators.test.ts (L56–L97)](../../../../packages/2-sql/5-runtime/test/mutation-default-generators.test.ts:56-97)
- **AC**: Component declares applicability for a generator id without bespoke authoring-surface logic.
  - **Implementation**:
    - Descriptor: [packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts (L39–L47)](../../../../packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts:39-47)
    - Interpreter checks `applicableCodecIds`: [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts (L323–L345)](../../../../packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:323-345)
  - **Evidence**:
    - [packages/2-sql/2-authoring/contract-psl/test/composed-mutation-defaults.test.ts (L84–L126)](../../../../packages/2-sql/2-authoring/contract-psl/test/composed-mutation-defaults.test.ts:84-126)
- **AC**: Assembly order + duplicate handling are deterministic and tested.
  - **Implementation**:
    - Family assembly: [packages/2-sql/3-tooling/family/src/core/assembly.ts (L255–L283)](../../../../packages/2-sql/3-tooling/family/src/core/assembly.ts:255-283)
  - **Evidence**:
    - [packages/2-sql/3-tooling/family/test/mutation-default-assembly.test.ts (L20–L77)](../../../../packages/2-sql/3-tooling/family/test/mutation-default-assembly.test.ts:20-77)
    - [packages/2-sql/3-tooling/family/test/mutation-default-assembly.test.ts (L79–L147)](../../../../packages/2-sql/3-tooling/family/test/mutation-default-assembly.test.ts:79-147)

### Emission and Diagnostics

- **AC**: PSL emission uses an assembled registry derived from configured framework components.
  - **Implementation**:
    - Interpreter consumes `controlMutationDefaults` as an input: [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts (L33–L40)](../../../../packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:33-40)
    - Current provider helper assembles and passes `controlMutationDefaults`: [packages/2-sql/2-authoring/contract-psl/src/provider.ts (L59–L76)](../../../../packages/2-sql/2-authoring/contract-psl/src/provider.ts:59-76) (see **F04** on assembly ownership)
  - **Evidence**:
    - [packages/2-sql/2-authoring/contract-psl/test/composed-mutation-defaults.test.ts (L35–L82)](../../../../packages/2-sql/2-authoring/contract-psl/test/composed-mutation-defaults.test.ts:35-82)
    - Postgres built-ins contributed via adapter: [packages/3-targets/6-adapters/postgres/src/exports/control.ts (L10–L17)](../../../../packages/3-targets/6-adapters/postgres/src/exports/control.ts:10-17)
- **AC**: Unknown and invalid-arg diagnostics remain span-based and stable.
  - **Implementation**:
    - Unknown function diagnostic: [packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts (L591–L611)](../../../../packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts:591-611)
    - Invalid argument diagnostic helper: [packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts (L210–L224)](../../../../packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts:210-224)
  - **Evidence**:
    - Composed registry test asserts unknown diagnostics when no contributors exist: [packages/2-sql/2-authoring/contract-psl/test/composed-mutation-defaults.test.ts (L10–L33)](../../../../packages/2-sql/2-authoring/contract-psl/test/composed-mutation-defaults.test.ts:10-33)

### Runtime Behavior

- **AC**: Runtime resolves built-in generator ids through the assembled registry (regression guard).
  - **Implementation**:
    - Postgres adapter contributes built-ins: [packages/3-targets/6-adapters/postgres/src/exports/runtime.ts (L65–L75)](../../../../packages/3-targets/6-adapters/postgres/src/exports/runtime.ts:65-75)
  - **Evidence**:
    - Built-in generator creation is centralized: [packages/2-sql/5-runtime/src/sql-context.ts (L154–L171)](../../../../packages/2-sql/5-runtime/src/sql-context.ts:154-171)
- **AC**: Runtime resolves pack-provided generator ids through the assembled registry.
  - **Implementation / Evidence**:
    - [packages/2-sql/5-runtime/test/mutation-default-generators.test.ts (L56–L97)](../../../../packages/2-sql/5-runtime/test/mutation-default-generators.test.ts:56-97)
- **AC**: Missing generator id fails with a clear, stable error.
  - **Implementation / Evidence**:
    - [packages/2-sql/5-runtime/test/mutation-default-generators.test.ts (L98–L127)](../../../../packages/2-sql/5-runtime/test/mutation-default-generators.test.ts:98-127)

### Compatibility and Migration

- **AC**: Documentation explains where default-function vocabulary comes from and how to extend it through packs.
  - **Evidence**:
    - [packages/2-sql/2-authoring/contract-psl/README.md (L16–L66)](../../../../packages/2-sql/2-authoring/contract-psl/README.md:16-66)
    - Parity fixture demonstrating a pack contribution: [test/integration/test/authoring/parity/default-pack-slugid/packs.ts (L1–L49)](../../../../test/integration/test/authoring/parity/default-pack-slugid/packs.ts:1-49)


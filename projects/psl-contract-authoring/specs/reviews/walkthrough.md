closes [TML-2025](https://linear.app/prisma-company/issue/TML-2025/follow-up-pack-provided-mutation-default-functions-registry-remove-psl)

## Key snippet(s)

### New (runtime: generator ids resolved via composed registry)
```ts
// NEW — generator ids are resolved via a composed registry
const generator = generatorRegistry.get(spec.id);
if (!generator) {
  throw runtimeError(
    'RUNTIME.MUTATION_DEFAULT_GENERATOR_MISSING',
    `Contract references mutation default generator '${spec.id}' but no runtime component provides it.`,
    { id: spec.id },
  );
}
return generator.generate(spec.params);
```

## Intent
Make mutation default behavior **component-composable** end-to-end: emit-time PSL lowering uses an assembled default-function vocabulary + declared applicability metadata, and runtime mutation-default application resolves generator ids via an assembled registry (with stable missing-id errors).

## Change map
- **Implementation**:
  - [packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts (L10–L252)](packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts)
  - [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts (L202–L547)](packages/2-sql/2-authoring/contract-psl/src/interpreter.ts)
  - [packages/2-sql/2-authoring/contract-psl/src/provider.ts (L11–L64)](packages/2-sql/2-authoring/contract-psl/src/provider.ts)
  - [packages/2-sql/3-tooling/family/src/core/assembly.ts (L228–L284)](packages/2-sql/3-tooling/family/src/core/assembly.ts)
  - [packages/2-sql/5-runtime/src/sql-context.ts (L352–L399)](packages/2-sql/5-runtime/src/sql-context.ts)
  - [packages/3-targets/6-adapters/postgres/src/core/control-mutation-defaults.ts (L1–L120)](packages/3-targets/6-adapters/postgres/src/core/control-mutation-defaults.ts)
  - [packages/3-targets/6-adapters/postgres/src/exports/control.ts (L14–L27)](packages/3-targets/6-adapters/postgres/src/exports/control.ts)
  - [packages/3-targets/6-adapters/postgres/src/exports/runtime.ts (L48–L56)](packages/3-targets/6-adapters/postgres/src/exports/runtime.ts)
- **Tests (evidence)**:
  - [packages/2-sql/2-authoring/contract-psl/test/composed-mutation-defaults.test.ts (L9–L127)](packages/2-sql/2-authoring/contract-psl/test/composed-mutation-defaults.test.ts)
  - [packages/2-sql/3-tooling/family/test/mutation-default-assembly.test.ts (L19–L148)](packages/2-sql/3-tooling/family/test/mutation-default-assembly.test.ts)
  - [packages/2-sql/5-runtime/test/mutation-default-generators.test.ts (L55–L128)](packages/2-sql/5-runtime/test/mutation-default-generators.test.ts)
  - [test/integration/test/authoring/parity/default-pack-slugid/packs.ts (L1–L49)](test/integration/test/authoring/parity/default-pack-slugid/packs.ts)

## The story
1. **Define an explicit control-plane vocabulary + applicability model**. A `ControlMutationDefaults` contribution bundles a default-function lowering registry and generator descriptors that declare applicable `codecId`s, plus assembly rules that fail on duplicates.
2. **Make PSL lowering consume composed registries**. The PSL interpreter lowers `@default(...)` calls via the registry, then validates declared applicability by comparing the column’s `codecId` to the generator descriptor’s `applicableCodecIds`.
3. **Make control-plane assembly deterministic and testable**. The SQL family assembly collects contributions deterministically and rejects collisions, so CLI/control-plane consumers can build the same registry given the same component composition.
4. **Resolve runtime generator ids via composition**. SQL runtime execution context construction collects `mutationDefaultGenerators()` from target/adapter/packs, and `applyMutationDefaults` resolves generator ids from that registry with a stable missing-id error.
5. **Prove pack extensibility in parity fixtures and focused unit tests**. New tests demonstrate both lowering-time pack vocabulary contributions and runtime generator resolution behavior.

## Behavior changes & evidence
- **PSL default-function support is registry-driven**: PSL `@default(uuid())` is only accepted when composed components contribute the `uuid` handler; otherwise it fails as unknown.
  - **Why**: makes vocabulary-driven authoring (PSL) a consumer of a system-wide composition seam rather than a provider-hardcoded special case.
  - **Implementation**:
    - [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts (L202–L269)](packages/2-sql/2-authoring/contract-psl/src/interpreter.ts)
    - [packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts (L232–L252)](packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts)
  - **Tests**:
    - [packages/2-sql/2-authoring/contract-psl/test/composed-mutation-defaults.test.ts (L10–L33)](packages/2-sql/2-authoring/contract-psl/test/composed-mutation-defaults.test.ts)

- **Applicability is enforced at emit-time using declared codec ids**: `@default(slugid())` lowers to an execution default only when the generator descriptor declares applicability to the column’s `codecId`; otherwise it emits a targeted diagnostic.
  - **Why**: avoids brittle “type inference” compatibility checks and keeps validation deterministic (ADR 169).
  - **Implementation**:
    - [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts (L275–L294)](packages/2-sql/2-authoring/contract-psl/src/interpreter.ts)
  - **Tests**:
    - [packages/2-sql/2-authoring/contract-psl/test/composed-mutation-defaults.test.ts (L84–L126)](packages/2-sql/2-authoring/contract-psl/test/composed-mutation-defaults.test.ts)

- **Runtime mutation defaults resolve generator ids through composed components**: runtime no longer relies on hardwired generator wiring; it looks up `execution.mutations.defaults[*].onCreate.id` in the assembled registry, and throws a stable error when missing.
  - **Why**: makes generator ids extensible via packs and keeps runtime behavior aligned with the contract’s declared ids.
  - **Implementation**:
    - [packages/2-sql/5-runtime/src/sql-context.ts (L381–L399)](packages/2-sql/5-runtime/src/sql-context.ts)
  - **Tests**:
    - [packages/2-sql/5-runtime/test/mutation-default-generators.test.ts (L56–L97)](packages/2-sql/5-runtime/test/mutation-default-generators.test.ts)
    - [packages/2-sql/5-runtime/test/mutation-default-generators.test.ts (L98–L127)](packages/2-sql/5-runtime/test/mutation-default-generators.test.ts)

## Compatibility / migration / risk
- **API surface**: PSL interpretation/provider now requires explicit `target` + `scalarTypeDescriptors` inputs, and accepts composed `controlMutationDefaults` as an optional input; there is no default target or provider-local assembly.
- **Runtime**: contracts that reference generator ids not provided by the composed runtime stack now fail early and clearly (`RUNTIME.MUTATION_DEFAULT_GENERATOR_MISSING`).

## Non-goals / intentionally out of scope
- Expanding PSL default-function syntax beyond what’s needed to prove the registry seam.
- Adding predicate-based applicability (v1 is `codecId`-only).

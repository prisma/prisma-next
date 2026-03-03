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

## Sources
- Spec: [projects/psl-contract-authoring/specs/Follow-up - Pack-provided mutation default functions registry.spec.md](../Follow-up%20-%20Pack-provided%20mutation%20default%20functions%20registry.spec.md)
- ADR: [docs/architecture docs/adrs/ADR 169 - Declared applicability for mutation default generators.md](../../../../docs/architecture%20docs/adrs/ADR%20169%20-%20Declared%20applicability%20for%20mutation%20default%20generators.md)
- Commit range: `origin/main...HEAD`

## Intent
Make mutation default behavior **component-composable** end-to-end: emit-time PSL lowering uses an assembled default-function vocabulary + declared applicability metadata, and runtime mutation-default application resolves generator ids via an assembled registry (with stable missing-id errors).

## Change map
- **Implementation**:
  - [packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts (L10–L613)](../../../../packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts:10-613)
  - [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts (L250–L345)](../../../../packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:250-345)
  - [packages/2-sql/2-authoring/contract-psl/src/provider.ts (L55–L76)](../../../../packages/2-sql/2-authoring/contract-psl/src/provider.ts:55-76)
  - [packages/2-sql/3-tooling/family/src/core/assembly.ts (L228–L284)](../../../../packages/2-sql/3-tooling/family/src/core/assembly.ts:228-284)
  - [packages/2-sql/5-runtime/src/sql-context.ts (L375–L516)](../../../../packages/2-sql/5-runtime/src/sql-context.ts:375-516)
  - [packages/3-targets/6-adapters/postgres/src/exports/control.ts (L1–L19)](../../../../packages/3-targets/6-adapters/postgres/src/exports/control.ts:1-19)
  - [packages/3-targets/6-adapters/postgres/src/exports/runtime.ts (L65–L76)](../../../../packages/3-targets/6-adapters/postgres/src/exports/runtime.ts:65-76)
- **Tests (evidence)**:
  - [packages/2-sql/2-authoring/contract-psl/test/composed-mutation-defaults.test.ts (L9–L127)](../../../../packages/2-sql/2-authoring/contract-psl/test/composed-mutation-defaults.test.ts:9-127)
  - [packages/2-sql/3-tooling/family/test/mutation-default-assembly.test.ts (L19–L148)](../../../../packages/2-sql/3-tooling/family/test/mutation-default-assembly.test.ts:19-148)
  - [packages/2-sql/5-runtime/test/mutation-default-generators.test.ts (L55–L128)](../../../../packages/2-sql/5-runtime/test/mutation-default-generators.test.ts:55-128)
  - [test/integration/test/authoring/parity/default-pack-slugid/packs.ts (L1–L49)](../../../../test/integration/test/authoring/parity/default-pack-slugid/packs.ts:1-49)

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
    - [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts (L805–L814)](../../../../packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:805-814)
    - [packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts (L537–L612)](../../../../packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts:537-612)
  - **Tests**:
    - [packages/2-sql/2-authoring/contract-psl/test/composed-mutation-defaults.test.ts (L10–L33)](../../../../packages/2-sql/2-authoring/contract-psl/test/composed-mutation-defaults.test.ts:10-33)

- **Applicability is enforced at emit-time using declared codec ids**: `@default(slugid())` lowers to an execution default only when the generator descriptor declares applicability to the column’s `codecId`; otherwise it emits a targeted diagnostic.
  - **Why**: avoids brittle “type inference” compatibility checks and keeps validation deterministic (ADR 169).
  - **Implementation**:
    - [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts (L323–L345)](../../../../packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:323-345)
  - **Tests**:
    - [packages/2-sql/2-authoring/contract-psl/test/composed-mutation-defaults.test.ts (L84–L126)](../../../../packages/2-sql/2-authoring/contract-psl/test/composed-mutation-defaults.test.ts:84-126)

- **Runtime mutation defaults resolve generator ids through composed components**: runtime no longer relies on hardwired generator wiring; it looks up `execution.mutations.defaults[*].onCreate.id` in the assembled registry, and throws a stable error when missing.
  - **Why**: makes generator ids extensible via packs and keeps runtime behavior aligned with the contract’s declared ids.
  - **Implementation**:
    - [packages/2-sql/5-runtime/src/sql-context.ts (L375–L422)](../../../../packages/2-sql/5-runtime/src/sql-context.ts:375-422)
  - **Tests**:
    - [packages/2-sql/5-runtime/test/mutation-default-generators.test.ts (L56–L97)](../../../../packages/2-sql/5-runtime/test/mutation-default-generators.test.ts:56-97)
    - [packages/2-sql/5-runtime/test/mutation-default-generators.test.ts (L98–L127)](../../../../packages/2-sql/5-runtime/test/mutation-default-generators.test.ts:98-127)

## Compatibility / migration / risk
- **API surface**: code calling the PSL interpreter directly without providing `controlMutationDefaults` will now observe an empty vocabulary (unknown default function errors). The provider helper (`prismaContract`) wires composition via `frameworkComponents` by default.
- **Runtime**: contracts that reference generator ids not provided by the composed runtime stack now fail early and clearly (`RUNTIME.MUTATION_DEFAULT_GENERATOR_MISSING`).

## Non-goals / intentionally out of scope
- Expanding PSL default-function syntax beyond what’s needed to prove the registry seam.
- Adding predicate-based applicability (v1 is `codecId`-only).

## Sources
- Spec: [projects/psl-contract-authoring/specs/Follow-up - Pack-provided mutation default functions registry.spec.md](../Follow-up%20-%20Pack-provided%20mutation%20default%20functions%20registry.spec.md)
- ADR: [docs/architecture docs/adrs/ADR 169 - Declared applicability for mutation default generators.md](../../../../docs/architecture%20docs/adrs/ADR%20169%20-%20Declared%20applicability%20for%20mutation%20default%20generators.md)
- Review range: `origin/main...HEAD`

## Summary
This change set makes mutation defaults **fully composition-owned** end-to-end:

- **Control plane**: target/adapter/packs contribute the default-function lowering vocabulary and generator descriptors (incl. applicability + generated-column resolution) and pass them into PSL interpretation.
- **Execution plane**: runtime resolves generator ids from composed contributors and fails with stable errors when missing.

This matches the tightened spec constraint: vocabulary-driven authoring packages (PSL) contain **no built-in maps**, **no default target**, and **no generator-id special casing**.

## Design alignment with spec / ADR
- **Two coordinated registries**:
  - **Emit-time** lowering vocabulary + generator descriptors: [packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts (L32–L62)](../../../../packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts:32-62)
  - **Runtime** generator implementations resolved from composition: [packages/2-sql/5-runtime/src/sql-context.ts (L352–L399)](../../../../packages/2-sql/5-runtime/src/sql-context.ts:352-399)
- **Applicability is declared** via `applicableCodecIds` and validated during lowering: [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts (L275–L294)](../../../../packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:275-294)
- **Baseline built-ins are normal contributors**:
  - Control (baseline vocabulary + descriptors): [packages/3-targets/6-adapters/postgres/src/core/control-mutation-defaults.ts (L1–L120)](../../../../packages/3-targets/6-adapters/postgres/src/core/control-mutation-defaults.ts:1-120)
  - Runtime (baseline generators): [packages/3-targets/6-adapters/postgres/src/exports/runtime.ts (L48–L56)](../../../../packages/3-targets/6-adapters/postgres/src/exports/runtime.ts:48-56)
- **Deterministic duplicate handling** is enforced by family assembly: [packages/2-sql/3-tooling/family/src/core/assembly.ts (L255–L283)](../../../../packages/2-sql/3-tooling/family/src/core/assembly.ts:255-283)

## Architecture review

### Control plane: vocabulary + applicability registry
- **PSL interpreter is target/registry-driven**: it requires a target + scalar type descriptors as inputs (no default target; no embedded scalar maps).
  - Interpreter inputs: [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts (L33–L39)](../../../../packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:33-39)
- **Lowering is registry-driven** and applicability validation is deterministic:
  - Lowering + applicability: [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts (L202–L297)](../../../../packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:202-297)
- **Generated-column typing is registry-owned** (including parameterized behaviors like nanoid sizing):
  - Interpreter consumption: [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts (L523–L531)](../../../../packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:523-531)
  - Baseline metadata source (ids): [packages/1-framework/2-authoring/ids/src/index.ts (L15–L101)](../../../../packages/1-framework/2-authoring/ids/src/index.ts:15-101)

### Runtime: generator resolution and safety
- **Registry construction matches the runtime composition model** (target + adapter + extension packs), with duplicate-owner metadata.
  - Registry assembly: [packages/2-sql/5-runtime/src/sql-context.ts (L352–L379)](../../../../packages/2-sql/5-runtime/src/sql-context.ts:352-379)
- **Missing generator behavior is stable and targeted**:
  - Stable error: [packages/2-sql/5-runtime/src/sql-context.ts (L381–L399)](../../../../packages/2-sql/5-runtime/src/sql-context.ts:381-399)

### Determinism and composition boundaries
- **Determinism**: registries are derived from ordered contributor lists and reject duplicates.
  - Test evidence: [packages/2-sql/3-tooling/family/test/mutation-default-assembly.test.ts (L20–L77)](../../../../packages/2-sql/3-tooling/family/test/mutation-default-assembly.test.ts:20-77)
- **Boundary correctness**: `sql-contract-psl` provider consumes preassembled inputs; assembly stays in control-plane composition/orchestration.
  - Provider options: [packages/2-sql/2-authoring/contract-psl/src/provider.ts (L11–L24)](../../../../packages/2-sql/2-authoring/contract-psl/src/provider.ts:11-24)

## Diagnostics and UX
- **Span-based diagnostics preserved** for unknown defaults, invalid args, and applicability failures.
  - Unknown-function diagnostics include registry-derived supported signatures: [packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts (L220–L252)](../../../../packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts:220-252)
  - Applicability diagnostics: [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts (L275–L294)](../../../../packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:275-294)
- **Namespace wording** follows the repo preference (“unrecognized namespace … add extension pack …”).
  - Example: [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts (L467–L475)](../../../../packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:467-475)

## Risks / follow-ups (design-level)
- None noted beyond normal follow-ups for pack author ergonomics and expanding conformance fixtures over time.


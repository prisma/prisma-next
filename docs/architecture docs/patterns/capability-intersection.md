# Pattern: Capability intersection across layer frontiers

**Status:** Stable
**Maintainer:** architect

## Intent

The language server holds a `ContractSourceProvider` from a loaded config and wants to interpret editor buffers with it. Interpretation speaks in `DocumentAst` / `SourceFile` / `SymbolTable` — authoring-layer vocabulary the core `config` package is forbidden to name (`pnpm lint:deps`, `tsPreCompilationDeps`). The naive escapes are all bad: erase the method's types to `unknown` at the core (casts at every consumer), lift the parser types into core (layering inversion), or cast the provider at the call site (a lie about evidence).

The pattern: the **capability type lives in the layer that owns its vocabulary** and extends the lower layer's member type; providers **attach the capability structurally** in the same factory closure that builds the base object; consumers narrow through a **runtime-evidence guard** — discriminant plus method-presence — which is the *only* sanctioned narrowing seam. The lower layer stays silent about the capability; zero casts appear anywhere.

## When to use

- A lower layer's type (often a union member) needs an optional richer surface whose parameter/return types belong to a **higher layer** — the declaration cannot move down without a layering inversion.
- Multiple consumers across packages must detect the capability at runtime (loaded configs, plugin objects — values whose concrete origin is unknowable at the type level).
- Third-party implementations of the base type are admissible, so "does it have the capability?" is a genuine runtime question, not a compile-time fact.

## When NOT to use

- **No layer frontier** — if the capability's vocabulary lives in the same (or a lower) layer as the base type, just declare the member there; see [Capability gating](./capability-gating.md) for target-optional *features* declared in contracts.
- **Single consumer that also constructs the value** — it already knows the concrete type; export the concrete type and skip the guard.
- **The capability is universal** — if every implementation must have it, it belongs on the base type, not behind a guard.

## Structure

```typescript
// core layer (config) — declares the union; never names authoring vocabulary.
// The opaque member's open `sourceFormat?: string` overlaps the literal
// members, so a bare `sourceFormat === 'psl'` equality never narrows the
// union — narrowing flows only through the capability guard.
export type ContractSourceProvider =
  | PslContractSourceProvider        // sourceFormat: 'psl'
  | TypeScriptContractSourceProvider // sourceFormat: 'typescript'
  | OpaqueContractSourceProvider;    // sourceFormat?: string

// authoring layer (psl-parser) — owns the vocabulary, declares the capability.
export interface PslInterpretCapable extends PslContractSourceProvider {
  interpret(
    input: PslInterpretInput, // DocumentAst / SourceFile / SymbolTable
    context: ContractSourceContext,
  ): Result<Contract, ContractSourceDiagnostics>;
}

// the only narrowing seam: discriminant + method evidence, not faith.
export function hasPslInterpreter(source: ContractSourceProvider): source is PslInterpretCapable {
  return (
    source.sourceFormat === 'psl' && 'interpret' in source && typeof source.interpret === 'function'
  );
}

// provider factory — attaches the capability structurally; `load` and
// `interpret` share the closure, so the two paths cannot drift.
export function prismaContract(schemaPath: string, options: PrismaContractOptions): ContractConfig {
  const source: PslInterpretCapable = {
    sourceFormat: 'psl',
    inputs: [schemaPath],
    interpret(input, context) { /* full-fidelity interpretation */ },
    async load(context) { /* read + parse, then this.interpret(...) */ },
  };
  return { source, /* … */ };
}

// consumer (language server) — evidence in, vocabulary out, zero casts.
if (hasPslInterpreter(config.contract.source)) {
  const result = config.contract.source.interpret(cachedArtifacts, context);
}
```

Zero casts fall out by construction: the factory annotates the literal with the capability type (assignable to the union by subtyping), the guard's predicate does the narrowing the type system cannot, and the consumer reads a fully-typed method. The deliberate union overlap is load-bearing — it stops consumers from "narrowing" via a discriminant check that proves nothing about the method's presence.

## Reference implementations

| Implementation | Path | Demonstrates |
|---|---|---|
| `ContractSourceProvider` union | [`packages/1-framework/1-core/config/src/contract-source-types.ts`](../../../packages/1-framework/1-core/config/src/contract-source-types.ts) | The silent core: `sourceFormat`-keyed union with the open opaque member. |
| `PslInterpretCapable` + `hasPslInterpreter` | [`packages/1-framework/2-authoring/psl-parser/src/interpret.ts`](../../../packages/1-framework/2-authoring/psl-parser/src/interpret.ts) | The capability + guard in the vocabulary-owning layer. |
| `prismaContract` (sql) | [`packages/2-sql/2-authoring/contract-psl/src/provider.ts`](../../../packages/2-sql/2-authoring/contract-psl/src/provider.ts) | Structural attachment; `load` delegates to `this.interpret`. |
| `mongoContract` | [`packages/2-mongo-family/2-authoring/contract-psl/src/provider.ts`](../../../packages/2-mongo-family/2-authoring/contract-psl/src/provider.ts) | The mirror attachment in the second family. |
| Language-server consumption | [`packages/1-framework/3-tooling/language-server/src/config-resolution.ts`](../../../packages/1-framework/3-tooling/language-server/src/config-resolution.ts) | Guard-based narrowing of a loaded config's source. |

## Related ADRs

- [ADR 007 — Types Only Emission](../adrs/ADR%20007%20-%20Types%20Only%20Emission.md) — the same principle at the artifact boundary: rich types without executable coupling.

## Related patterns

- [Capability gating](./capability-gating.md) — the *data* variant: contract-declared capabilities checked at authoring time. This pattern is the *behavioral* variant: an optional method whose type lives upstairs, checked at runtime.
- [SPI at the lowest consuming layer](./spi-at-lowest-consuming-layer.md) — the inverse direction: there a lower layer declares an interface for higher layers to implement; here a higher layer declares an extension of a lower layer's type for peers to attach.
- [Interface + factory function](./interface-plus-factory.md) — the attachment site: providers are built by factories, and the capability rides the factory's closure.

## Related rules

- [`.cursor/rules/no-target-branches.mdc`](../../../.cursor/rules/no-target-branches.mdc) — the guard narrows on evidence, never on family/target string comparison alone.
- The no-bare-casts policy (AGENTS.md § Typesafety rules) — this pattern exists so frontier-crossing features need no casts at all.

## Cautions / common mistakes

- **Narrowing on the discriminant alone.** `sourceFormat === 'psl'` compiles as a comparison but never narrows (the opaque member overlaps it) — by design. If you find yourself wanting it to narrow, you want the guard.
- **Declaring the capability's input types in the lower layer as `unknown`.** That is type erasure — every consumer inherits a cast. The whole point is that the declaration moves *up* to where the types have names.
- **Guarding on the discriminant without method evidence.** A `'psl'` provider without `interpret` is legal (older providers, hand-rolled configs); the guard must check `typeof source.interpret === 'function'`.
- **Detaching the method.** `const { interpret } = source` loses `this` for object-literal implementations that delegate between methods (`load` calls `this.interpret`). Invoke it as a method.
- **Adding the capability member to the lower layer's schema as required.** Runtime validation must keep ignoring undeclared keys so capability-carrying objects pass through untouched.

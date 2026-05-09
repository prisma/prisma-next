# ADR 195 — Planner IR with two renderers (OpFactoryCall pattern)

## At a glance

The planner diffs two contracts and determines that a unique ascending index on `users.email` needs to be created. Rather than directly constructing the full operation ([ADR 188](ADR%20188%20-%20MongoDB%20migration%20operation%20model.md)), it produces an IR node:

```ts
const call = new CreateIndexCall('users', [{ field: 'email', direction: 1 }], { unique: true });
```

Two renderers interpret this node.

The **operation renderer** calls the `createIndex` factory function and produces a `MongoMigrationPlanOperation` — precheck, execute, postcheck — ready to serialize to `ops.json` and be executed by the runner:

```ts
renderOps([call]);
// → [{ id: 'index.users.create(email:1)', operationClass: 'additive',
//      precheck: [...], execute: [...], postcheck: [...] }]
```

The **TypeScript renderer** produces a line of source code that calls the same factory:

```ts
renderCallsToTypeScript([call], meta);
// → ...
//   createIndex('users', [{ field: 'email', direction: 1 }], { unique: true })
//   ...
```

Both outputs derive from the same `CreateIndexCall` instance. The factory function that backs both paths is the same `createIndex` from `migration-factories.ts` — one is called at plan time, the other is rendered as a call site the developer can edit.

## Decision

The planner produces an intermediate representation — `OpFactoryCall[]` — instead of constructing operations directly. Two renderers consume the IR: one materializes runnable operations, the other emits TypeScript source. The IR is a hierarchy of frozen classes; each class self-describes via abstract methods (`renderTypeScript`, `importRequirements`, `toOp`).

This pattern is **target-agnostic** and **extension-extensible**. Mongo and Postgres both implement it; a third party can also implement `OpFactoryCall` directly without depending on a target's package-private base class. Cipherstash's codec lifecycle hook ([ADR 212](./ADR%20212%20-%20Codec%20lifecycle%20hooks.md)) does exactly this — it returns Calls implementing the framework `OpFactoryCall` interface, and the postgres planner inlines them into its call list polymorphically.

### Framework `OpFactoryCall` interface

The framework-level interface in `@prisma-next/framework-components/control` is the cross-target contract. Every Call class — postgres `*Call`, mongo `*Call`, cipherstash `*Call`, and any future extension-owned IR node — implements it directly:

```ts
export interface OpFactoryCall {
  readonly factoryName: string;
  readonly operationClass: MigrationOperationClass;
  readonly label: string;
  renderTypeScript(): string;
  importRequirements(): readonly ImportRequirement[];
  toOp(): MigrationPlanOperation;
}
```

`renderTypeScript()` and `importRequirements()` are the TypeScript renderer's polymorphic seam — each Call decides what source text it emits and which symbols it pulls in. `toOp()` is the operation renderer's seam — each Call lowers itself to a runtime `MigrationPlanOperation` (concrete subclasses narrow the return type via covariance, e.g. postgres returns `SqlMigrationPlanOperation<PostgresPlanTargetDetails>`). The renderers (`renderCallsToTypeScript`, `renderOps`) operate on the framework type and dispatch through these methods — they never need to know which Call class they're holding, so codec-emitted Calls flow through unchanged alongside structural Calls.

## The IR

Each target package owns its own `*Call` class hierarchy, rooted in a target-local abstract base that extends `TsExpression` (from `@prisma-next/ts-render`, which provides `renderTypeScript` / `importRequirements`) and implements the framework `OpFactoryCall` interface. Concrete classes carry the factory's arguments as readonly fields and define `toOp()` directly:

```ts
abstract class PostgresOpFactoryCallNode extends TsExpression implements OpFactoryCall {
  abstract readonly factoryName: string;
  abstract readonly operationClass: MigrationOperationClass;
  abstract readonly label: string;
  abstract toOp(): SqlMigrationPlanOperation<PostgresPlanTargetDetails>;
  // renderTypeScript / importRequirements come from TsExpression
}

class CreateTableCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'createTable' as const;
  readonly operationClass = 'additive' as const;
  // schemaName, tableName, columns, primaryKey — matches createTable's signature
}
// ... one class per pure factory function
```

Each class carries the factory name as a literal-typed `factoryName` discriminant, the factory's arguments as readonly fields, and planner-derived metadata (`operationClass`, `label`). Instances are frozen at construction.

Adding a new variant means defining a new `*Call` class — there is no central exhaustiveness check. `renderTypeScript`, `importRequirements`, and `toOp` are abstract on the base, so the compiler still rejects an incomplete subclass. The cost relative to the original visitor design is that the IR no longer enforces "every dispatch site handles every variant" at compile time; the win is that extensions can add `*Call` classes (cipherstash already does) without modifying a target-local visitor enum.

### Why planner-derived semantics ride on the IR

`operationClass` and `label` are not syntactic properties of the factory call — they're semantic classifications that only the planner can make. Consider `CollModCall`: the same `collMod` factory call might be `'widening'` (relaxing a validator) or `'destructive'` (tightening one). The planner knows because it runs `classifyValidatorUpdate` over the origin and destination validators. No other site has that context.

Storing the classification on the call keeps each node self-describing. `renderOps` reads `call.operationClass` without re-deriving — it stays purely structural, mapping call arguments to factory invocations. The alternative would be threading origin-validator context through the rendering pipeline to a component that otherwise only needs argument values.

For most variants the classification is constant (`CreateIndexCall` is always `'additive'`, `DropCollectionCall` is always `'destructive'`). Only `CollModCall` carries a computed `operationClass` via an optional `meta` parameter.

## Two renderers

### Operation renderer (`renderOps`)

A polymorphic dispatch through each Call's `toOp()`:

```ts
function renderOps(calls: readonly OpFactoryCall[]): MigrationPlanOperation[] {
  return calls.map((call) => call.toOp());
}
```

The result is an array of `MigrationPlanOperation` — the same three-phase envelopes from [ADR 188](ADR%20188%20-%20MongoDB%20migration%20operation%20model.md) (mongo) or [ADR 191](ADR%20191%20-%20Generic%20three-phase%20migration%20operation%20envelope.md) (sql), serializable to `ops.json`. Targets re-specialize the framework-level return type back to their own `Op` shape at the integration boundary (cipherstash's codec-emitted Calls target the postgres lane by construction; the postgres `renderOps` casts back to `SqlMigrationPlanOperation<PostgresPlanTargetDetails>` with a comment-documented `as` cast).

### TypeScript renderer (`renderCallsToTypeScript`)

A polymorphic dispatch through each Call's `renderTypeScript()` and `importRequirements()`:

```ts
export function renderCallsToTypeScript(
  calls: readonly OpFactoryCall[],
  meta: RenderMigrationMeta,
): string {
  const imports = buildImports(calls); // dedupes call.importRequirements() across all calls
  const operationsBody = calls.map((c) => c.renderTypeScript()).join(',\n');
  // ... wraps in shebang + Migration subclass scaffold + MigrationCLI.run(...)
}
```

The outer function wraps the rendered calls in a complete `migration.ts` file: shebang, target-owned base imports (`Migration`, `MigrationCLI` from `@prisma-next/target-postgres/migration` or `@prisma-next/target-mongo/migration`), the deduplicated import requirements declared by each Call (so codec-emitted Calls pull in their own factory module — e.g. `cipherstashAddSearchConfig` from `@prisma-next/extension-cipherstash/migration`), a `Migration` subclass with `describe()` and `operations`, and `MigrationCLI.run(import.meta.url, M)`. The result is a runnable file the developer can edit, then execute to emit `ops.json` ([ADR 192](ADR%20192%20-%20ops.json%20is%20the%20migration%20contract.md)).

### Wiring

`PlannerProducedMongoMigration` holds the `OpFactoryCall[]` and wires both renderers:

- `operations` (the `Migration` contract) delegates to `renderOps(this.calls)`.
- `renderTypeScript()` delegates to `renderCallsToTypeScript(this.calls, meta)`, implementing the `MigrationPlanWithAuthoringSurface` interface so the CLI can uniformly ask any planner result for its TypeScript source.

### Why rendering is external to the IR nodes

TypeScript rendering is compositional: `renderCallsToTypeScript` doesn't just render individual call expressions — it wraps them in a complete file (shebang, imports, `Migration` subclass skeleton, `Migration.run(...)`). That file structure depends on the *collection* of calls and the migration metadata, context no individual node has. Each node could own a `renderExpression(): string` method for just its call site, but the outer composition step would remain, so the split would add surface area without eliminating anything. Keeping all rendering in the visitor also means the IR stays a pure data description of "which factory, which arguments" — rendering opinions stay in the renderer, which is target-specific.

## Factory alignment

Factory function signatures in `migration-factories.ts` are aligned 1:1 with `OpFactoryCall` argument shapes. `CreateIndexCall` carries `(collection, keys, options?)` — exactly the parameters of `createIndex(collection, keys, options?)`. Factories are "dumb": they take arguments and produce a `MongoMigrationPlanOperation` directly, assembling DDL commands, inspection commands, and filter expressions. They do not produce another IR.

This alignment is what makes the TypeScript renderer possible. The rendered source code calls the same functions with the same argument shapes, so a user reading or editing `migration.ts` is working with the same API that the planner uses internally.

## References

- [ADR 188 — MongoDB migration operation model](ADR%20188%20-%20MongoDB%20migration%20operation%20model.md): the three-phase envelope that `renderOps` produces.
- [ADR 191 — Generic three-phase migration operation envelope](ADR%20191%20-%20Generic%20three-phase%20migration%20operation%20envelope.md): the framework generic that both SQL and Mongo operations implement.
- [ADR 192 — ops.json is the migration contract](ADR%20192%20-%20ops.json%20is%20the%20migration%20contract.md): `renderTypeScript` produces the authoring surface that emits `ops.json`; `renderOps` produces the operations that serialize to `ops.json` directly.

## Alternatives considered

### Planner constructs operations directly, TypeScript renderer reverse-engineers them

The planner could produce `MongoMigrationPlanOperation[]` as before, and a separate renderer could inspect the DDL commands inside each operation to generate TypeScript. This avoids introducing an IR, but:

- **Lossy.** The operation envelope does not carry the factory name or argument boundaries. A `CreateIndexCommand` inside an execute step could have been produced by `createIndex(...)` or by hand-assembled code. The renderer would have to pattern-match on command types and reconstruct arguments — fragile, incomplete, and impossible for `collMod` where the same command serves multiple factory signatures.
- **Couples rendering to operation internals.** The renderer must understand the structure of prechecks, postchecks, and commands — the exact details that factories encapsulate.

### Plain data objects instead of frozen classes

`OpFactoryCall` could be a plain discriminated union (`{ factoryName: 'createIndex'; collection: string; ... }`) rather than a class hierarchy. Plain data is simpler and serializes naturally. We chose classes because:

- **Self-describing nodes.** `renderTypeScript`, `importRequirements`, and `toOp` are abstract on the base — each subclass owns its own emit logic. With plain data, every renderer would need a switch over `factoryName` and would have to be updated whenever a new variant is added. The class-per-factory shape keeps emit logic co-located with the data it operates on.
- **Extension-extensible.** Cipherstash and other extensions add new `*Call` classes that implement the framework `OpFactoryCall` interface; the postgres renderer accepts them polymorphically without target-side changes. A discriminated-union shape would require every renderer to know every `factoryName` literal, which closes the door on out-of-tree variants.
- **Consistency.** The codebase's DDL commands, inspection commands, and filter expressions already use the same frozen-class pattern. Using it here keeps the AST layer uniform.

### Centralised visitor for compile-time exhaustiveness

An earlier draft of this ADR proposed an `OpFactoryCallVisitor<R>` interface where every dispatch site called `node.accept(visitor)` and the union type forced every visitor to handle every variant. We dropped it during implementation:

- **Adding variants requires editing target-local code.** Every new `*Call` class would have to update the union type *and* every visitor implementation in the target. Cipherstash needs to add `*Call` classes without touching postgres internals — a closed visitor interface contradicts that.
- **The compile-time signal it provided is weak in practice.** Most dispatch sites are local to a single file and trivially exhaustive at the type level via the abstract methods on the base. The ceremony of `accept(visitor)` + a parallel `Visitor<R>` interface buys little against the alternative of "abstract methods on the base + concrete subclasses".

Subclassing-with-abstract-methods preserves the property the visitor was meant to enforce (every Call class implements every renderer hook) without closing the variant set.

### Separate metadata type alongside the call

Instead of `operationClass` and `label` living on each `OpFactoryCall` instance, they could live in a parallel structure — e.g., `{ call: OpFactoryCall; operationClass: MigrationOperationClass; label: string }[]`. This keeps the IR purely syntactic. We chose to embed them because:

- **Simplicity.** One array, one type, one visitor — no zipping, no alignment bugs.
- **Self-describing nodes.** Each call carries everything the renderers need. `renderOps` reads `call.operationClass`; `renderCallsToTypeScript` reads `call.meta`. No second lookup.
- **The impurity is small.** Only `CollModCall` has a computed `operationClass`. The other four variants bake it as a literal constant, indistinguishable from a syntactic property.

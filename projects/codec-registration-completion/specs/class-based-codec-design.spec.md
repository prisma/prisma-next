# Class-based codec design (Mode C, Approach 2)

## Status

**Implementation-approach spec** for the [Mode C goal](factory-defined-codec-types.spec.md). Describes a specific implementation pattern where `CodecDescriptor` and `Codec` are abstract base classes that codec authors extend. The class hierarchy is the structural mechanism for "the descriptor's factory is the single type-level source of truth"; per-call type extraction works through the natural mechanics of TypeScript class methods + structural inference at the consumer (column helper) layer.

This spec describes the **target design** of the spike. The spike itself is exploratory — small scratch-branch reshape of the pgvector + a representative postgres codec, demonstrating AC-1 through AC-6 from the goal spec without touching the rest of the codebase. Scope is in [Spike scope](#spike-scope) below.

## Decision

A codec is two paired classes:

- **`CodecDescriptor`** — abstract base class. Codec authors extend it to declare a codec's identity (`codecId`, `traits`, `targetTypes`), validate its parameters (`paramsSchema`), produce its codec instance from params (`factory()`), and render its TS output type for the emit path (`renderOutputType()`).
- **`Codec`** — abstract base class. Codec authors extend it to implement `encode`/`decode` (and JSON variants where applicable). The instance retains a reference to its descriptor; metadata reads (`id`, `traits`) proxy through the descriptor for one source of truth.

The descriptor's `factory()` is a method whose typed return is the concrete codec class. TypeScript captures the typed factory return at consumer sites (column helper, no-emit `FieldOutputType`, etc.) by structural inference at call sites — applying the factory's signature with column-specific params yields the typed `Codec` instance class. At heterogeneous-storage boundaries (the runtime registry), the type widens to the abstract base; this is correct, and the runtime needs no type information.

This is the implementation pattern the goal spec ([`factory-defined-codec-types.spec.md`](factory-defined-codec-types.spec.md)) calls for: factory-as-source-of-truth, expressed through the class hierarchy.

## Class hierarchy

### `CodecDescriptor`

Lives in `@prisma-next/framework-components/codec` (replacing today's `CodecDescriptor` interface).

```typescript
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { CodecInstanceContext } from './codec-instance-context';
import { Codec } from './codec';

export abstract class CodecDescriptor<TParams = void> {
  abstract readonly codecId: string;
  abstract readonly traits: readonly CodecTrait[];
  abstract readonly targetTypes: readonly string[];
  readonly meta?: CodecMeta;

  /**
   * Standard Schema validator for the descriptor's params. Validates the
   * params shape at the JSON boundary (contract-load time, PSL parsing).
   * The factory's typed input is the type-level constraint; this schema
   * is its runtime counterpart.
   */
  abstract readonly paramsSchema: StandardSchemaV1<TParams>;

  /**
   * Render the TypeScript output type as a source string for the emit
   * path. Optional; non-parameterized codecs and codecs whose output
   * type is fixed (e.g. `number`, `string`) return undefined and the
   * emitter falls through to the codec's base output type.
   */
  renderOutputType?(params: TParams): string | undefined;

  /**
   * Materialize a runtime codec instance for the given params. The
   * factory's TS-level typed return determines the codec instance type
   * for type-level consumers (no-emit `FieldOutputType`, etc.).
   *
   * Concrete subclasses override this method with a typed return type
   * (e.g. `factory<N>(params: { length: N }): (ctx) => VectorCodec<N>`).
   * The override's typed return is what consumers read at the type level.
   */
  abstract factory(params: TParams): (ctx: CodecInstanceContext) => Codec<string, readonly CodecTrait[], unknown, unknown>;
}
```

### `Codec`

Lives in `@prisma-next/framework-components/codec` (replacing today's `Codec` interface).

```typescript
import type { CodecDescriptor } from './codec-descriptor';

export abstract class Codec<
  Id extends string,
  TTraits extends readonly CodecTrait[],
  TWire,
  TInput,
> {
  constructor(public readonly descriptor: CodecDescriptor<unknown>) {}

  /** Codec id, proxied from the descriptor. One source of truth. */
  get id(): Id {
    return this.descriptor.codecId as Id;
  }

  /** Codec traits, proxied from the descriptor. */
  get traits(): TTraits {
    return this.descriptor.traits as TTraits;
  }

  abstract encode(value: TInput, ctx: SqlCodecCallContext): Promise<TWire>;
  abstract decode(wire: TWire, ctx: SqlCodecCallContext): Promise<TInput>;

  encodeJson?(value: TInput): JsonValue;
  decodeJson?(json: JsonValue): TInput;
}
```

The codec instance retaining a reference to its descriptor solves the aliasing concern raised during goal-spec discussion: aliased codecs (if kept at all) point their codec instances at the alias descriptor, and `codec.id` reads the alias's `codecId`. No instance-level `id` field to keep in sync.

### Concrete codec author pattern

Authoring a codec is two class declarations: the descriptor and its codec instance. Three illustrative examples spanning the case spectrum.

#### Non-parameterized codec (Case 1)

```typescript
class PgInt4Codec extends Codec<'pg/int4@1', readonly ['equality', 'order', 'numeric'], number, number> {
  async encode(value: number): Promise<number> {
    return value;
  }
  async decode(wire: number): Promise<number> {
    return wire;
  }
}

class PgInt4Descriptor extends CodecDescriptor<void> {
  readonly codecId = 'pg/int4@1' as const;
  readonly traits = ['equality', 'order', 'numeric'] as const;
  readonly targetTypes = ['int4'];
  readonly paramsSchema = voidParamsSchema;

  factory(): (ctx: CodecInstanceContext) => PgInt4Codec {
    return (ctx) => new PgInt4Codec(this);
  }
}

export const pgInt4Descriptor = new PgInt4Descriptor();
```

The factory has no method-level generic — non-parameterized codecs return the same `PgInt4Codec` for every call. Consumers reading `descriptor.factory()(ctx)`'s return type get `PgInt4Codec` directly.

#### Parameterized codec with literal preservation (Case 2)

```typescript
class VectorCodec<N extends number> extends Codec<'pg/vector@1', readonly ['equality'], string, Vector<N>> {
  constructor(descriptor: CodecDescriptor<{ readonly length: N }>, public readonly dimension: N) {
    super(descriptor);
  }
  async encode(value: Vector<N>): Promise<string> {
    return `[${value.join(',')}]`;
  }
  async decode(wire: string): Promise<Vector<N>> {
    // ... parse and validate; throws if dimension mismatches
    return parsed as Vector<N>;
  }
}

class PgVectorDescriptor extends CodecDescriptor<{ readonly length: number }> {
  readonly codecId = 'pg/vector@1' as const;
  readonly traits = ['equality'] as const;
  readonly targetTypes = ['vector'];
  readonly paramsSchema = vectorParamsSchema;

  factory<N extends number>(
    params: { readonly length: N },
  ): (ctx: CodecInstanceContext) => VectorCodec<N> {
    return (ctx) => new VectorCodec<N>(this, params.length);
  }

  renderOutputType(params: { readonly length: number }): string {
    return `Vector<${params.length}>`;
  }
}

export const pgVectorDescriptor = new PgVectorDescriptor();
```

The class-level params type is `{ readonly length: number }` (widest bound). The **method-level generic** `<N extends number>` is what preserves the literal at call sites: `pgVectorDescriptor.factory({ length: 1536 })` types as `(ctx) => VectorCodec<1536>` because TypeScript infers `N=1536` from the method-generic at the call site.

This is the core variance pattern of the class-based design: class generics widen to the bound for storage; method generics specialize per call. Both work in concert.

#### Parameterized codec with arktype schema (Case 3)

```typescript
class ArktypeJsonCodec<S extends Type<unknown>> extends Codec<
  'arktype/json@1',
  readonly ['equality'],
  string,
  S['infer']
> {
  constructor(
    descriptor: CodecDescriptor<{ readonly schema: S }>,
    private readonly schema: S,
  ) {
    super(descriptor);
  }
  async encode(value: S['infer']): Promise<string> {
    return JSON.stringify(value);
  }
  async decode(wire: string): Promise<S['infer']> {
    const raw = JSON.parse(wire);
    const result = this.schema(raw);
    if (result instanceof type.errors) {
      throw new Error(`...`);
    }
    return result;
  }
}

class ArktypeJsonDescriptor extends CodecDescriptor<{ readonly schema: Type<unknown> }> {
  readonly codecId = 'arktype/json@1' as const;
  readonly traits = ['equality'] as const;
  readonly targetTypes = ['jsonb'];
  readonly paramsSchema = arktypeJsonParamsSchema;

  factory<S extends Type<unknown>>(
    params: { readonly schema: S },
  ): (ctx: CodecInstanceContext) => ArktypeJsonCodec<S> {
    return (ctx) => new ArktypeJsonCodec<S>(this, params.schema);
  }

  renderOutputType(params: { readonly schema: { expression: string } }): string {
    return params.schema.expression;
  }
}

export const arktypeJsonDescriptor = new ArktypeJsonDescriptor();
```

Same pattern as `PgVectorDescriptor`: class-level widest-bound params; method-level generic preserving the schema's specific type at call sites. The codec instance carries the schema as runtime state and uses it in `decode`.

## Column helper and type-level extraction

The column helper bridges the descriptor's typed factory to the contract type. It is **the only place in framework code** where the typed factory call happens; everywhere else reads the typed result from the column spec.

### Helper signature

```typescript
function column<P, R>(
  descriptor: { factory(params: P): (ctx: CodecInstanceContext) => R } & {
    readonly codecId: string;
    readonly targetTypes: readonly string[];
  },
  params: P,
): ColumnTypeDescriptor & {
  readonly codecId: string;
  readonly typeParams: P;
  readonly codecFactory: (ctx: CodecInstanceContext) => R;
};
```

The structural type on `descriptor`'s parameter is the load-bearing piece. By describing the descriptor structurally as `{ factory(params: P): (ctx) => R }` rather than nominally as `CodecDescriptor<P>`, TypeScript infers `P` and `R` per call site — and method-level generics on the concrete descriptor's `factory` participate in that inference.

### Type extraction at call sites

```typescript
const embeddingColumn = column(pgVectorDescriptor, { length: 1536 });
//    ^? ColumnTypeDescriptor & {
//         codecId: string;
//         typeParams: { readonly length: 1536 };
//         codecFactory: (ctx: CodecInstanceContext) => VectorCodec<1536>;
//       }
```

TypeScript walks:
1. `pgVectorDescriptor: PgVectorDescriptor` — a value with the concrete class type.
2. Match against `{ factory(params: P): (ctx) => R }`: TS instantiates `factory`'s method generic `<N>` to the inferred params shape.
3. From `params: { length: 1536 }`, P resolves to `{ readonly length: 1536 }`.
4. With P fixed, the factory's `<N>` resolves to `1536`. R resolves to `VectorCodec<1536>`.
5. Return type stamps P and R into the column spec.

Consumers read `column.codecFactory` and project the codec type:

```typescript
type ResolvedCodec<C> = C extends { codecFactory: (ctx: any) => infer R } ? R : never;
type EmbeddingCodec = ResolvedCodec<typeof embeddingColumn>;
//   ^? VectorCodec<1536>
```

For `FieldOutputType`'s purposes, the further projection reads the codec's `decode` return type or `TInput`:

```typescript
type ColumnInputType<C> = ResolvedCodec<C> extends Codec<any, any, any, infer T> ? T : never;
type EmbeddingInput = ColumnInputType<typeof embeddingColumn>;
//   ^? Vector<1536>
```

Same path for `arktypeJson(productSchema)`:

```typescript
const settingsColumn = column(arktypeJsonDescriptor, { schema: productSchema });
type SettingsInput = ColumnInputType<typeof settingsColumn>;
//   ^? typeof productSchema['infer']
```

### Per-codec wrappers (optional)

Per-codec helpers can persist as one-line wrappers if pretty authoring is desired:

```typescript
export const vector = <N extends number>(length: N) =>
  column(pgVectorDescriptor, { length });

export const arktypeJson = <S extends Type<unknown>>(schema: S) =>
  column(arktypeJsonDescriptor, { schema });
```

These add no type information beyond what the descriptor already provides — they are pure-syntactic sugar. The framework itself doesn't need them; they live in extension packs as ergonomic shortcuts. AC-4 of the goal spec is satisfied either way: column helpers either collapse into `column(descriptor, params)` or persist as trivial wrappers contributing no type-level information.

## Heterogeneous storage at the runtime layer

The framework's descriptor registry is keyed by `codecId: string` and stores type-erased descriptor instances:

```typescript
class CodecDescriptorRegistry {
  private readonly descriptors = new Map<string, CodecDescriptor<unknown>>();

  register(descriptor: CodecDescriptor<unknown>): void {
    this.descriptors.set(descriptor.codecId, descriptor);
  }

  descriptorFor(codecId: string): CodecDescriptor<unknown> | undefined {
    return this.descriptors.get(codecId);
  }
}
```

The registry's signature uses `CodecDescriptor<unknown>` — variance erasure at the boundary, correctly so. Runtime consumers of the registry call `descriptor.factory(validatedParams)(ctx)` to materialize codec instances; the abstract `factory()` signature is sufficient (returns `Codec<string, readonly CodecTrait[], unknown, unknown>`). No type information is needed at the runtime layer.

The class hierarchy makes this variance erasure cleaner than the function-based approach: assigning `PgVectorDescriptor` to `CodecDescriptor<unknown>` is a class-subtype assignment, which TS handles uniformly. The override's method-level generic stays *available* to anyone who reads the concrete class type, but is not exposed through the abstract storage signature.

## Why classes work better than functions for this

The user's intuition was right: enclosing class generics are easier to thread through TypeScript's variance rules than function-return inference. Two specific reasons.

### 1. Method-level generics survive structural matching at call sites

When `column<P, R>(descriptor: { factory(params: P): (ctx) => R }, params: P)` matches a class instance whose `factory` method is generic `<N extends number>`, TS instantiates the method generic during the structural-match step. This pattern works because the generic's bound is a method-level parameter, and structural matching on a method's signature respects method generics.

The function-based equivalent — `defineCodec(spec)` returning a record with a `factory: (params: P) => (ctx) => R` *field* — does not get this treatment. A function-valued field is not a method; method-level generics on a field's value type don't survive the indexed-access reduction `D['factory']`. This is exactly the variance failure that M2 R4 hit (see `wip/unattended-decisions.md` Decision #11).

### 2. Inheritance and `this`-typing make the descriptor + codec relationship explicit

The `Codec` instance class can hold a `descriptor` reference and `super()`-call into the abstract base from the concrete codec. Today's interface-based codecs are plain object literals, and capturing the descriptor reference requires explicit threading through every codec author's site. The class form makes this structural — every codec instance gets `descriptor` for free via the abstract base's constructor.

This matters for the aliasing case (codec id proxied through the descriptor) and for any future codec that needs to read its own metadata (e.g. for telemetry, decode-error envelopes, or cross-codec composition).

## Acceptance criteria

The goal spec's AC-1 through AC-7 apply unchanged. This implementation spec adds class-based-design-specific ACs.

### AC-CB-1. Class hierarchy declarations

- `CodecDescriptor` is an exported abstract base class from `@prisma-next/framework-components/codec`.
- `Codec` is an exported abstract base class from the same package.
- Both replace today's interface-shaped declarations.
- The legacy interfaces (if they survive at all) are kept only as deprecated aliases for type-only consumption during the transition; deletion is acceptable per AC-7 (validation gates green).

### AC-CB-2. Method-level generic preservation through column helper

For each parameterized codec demonstrated in the spike:
- `descriptor.factory(specificParams)` types as `(ctx) => SpecificCodec<literalParams>`.
- `column(descriptor, specificParams)` types as `ColumnTypeDescriptor & { codecFactory: (ctx) => SpecificCodec<literalParams> }`.
- `ResolvedCodec<typeof column(...)>` projects to `SpecificCodec<literalParams>` with literals preserved.

**Verification.** Negative type tests in `*.test-d.ts` files for at least:
- `pgVectorDescriptor.factory({ length: 1536 })` → `(ctx) => VectorCodec<1536>`.
- `arktypeJsonDescriptor.factory({ schema: testSchema })` → `(ctx) => ArktypeJsonCodec<typeof testSchema>`.

### AC-CB-3. Codec instance descriptor reference

- Every concrete `Codec` subclass in the spike receives a `descriptor` constructor argument and passes it to the abstract base's constructor.
- `codec.id` and `codec.traits` proxy through `this.descriptor.codecId` / `this.descriptor.traits` (no instance-level fields).
- A round-trip test confirms: `pgVectorDescriptor.factory(params)(ctx).id === pgVectorDescriptor.codecId`.

### AC-CB-4. Heterogeneous registry stores type-erased descriptors

- The registry signature uses `CodecDescriptor<unknown>` (or equivalent type-erased form).
- A test demonstrates: registering concrete descriptors, retrieving by codec id, calling `descriptor.factory(params)(ctx)` to materialize codec instances. No `as` casts at the registry's storage / retrieval boundary.

### AC-CB-5. Spike scope demonstrated end-to-end

- The spike scratch branch demonstrates the full data flow for at least one parameterized codec:
  1. Codec author writes `PgVectorDescriptor` and `VectorCodec` classes.
  2. Column author calls `column(pgVectorDescriptor, { length: 1536 })` (or `vector(1536)` wrapper).
  3. Contract definition aggregates the column spec; `typeof contract` carries the typed codec.
  4. A no-emit consumer (test fixture mimicking `FieldOutputType`) projects the typed codec from the contract type and resolves to `Vector<1536>`.
- The spike does **not** reshape the runtime contributor protocol, the contributor-pack registration flow, or the contract-load-time materialization machinery beyond what's needed for the demo. Those are scoped to the post-spike implementation milestone.

## Open questions to resolve in the spike

These questions don't block the spike from starting; they get answered as part of the spike's findings.

### Q-1. Class generic on `Codec` vs phantom types

The current design parameterizes `Codec<Id, TTraits, TWire, TInput>` positionally with concrete-instance-level types. An alternative: `Codec<TDescriptor extends CodecDescriptor<any>>` where `Id`, `TTraits`, `TWire`, `TInput` are derived from the descriptor type. Trade-off: tighter coupling but fewer type parameters at codec subclass declaration sites.

The spike picks one. Recommendation pending: probably the positional form (current design) for clarity; the descriptor-derived form may be useful as a convention.

### Q-2. Where does `column()` live?

Candidates:
- `@prisma-next/framework-components/codec` (alongside `CodecDescriptor`).
- `@prisma-next/contract-authoring` (alongside `ColumnTypeDescriptor`).
- A new package at the SQL family layer.

Layering rule: the column helper depends on `ColumnTypeDescriptor` and on the structural shape of `CodecDescriptor`'s factory; both are framework-components types. So `framework-components/codec` is the natural home unless a layering constraint surfaces.

### Q-3. `paramsSchema` in the abstract class — required or optional?

The current declaration has it `abstract readonly paramsSchema: StandardSchemaV1<TParams>`. For non-parameterized codecs (`TParams = void`), authors write `readonly paramsSchema = voidParamsSchema`. Acceptable; the alternative is making it optional and providing a default. The spike picks one.

### Q-4. Does aliasing keep its first-class form?

Per the goal spec's non-goals, deletion is acceptable. If kept, the natural class-based pattern is class extension:

```typescript
class PgCharDescriptor extends SqlCharDescriptor {
  readonly codecId = 'pg/char@1' as const;
  readonly targetTypes = ['character'];
  // factory inherits from SqlCharDescriptor; the alias is just a metadata override.
}
```

The codec instance produced by `pgCharDescriptor.factory()` returns a `SqlCharCodec` whose `descriptor` reference points to the `pgCharDescriptor` instance — `codec.id` reports `'pg/char@1'` automatically.

The spike includes one alias example to verify this works.

### Q-5. JSON validators registry retirement

The goal spec preserves `paramsSchema`; today there's also a `JsonSchemaValidatorRegistry` (per ADR 208's per-library JSON design). The class-based design's natural shape: validation lives inside the codec instance's `decode` body (already the case for `arktypeJson` per ADR 208). The registry retirement is tracked under TML-2357 M4 and is independent of this spike.

### Q-6. Async constructors for codec instances?

Some codec instances might need async setup (e.g. an encryption codec deriving keys at materialization time). Today's `factory(params)(ctx) => Codec` returns a sync `Codec`. The class form: codec instance constructors are sync in TS; async setup would require `factory` to return `Promise<Codec>` or for the codec itself to expose an `async ready()` method.

Out of scope for the spike; the spike codecs are all sync-constructible.

## Spike scope

The spike's deliverable is a scratch branch (off the current project branch's `efc0a988c` or its successor), demonstrating the class-based design end-to-end for **one parameterized codec** plus **one non-parameterized codec** plus **one column-helper usage**.

### What the spike implements

In a scratch branch, no production-quality migration:

1. **`framework-components/src/shared/codec-descriptor.ts`** — new. Abstract `CodecDescriptor` class.
2. **`framework-components/src/shared/codec.ts`** — new. Abstract `Codec` class.
3. **`framework-components/src/shared/column.ts`** — new (or in another package as Q-2 decides). Generic `column(descriptor, params)` helper.
4. **`extension-pgvector/src/core/codecs.ts`** — reshape pgvector's `PgVectorDescriptor` and `VectorCodec` into class form. Keep one example of the legacy descriptor form alongside if helpful for diffing.
5. **`target-postgres/src/core/codecs.ts`** — reshape one non-parameterized codec (e.g. `pgInt4`) into class form. Don't touch the rest.
6. **`extension-pgvector/test/spike-class-based.types.test-d.ts`** (new) — negative type tests covering AC-CB-2: `pgVectorDescriptor.factory({ length: 1536 })`, `column(pgVectorDescriptor, { length: 1536 })`, `ResolvedCodec<typeof embeddingColumn>` resolves to `VectorCodec<1536>` etc.
7. **`extension-pgvector/test/spike-class-based.test.ts`** (new) — runtime test covering AC-CB-3: codec instance's `descriptor` reference; codecId proxying; encode/decode round-trip on a sample vector.
8. **A fixture demo** under `examples/` or in tests showing the full flow for one column.

### What the spike does NOT do

- Migrate other codecs (postgres, sqlite, sql-family, mongo). These are post-spike implementation work.
- Touch the contributor protocol or the contributor-pack registration flow.
- Change `contract.d.ts` emission. The spike demonstrates the no-emit type derivation; emit-path verification is a post-spike concern.
- Update consumers (sql-builder, sql-orm-client, contract-ts). The spike only proves the class-hierarchy shape works.
- Resolve TML-2393's `byScalar` cleanup. That's part of M0 of the parent project's existing scope.

### Spike deliverables

- Scratch branch `spike/class-based-codecs` (off the project branch).
- Spike report at `wip/class-based-codec-spike.md` summarizing findings, including:
  - Did AC-CB-1 through AC-CB-5 pass?
  - Did the variance behavior work as predicted (method generics survive structural matching at column helper)?
  - What unexpected friction surfaced?
  - What's the projected diff cost of full M0 implementation under this design (compared to functional Approach 1's ~150–200 LoC estimate)?
  - Recommendation: proceed with class-based or fall back to functional?

The spike's report informs the next decision: whether to commit to the class-based approach for the project or refine further.

## Risks

### Class generics + method generics interaction at structural type match

The variance behavior `(descriptor: { factory(params: P): (ctx) => R }, params: P)` matching a concrete class with a method-generic factory **should** work — TS is documented to instantiate method generics during structural matching. But there are corner cases (e.g. higher-order params types, conditional types in the method generic's bound) where the behavior degrades. The spike's positive type tests are the verification.

If the structural match doesn't preserve method generics in TS's current implementation, the column helper needs an explicit method-generic forwarding shape — invasive but solvable. Worst-case fallback: pass the descriptor's factory directly to the helper (`column(pgVectorDescriptor.factory, { length: 1536 })`) which captures the method generic at the function-call boundary unambiguously.

### Codec instance class proliferation

Today's codecs are object literals; the class form requires a class declaration per codec. For the postgres pack alone, that's ~22 codec class declarations + ~22 descriptor class declarations = ~44 classes. Not technically problematic but visually heavier than today's object-literal codecs.

Mitigation: a `defineSimpleCodec` helper that produces a concrete codec class from `{ encode, decode }` functions. Authors who don't need class-level state (the common case) write the helper-based form; only stateful codecs (e.g. arktype-json with its schema) write full class declarations.

### `super()` discipline in the codec abstract base

Codec subclasses must call `super(descriptor)` in their constructors. If an author forgets, TypeScript catches it (the abstract `Codec`'s constructor parameter is required). But it's one more thing to remember. Mitigation: the `defineSimpleCodec` helper handles the super() call; only authors who write full class declarations need to think about it.

### Async / sync codec divergence

Per ADR 204, codec encode/decode are async. Codec instance construction is sync (TS class constructor limitation). For codecs that need async setup, the class form requires a `static async create()` factory pattern or an async `ready()` method. None of today's codecs need this; flagged as a future consideration.

### Performance of class instantiation per column

The current factory pattern returns a shared codec instance for non-parameterized codecs — same instance for every column. The class-based design keeps this property: `factory()(ctx) => new PgInt4Codec(this)` could be optimized to return a cached singleton:

```typescript
class PgInt4Descriptor extends CodecDescriptor<void> {
  private cachedCodec?: PgInt4Codec;
  factory(): (ctx) => PgInt4Codec {
    return (ctx) => {
      this.cachedCodec ??= new PgInt4Codec(this);
      return this.cachedCodec;
    };
  }
}
```

For parameterized codecs, the per-column instance is the design — each column gets a codec instance closing over its specific params (e.g. `dimension: N` on `VectorCodec`). No regression vs. today.

## Non-goals

- **Functional approach (Approach 1).** Out of scope. If the class-based spike fails, the functional fallback re-enters consideration.

- **Full codec migration across the codebase.** The spike reshapes one or two codecs only; full migration is post-spike implementation work.

- **Contributor protocol changes.** The spike doesn't touch how codecs register with the framework; it only shows that the class form satisfies the existing protocol's shape requirements.

- **`Codec.id` field elimination across the codebase.** The codec instance's `id` field becomes a getter proxying to the descriptor; consumers that today read `codec.id` continue to work without change. Whether to delete the field entirely (forcing all consumers through `codec.descriptor.codecId`) is a separate cleanup.

- **`paramsSchema`'s relationship to the factory's TS input type.** Could in principle be derived (the schema's parsed output type assignable to factory's input type); the spike treats them as separate artifacts that authors keep aligned, with a separate ticket / cleanup if mechanical derivation is desirable later.

## References

- [`factory-defined-codec-types.spec.md`](factory-defined-codec-types.spec.md). The goal spec this implementation approach satisfies.
- [`typed-codec-flow.spec.md`](typed-codec-flow.spec.md). The M0 sub-spec under the parent project; subsumed by the goal spec.
- [Parent spec `spec.md`](../spec.md). The `codec-registration-completion` canonical project spec.
- [ADR 208 — Higher-order codecs for parameterized types](../../../docs/architecture%20docs/adrs/ADR%20208%20-%20Higher-order%20codecs%20for%20parameterized%20types.md). The ADR partially superseded by the goal spec.
- [`wip/unattended-decisions.md` Decision #11](../../../wip/unattended-decisions.md). The variance failure that surfaced this design space.
- `wip/m0-shape-spike.md`. Shape A vs Shape B (functional Mode B) findings; informs the variance considerations for Approach 1.

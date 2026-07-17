# ADR 234 — Option arguments and value-mapped templates for authoring helpers

**Status:** Proposed
**Date:** 2026-07-17

---

## At a glance

A field preset can take an argument whose legal values are an enumerated set, and can map each of those values onto a fragment of its output. An author writes:

```prisma
model Page {
  updatedAt temporal.timestamp(3, onCreate: now, onUpdate: now)
  lastSeen  temporal.timestamp(3)
  touched   temporal.timestamptz(onUpdate: now)
}
```

or, on the TypeScript surface:

```ts
updatedAt: field.temporal.timestamp(3, 'now', 'now'),
lastSeen:  field.temporal.timestamp(3),
touched:   field.temporal.timestamptz(undefined, undefined, 'now'),
```

The preset behind them is declared once, as data:

```ts
export function temporalCodecPresetWithPrecision<
  const CodecId extends string,
  const NativeType extends string,
>(input: { readonly codecId: CodecId; readonly nativeType: NativeType }) {
  return {
    kind: 'fieldPreset',
    args: [TEMPORAL_PRECISION_ARG, TEMPORAL_ON_CREATE_ARG, TEMPORAL_ON_UPDATE_ARG],
    output: {
      codecId: input.codecId,
      nativeType: input.nativeType,
      typeParams: { precision: { kind: 'arg', index: 0 } },
      executionDefaults: {
        onCreate: temporalPhaseTemplate(1),
        onUpdate: temporalPhaseTemplate(2),
      },
    },
  } as const satisfies AuthoringFieldPresetDescriptor;
}
```

Four decisions make that work:

1. **`option` argument kind** — an argument whose value must be one of an enumerated list, spelled as a bare token in PSL and typed as a literal union in TypeScript.
2. **`map` on an argument reference** — a declarative token-to-template lookup, so preset vocabulary (`now`) never leaks the internal identifier it selects (`timestampNow`).
3. **Undefined phase omits the phase** — an execution-defaults phase whose template resolves to `undefined` is left out, and a phases object with no keys is left out entirely.
4. **Empty resolved `typeParams` is omitted** — a `typeParams` template that resolves to `{}` produces no `typeParams` key at all.

## The `option` argument kind

`AuthoringArgumentDescriptor` ([framework-authoring.ts](../../../packages/1-framework/1-core/framework-components/src/shared/framework-authoring.ts)) gains:

```ts
| {
    readonly kind: 'option';
    readonly values: readonly string[];
  }
```

The name and shape mirror `PslBlockParamOption` in [psl-extension-block.ts](../../../packages/1-framework/1-core/framework-components/src/shared/psl-extension-block.ts), which already spells an enumerated block parameter as `kind: 'option'` with `values`. Reusing the vocabulary keeps one word for one idea across the two declarative surfaces.

**PSL spells an option as a bare token** (`onUpdate: now`), following `@relation(onDelete: Cascade)` — the established spelling for an enumerated attribute argument. No grammar change was needed: bare identifiers already parse in argument position, so `parsePslAuthoringArgumentValue` ([psl-authoring-arguments.ts](../../../packages/2-sql/2-authoring/contract-psl/src/psl-authoring-arguments.ts)) only has to accept the identifier text:

```ts
case 'option': {
  const trimmed = rawValue.trim();
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed) ? trimmed : INVALID_AUTHORING_ARGUMENT;
}
```

That case checks **syntax only**. A quoted `onCreate: "now"` is rejected — one spelling, not two — and reports through the existing `PSL_INVALID_ATTRIBUTE_ARGUMENT` plumbing. The option kind introduces no diagnostic code of its own.

**TypeScript spells an option as a string literal** (`'now'`). `ArgTypeFromDescriptor` ([authoring-type-utils.ts](../../../packages/2-sql/2-authoring/contract-ts/src/authoring-type-utils.ts)) resolves an option descriptor to the literal union of its `values`, so the legal set is autocompleted and enforced by the compiler.

### Which check protects which surface

The two surfaces are validated by different mechanisms, and deliberately do not share an error message.

| Surface | What rejects a bad option value | Message |
|---|---|---|
| PSL | `validateAuthoringArgument`, at authoring time | `Authoring helper argument at <path> must be one of: now` |
| TypeScript | the literal union, at compile time | a type error |
| TypeScript, type bypassed | the `map` lookup's throw | `Authoring template map has no entry for value "<value>"` |

This asymmetry is a consequence of an existing architectural choice, not a new one: **the TypeScript authoring surface performs no runtime argument validation.** `buildFieldPreset` ([contract-dsl.ts](../../../packages/2-sql/2-authoring/contract-ts/src/contract-dsl.ts)) calls `instantiateAuthoringFieldPreset` directly and never calls `validateAuthoringHelperArguments`; that validator exists for the PSL path, which has to coerce untyped source text. On the TypeScript surface the type system *is* the check. Where a caller bypasses the type — a `string` variable, an untyped JavaScript caller — the `map` throw is the only backstop, and it reads as an internal invariant rather than user-facing guidance, which is appropriate for a case the types already exclude.

A future author adding an argument kind should know which check they are relying on, because the answer differs by surface.

## `map`: preset vocabulary is not generator vocabulary

`AuthoringArgRef` gains an optional `map`:

```ts
export type AuthoringArgRef = {
  readonly kind: 'arg';
  readonly index: number;
  readonly path?: readonly string[];
  readonly default?: AuthoringTemplateValue;
  readonly map?: Readonly<Record<string, AuthoringTemplateValue>>;
};
```

The temporal presets use it to turn the token `now` into a generator descriptor:

```ts
function temporalPhaseTemplate<const Index extends number>(index: Index) {
  return {
    kind: 'arg',
    index,
    map: { now: { kind: 'generator', id: TIMESTAMP_NOW_GENERATOR_ID } },
  } as const;
}
```

The point is the indirection. `timestampNow` is a preset-only generator id ([ADR 169](ADR%20169%20-%20Declared%20applicability%20for%20mutation%20default%20generators.md)) and must not appear in a user's spelling. `map` keeps the user-facing token and the internal id as separate vocabularies related by data, rather than passing the token through as an id and coupling the two forever.

`resolveAuthoringTemplateValue` applies the rules in this order:

1. Read `args[index]`, then walk `path`.
2. If the value is `undefined` and `default` is present, return the resolved `default` **without applying `map`** — `default` is declared in output space, not in the input vocabulary `map` translates from.
3. If the value is defined and `map` is present, it must be a string that is an own key of `map`; return the recursively resolved `map[value]`. Otherwise throw.
4. Otherwise return the value, which may be `undefined`.

**Constraint:** a `map`-bearing argument reference must not be used in the `codecId`, `nullable`, `id`, or `unique` positions of a preset output. Those feed the TypeScript builder-state inference through `ResolveTemplateValue`, which does not implement `map`. The temporal presets use `map` only inside `executionDefaults`, which builder-state inference never reads.

## Two omission rules

Both exist so that an argument the author did not supply leaves **no trace** in the contract.

**A phase that resolves to `undefined` is omitted.** `resolveExecutionMutationDefaultPhase` returns `undefined` rather than throwing; `resolveAuthoringExecutionDefaultsTemplate` returns `undefined` when the resulting phases object has no keys. A contract never carries `executionDefaults: {}`. A phase that resolves to something defined but not a generator descriptor still throws — that is a malformed descriptor, not an omission.

**An empty resolved `typeParams` is omitted.** After resolving, an object with zero keys is treated as `undefined`:

```ts
const normalizedTypeParams =
  typeParams !== undefined && Object.keys(typeParams).length === 0 ? undefined : typeParams;
```

Without this, `temporal.timestamp()` would emit `typeParams: {}` — object-template resolution drops `undefined` values, so `{ precision: { kind: 'arg', index: 0 } }` collapses to `{}` when precision is absent. Absent and `{}` are equivalent to every consumer that reads them, but they are not equal to a byte comparison, and a contract that carries `{}` differs from the `@db.Timestamp` spelling that produces the same column.

### The two rules carry each other

These are not independent conveniences. `temporal.updatedAt()` is byte-identical to `temporal.timestamptz(onCreate: now, onUpdate: now)` **only because** empty-`typeParams` normalization exists: `timestamptz` declares a `{ precision: arg0 }` template that `updatedAt` does not declare at all, and with no precision supplied that template must resolve to `{}` and then vanish for the two outputs to match. Change either rule and the shorthand guarantee breaks.

## Per-codec presets: one preset per codec, named for the codec

The rule that makes the namespace work: **a per-codec preset's name is its codec's base name.** `pg/timestamp@1` → `temporal.timestamp`, `pg/timestamptz@1` → `temporal.timestamptz`, `sqlite/datetime@1` → `temporal.datetime`.

That is what lets the per-codec presets share the `temporal` namespace with the behavioral convenience presets without collision, and it is why a target registers them by spreading:

```ts
temporal: {
  .../* @__PURE__ */ temporalAuthoringPresets({
    codecId: 'pg/timestamptz@1',
    nativeType: 'timestamptz',
  }),
  timestamp: /* @__PURE__ */ temporalCodecPresetWithPrecision({
    codecId: 'pg/timestamp@1',
    nativeType: 'timestamp',
  }),
  timestamptz: /* @__PURE__ */ temporalCodecPresetWithPrecision({
    codecId: 'pg/timestamptz@1',
    nativeType: 'timestamptz',
  }),
},
```

Arguments change **properties of the field** — its precision, its execution-default behavior — never its codec. A target that adds a temporal codec adds a preset named after it; it does not add an argument to an existing preset that switches codec.

Two factories exist because the codecs differ in whether they take parameters: `temporalCodecPresetWithPrecision` for `pg/timestamp@1` and `pg/timestamptz@1`, whose descriptors declare a precision params schema, and `temporalCodecPreset` for `sqlite/datetime@1`, whose descriptor declares void params. Both preserve literal types end-to-end (`const` type parameters, `as const satisfies`); without that the codec id widens to `string` and the option's `'now'` widens with it, silently costing the TypeScript surface both its inference and its enforcement.

### The convenience presets survive, and their equivalence is test-enforced

`temporal.createdAt()` and `temporal.updatedAt()` are unchanged. `createdAt` remains a **storage** default (`now()` rendered into DDL) — a different mechanism from execution defaults, and deliberately not expressible through `onCreate: now`. `updatedAt` remains shorthand for `temporal.timestamptz(onCreate: now, onUpdate: now)`.

That shorthand relationship is **a claim about two separately authored descriptors that share no code.** `temporalAuthoringPresets` and `temporalCodecPresetWithPrecision` ([timestamp-now-generator.ts](../../../packages/2-sql/9-family/src/core/timestamp-now-generator.ts)) construct their outputs independently; nothing structural forces them to agree. They are held equal by tests, and by nothing else:

- `it('updatedAt() is byte-identical to timestamptz(onCreate: now, onUpdate: now)')` in [interpreter.defaults.test.ts](../../../packages/2-sql/2-authoring/contract-psl/test/interpreter.defaults.test.ts)
- `describe('temporal.updatedAt() three-way byte-identity')` in [ts-psl-parity.test.ts](../../../packages/2-sql/2-authoring/contract-psl/test/ts-psl-parity.test.ts), covering PSL-full ≡ PSL-convenience ≡ TS-full

An editor changing either factory must keep those green, or the shorthand silently stops being a shorthand.

### What the parity tests do and do not prove

All four spellings — PSL and TypeScript, convenience and full — funnel through the same `instantiateAuthoringFieldPreset`. So the parity assertions prove **the spellings agree with each other**. They cannot prove the output is correct: a resolver bug moves all four together and every parity test stays green.

Correctness is proved by the **absolute** assertions in `describe('temporal per-codec preset lowering')` in [interpreter.defaults.test.ts](../../../packages/2-sql/2-authoring/contract-psl/test/interpreter.defaults.test.ts), which pin whole column shapes and whole execution-defaults lists against literals. The two kinds of test are not substitutes.

## Consequences

**Downstream is untouched.** `{ precision }` typeParams on the postgres timestamp codecs already flow through DDL rendering — the `@db.Timestamp(3)` spelling produces the same contract shape — and the `timestampNow` generator (control descriptor, runtime generator, adapter lowering) is reused as-is on both targets. Omitting `typeParams` entirely is safe: a parameterized codec with absent typeParams is probed with `{}` in [sql-context.ts](../../../packages/2-sql/5-runtime/src/sql-context.ts), and `undefined` is re-normalized to `{}` in resolve-codec. No emitted contract changes.

**Optional arguments are genuinely optional on the TypeScript surface.** `TupleFromArgumentDescriptors` gives an `optional: true` descriptor an optional tuple slot, which is what makes `field.temporal.timestamp()` and `field.temporal.timestamp(3)` legal. Two constraints follow. Required arguments must precede optional ones in a descriptor's `args` list: TypeScript rejects an optional tuple element followed by a required one, and `validateAuthoringHelperArguments`'s minimum-arity computation already treats an optional-before-required argument as effectively required. And a middle optional argument is skipped with an explicit `undefined` hole (`field.temporal.timestamptz(undefined, undefined, 'now')`), which the runtime already accepts.

**A preset that declares `id`/`unique` needs an overload pair.** Once the argument tuple can infer as empty, a single-signature helper with a trailing `options?: NamedConstraintSpec` binds the first real argument to `options`. `FieldHelperFunctionWithNamedConstraint` is therefore an intersection of two call signatures — no-options first, options-required second — so `field.id.nanoid({ size: 16 })` and `field.id.nanoid({ size: 16 }, { name: 'x' })` both resolve correctly.

### Which check protects which argument object

An **all-optional** preset argument object is a weak type, and TypeScript's weak-type detection rejects an object sharing none of its properties — this is what rejects `field.nanoid({ bogus: 1 })` and what routes `field.id.nanoid({ name: 'x' })` to the named-constraint overload. `ObjectArgumentType` therefore emits the optional-only mapped type directly in that case, rather than intersecting with an empty-object constituent:

```ts
export type ObjectArgumentType<Properties extends Record<string, AuthoringArgumentDescriptor>> = [
  RequiredObjectArgumentKeys<Properties>,
] extends [never]
  ? {
      readonly [K in OptionalObjectArgumentKeys<Properties>]?: ArgTypeFromDescriptor<Properties[K]>;
    }
  : {
      readonly [K in RequiredObjectArgumentKeys<Properties>]: ArgTypeFromDescriptor<Properties[K]>;
    } & {
      readonly [K in OptionalObjectArgumentKeys<Properties>]?: ArgTypeFromDescriptor<Properties[K]>;
    };
```

`{}` is not itself weak, so an intersection with it silently disables the check.

An argument object with **required** properties is not weak, and relies on the ordinary excess-property check instead. Both are correct; they are different mechanisms, and an author adding a descriptor should know which one is protecting them — the more so because, on this surface, there is no runtime check behind either.

## Alternatives considered

**A boolean argument** (`onUpdate: true`). Cheaper, but it names the *presence* of a behavior rather than the behavior itself, leaving no room for a second generator value later without a breaking change. The `option`/`map` pair is open to `values: ['now', ...]` plus a map entry; none ships today.

**A quoted string argument** (`onUpdate: "now"`). Rejected to keep one spelling per concept. Bare tokens already carry enumerated values in PSL (`onDelete: Cascade`), and accepting both spellings would mean two ways to write the same thing forever.

**Passing the token through as the generator id.** Would delete `map` entirely — and would make `timestampNow` user-facing vocabulary, contradicting ADR 169's preset-only applicability and welding the authoring spelling to an internal identifier.

**A variant-selecting argument** (`temporal.timestamp(withTimezone: true)`). Rejected: it makes an argument change the field's codec. Keeping "one preset per codec, arguments change field properties" means the codec is always readable from the spelling.

**Composing `@db.*` native-type attributes with a behavioral preset.** The two mechanisms do not compose — a preset owns the whole column descriptor — and unifying them is a larger question than this decision. `@db.*` is unchanged.

**Type-level `map` support in `ResolveTemplateValue`.** Not needed while `map` is confined to `executionDefaults`, which builder-state inference never reads. The constraint above is documented instead; the type-level resolver stays simple.

## References

- [ADR 170 — Pack-provided type constructors and field presets](ADR%20170%20-%20Pack-provided%20type%20constructors%20and%20field%20presets.md) — the registry this extends
- [ADR 169 — Declared applicability for mutation default generators](ADR%20169%20-%20Declared%20applicability%20for%20mutation%20default%20generators.md) — why `timestampNow` stays out of user vocabulary
- [ADR 158 — Execution mutation defaults](ADR%20158%20-%20Execution%20mutation%20defaults.md) — the `execution.mutations.defaults` section these phases populate

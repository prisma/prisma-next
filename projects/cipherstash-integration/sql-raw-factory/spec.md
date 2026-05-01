# Summary

Implement the user-facing `raw\`...\`` SQL factory the framework's type declarations have been promising. Layer a typed-template-literal API on top of the `RawSqlExpr` AST node — produce a `SqlQueryPlan` ready for `dataTransform`, runtime execution, or any other `SqlQueryPlan`-consuming surface — with type-level rejection of bare values, an `identifier(...)` escape hatch for SQL identifiers, and proper SQL-injection defense by construction.

# Description

`packages/2-sql/4-lanes/relational-core/src/types.ts:259` declares `RawFactory` and `RawTemplateFactory` as TypeScript interfaces. The `SqlExecutionPlan` docstring refers to "lane-level utilities (`RawTemplateFactory`, `RawFactory`, `SqlPlan`)." But there is no implementation: searching `packages/` finds zero modules that export a `raw` symbol satisfying the interface. The only places `lane: 'raw'` appears in production code are *test fixtures* that hand-construct `SqlExecutionPlan` object literals. Users who need raw SQL today have no public path.

This project ships the public factory. It does **not** ship the underlying `RawSqlExpr` AST node — that lands separately in the [raw-sql-ast-node task spec](../project-1/specs/raw-sql-ast-node.spec.md) under [Project 1](../project-1/spec.md) of the umbrella, driven by cipherstash's migration-factories needs and timed independently. This project is the *consumer* of that AST node, adding the user-facing typed-template-literal surface and the SQL-injection-defense affordances.

The cleavage:

- **Upstream (cipherstash-integration / `raw-sql-ast-node.spec.md`):** `RawSqlExpr` AST node, lowerer arm, `planFromAst` envelope helper. Package-internal construction surface — callers use `RawSqlExpr.of(fragments, args)` directly.
- **This project (`sql-raw-factory`):** Public `raw\`...\`` template-literal factory, `RawArg` type union (Expression | ParamRef | RawSqlIdentifier), `identifier(...)` SQL-identifier escape hatch, type-level rejection of bare values with helpful error messages, `param(value, opts)` ergonomic re-export.

If `raw-sql-ast-node.spec.md` ships first (likely, since cipherstash needs it), this project consumes the public AST node API as-is. If for some reason this project ships first, it must also deliver the AST node — but the natural sequencing has the AST node landing first.

**Linear:** [TML-2374](https://linear.app/prisma-company/issue/TML-2374) tracks `sql-raw-factory` at the component level. Milestone-level breakdown lives in [`plan.md`](plan.md). Component-level tracking only — no per-task or per-milestone Linear sub-issues.

# Requirements

## Functional Requirements

### `raw\`...\`` template factory

Public user-facing entry point. Exported from `@prisma-next/sql-relational-core` (or `@prisma-next/sql-builder` — see open question 1). Replaces the existing type-only declarations at `types.ts:259`:

```ts
// New, narrower interpolation type
export type RawArg =
  | Expression<ScopeField>     // anything from the typed-builder lane
  | ParamRef                    // explicit param construction
  | RawSqlIdentifier;           // identifier escape hatch — see below

export type RawTemplateFactory = (
  strings: TemplateStringsArray,
  ...values: readonly RawArg[]
) => SqlQueryPlan;
```

**Two changes vs the existing type-only declarations** at `types.ts:246-262`:

1. Return type narrows from `SqlExecutionPlan` to `SqlQueryPlan`. The factory produces a pre-lowering plan (with `ast: RawSqlExpr`); lowering happens through the standard pipeline. No downstream code consumes the old `SqlExecutionPlan` return shape (verified by grep — no implementations exist), so this is a free change.

2. Interpolation values narrow from `readonly unknown[]` to `readonly RawArg[]`. Bare-value interpolation is a type error.

### Implementation

The factory wraps `RawSqlExpr.of(...)` from the upstream AST-node spec:

```ts
// packages/2-sql/4-lanes/relational-core/src/exports/raw-factory.ts (sketch)
export const raw: RawTemplateFactory = (strings, ...values) => {
  const args: AnyExpression[] = values.map(toRawArgAst);
  const ast = RawSqlExpr.of([...strings], args);
  return planFromAst(ast, currentContract());
};

function toRawArgAst(value: RawArg): AnyExpression {
  if (isExpressionLike(value)) return value.buildAst();
  if (value instanceof ParamRef) return value;
  if (value instanceof RawSqlIdentifier) return value;   // see below
  // The type system rejects this branch, but defense in depth.
  throw new Error('raw template arg must be Expression, ParamRef, or identifier(...)');
}
```

Open question 4 below: how the factory acquires the contract for `planFromAst` (today's typed-builder factories receive a contract reference; raw needs the same). May require a small refactor of how `raw` is constructed (e.g. `createRaw(contract)` factory-of-factories pattern, or a thread-local-ish context).

### `param()` ergonomic re-export

Functionally equivalent to `ParamRef.of(value, { codecId })`, exported under a friendlier name for discoverability:

```ts
export function param<T>(value: T, opts: { codecId: string }): ParamRef {
  return ParamRef.of(value, opts);
}
```

Users who prefer `ParamRef.of(...)` directly continue to work — `param()` is purely sugar.

### `identifier(...)` for SQL identifiers

Some raw queries need to interpolate **SQL identifiers** (table names, column names) rather than values. These can't be parameterized — Postgres doesn't accept `$1` where a table name goes. A small sentinel handles this case explicitly:

```ts
export class RawSqlIdentifier {
  readonly kind = 'raw-sql-identifier' as const;
  readonly identifier: string;
  constructor(identifier: string) {
    this.identifier = identifier;
    Object.freeze(this);
  }
}

export function identifier(name: string): RawSqlIdentifier {
  return new RawSqlIdentifier(name);
}
```

The factory passes `RawSqlIdentifier` instances through to `RawSqlExpr.args` unchanged. The lowerer's `'raw-sql-identifier'` arm (added by this project to the upstream lowerer) renders the identifier inline as `"<escaped>"` text — Postgres rules: double-quote, double internal double-quotes.

**Important:** the lowerer arm for `RawSqlIdentifier` lives here, not in `raw-sql-ast-node.spec.md`. The AST-node spec ships only what cipherstash needs, and cipherstash's migration factories don't use identifier-quoting (they parameterize the identifier-like values as text params). Adding the identifier lowerer arm in this project keeps the AST-node spec narrow.

If the upstream lowerer's switch on `AnyExpression['kind']` doesn't yet handle `'raw-sql-identifier'`, this project either (a) extends the existing switch, or (b) ships an updated lowerer that does. Either way is small.

`identifier(...)` is a separate name (not `unsafe(...)`) because identifier-quoting is a defined, safe operation — there's no SQL injection risk if the escape function is correct. The risk vector is "user passes attacker-controlled string as an identifier name," which is a different threat from value-injection and is the user's responsibility.

### Type-level rejection of bare values

The `RawArg` union is the entire defense; no runtime check. A user writing:

```ts
raw`SELECT * FROM users WHERE email = ${'alice@example.com'}`   // type error
```

…hits a compile-time error because `string` doesn't match `RawArg`. The user must explicitly write:

```ts
raw`SELECT * FROM users WHERE email = ${param('alice@example.com', { codecId: 'pg/text@1' })}`
```

…or pass a typed-builder expression, or wrap in `identifier(...)`.

The error messaging is critical for adoption. TypeScript's default error on the union mismatch is unhelpful (`Argument of type 'string' is not assignable to parameter of type 'RawArg'`). Three escalating levels of polish:

- **Level 0 (ship it as-is):** Default TypeScript error. Functional, ugly.
- **Level 1 (template-literal type with branded never):** Custom error message via `RawArg` being a union with a never-branded sentinel that says "raw template values must be ParamRef, Expression, or identifier() — bare values risk SQL injection."
- **Level 2 (TypeScript >5.0 template-literal type tricks):** Detect specific bare-value cases and offer remediation suggestions.

Default: ship Level 0 first; gather feedback; polish to Level 1 if user reports indicate confusion.

### Backward compatibility

- The existing `RawFactory` interface declarations at `types.ts:246-262` are **modified** in place. Return type narrows; interpolation values narrow. No downstream code consumes the old shape.
- The `lane: 'raw'` test fixtures (`packages/2-sql/5-runtime/test/sql-runtime.test.ts:244`, `packages/2-sql/5-runtime/test/codec-async.test.ts:94`) continue to work — they hand-construct `SqlExecutionPlan` objects that don't go through the factory. Migrating them onto the new factory is a hygiene follow-up; this project doesn't gate on it.
- The `(text: string, options: RawFunctionOptions) => SqlExecutionPlan` second call signature on `RawFactory` is **dropped**. Users always go through tagged-template form.

## Non-Functional Requirements

- **No SQL injection by construction.** Bare strings are a type error at the call site. No runtime check.
- **Codec resolution is uniform.** Raw plans go through the standard codec encoding path. A `ParamRef` carrying `codecId: 'cipherstash/string@1'` gets encoded by the cipherstash codec on raw and typed paths identically.
- **Middleware seam works unchanged.** `RuntimeMiddleware.beforeExecute`'s `params.entries()` walk surfaces raw-plan params because they're real `ParamRef`s in the AST.
- **Async codec safety.** Codecs may be async (per ADR 204); the factory and the lowerer's identifier arm don't introduce sync-only paths.

## Non-goals

- **`RawSqlExpr` AST node and its lowerer arm for `'param-ref'` and inlined Expressions.** Those live in the [raw-sql-ast-node task spec](../project-1/specs/raw-sql-ast-node.spec.md) under Project 1. This project consumes that work.
- **Inlined-string raw SQL** (i.e. `raw('SELECT * FROM users')` with no params). The user can write `raw\`SELECT * FROM users\`` (an empty template literal); explicit-string-form `raw('...')` is unnecessary surface area. The dropped second call signature reflects this.
- **Raw SQL fragments as sub-expressions.** A `rawExpr\`...\`` that produces an `AnyExpression` (for use as a `WHERE` clause fragment, etc.) is a related but separate concern — defer to a follow-up if there's demand.
- **Type-level row inference from the SQL string.** Tools that parse SQL at compile-time to recover row types (à la Slonik / pg-typed) are out of scope; users supply row types explicitly via a generic on `raw\`...\`` if they want type narrowing.
- **Migration of the existing `lane: 'raw'` test fixtures.** Hygiene follow-up.
- **Mongo `mongoRaw` parity.** Mongo already has its own surface; SQL and Mongo raw paths evolve independently.
- **Targets other than Postgres for the `RawSqlIdentifier` lowering.** Each new SQL target ships its own identifier-quoting rules when added.
- **`identifier(...)` validation beyond escaping.** No reserved-keyword check, no length validation. The escape function is correct or it isn't; everything else is the user's concern.

# Acceptance Criteria

## Factory

- [ ] **AC-FAC1**: `raw\`SELECT 1\`` produces a `SqlQueryPlan` with `ast: RawSqlExpr`, `params: []`, `meta.lane: 'raw'`.
- [ ] **AC-FAC2**: `raw\`SELECT * FROM users WHERE id = ${param(42, { codecId: 'pg/int4@1' })}\`` produces a plan whose `ast.args[0]` is a `ParamRef` carrying that value and codec id.
- [ ] **AC-FAC3**: `raw\`SELECT * FROM ${identifier('user')}\`` produces an AST whose `args[0]` is a `RawSqlIdentifier` instance.
- [ ] **AC-FAC4**: `raw` accepts `Expression<ScopeField>`-shaped values from the typed builder. Their `buildAst()` AST is inlined into `args`.
- [ ] **AC-FAC5**: A plan from `raw\`...\`` flows through `dataTransform({ run: () => raw\`...\` })` and produces a `DataTransformOperation` whose serialized `{sql, params}` matches the rendered template.

## Type-level

- [ ] **AC-TYPE1**: `raw` parameter type is `(strings: TemplateStringsArray, ...values: readonly RawArg[]) => SqlQueryPlan`.
- [ ] **AC-TYPE2**: Negative type test asserts `raw\`...${'string'}\`` is a type error.
- [ ] **AC-TYPE3**: Negative type test asserts `raw\`...${42}\`` is a type error.
- [ ] **AC-TYPE4**: Positive type test asserts `raw\`...${param(42, { codecId: 'pg/int4@1' })}\`` typechecks.
- [ ] **AC-TYPE5**: Positive type test asserts `raw\`...${identifier('user')}\`` typechecks.
- [ ] **AC-TYPE6**: Positive type test asserts `raw\`...${typedBuilderExpression}\`` typechecks (where `typedBuilderExpression` is anything implementing `Expression<ScopeField>`).

## Identifier escape hatch

- [ ] **AC-ID1**: `identifier(name)` returns a frozen `RawSqlIdentifier`.
- [ ] **AC-ID2**: A `RawSqlIdentifier` in a raw plan lowers to `"<escaped name>"` (Postgres double-quoting; internal double-quotes doubled).
- [ ] **AC-ID3**: Adversarial inputs (`name with "quote`, `name\u0000with null`, `name\nwith newline`) lower to a quoted form that doesn't break out of the quote — verified with a fuzz-test fixture.

## Composition with existing surfaces

- [ ] **AC-COMP1**: A raw plan executes against a real Postgres database and returns the expected rows.
- [ ] **AC-COMP2**: A raw plan's `ParamRef`s are visible to `RuntimeMiddleware.beforeExecute`'s `params.entries()` walk (post-[middleware-param-transform task spec](../project-1/specs/middleware-param-transform.spec.md)).
- [ ] **AC-COMP3**: Cipherstash's bulk-encrypt middleware runs against a raw plan that includes a `param(value, { codecId: 'cipherstash/string@1' })` — the param's value is bulk-encrypted before the SQL executes.

# Other Considerations

## Security

- **SQL injection.** The `RawArg` type union is the entire defense; no runtime check. Bare values are unrepresentable in a well-typed call. The `identifier(...)` escape hatch is the only path to text interpolation, and it goes through a defined escape function rather than direct string concatenation.
- **Identifier escaping correctness.** The escape function for Postgres is well-known (`"name"` with internal `"` doubled to `""`). A unit test pins the behavior for adversarial inputs.
- **Threat surface.** A library author could accept user input and pass it to `identifier(...)` thinking it's safe — the type doesn't communicate "attacker-controlled inputs make poor identifiers." This is a documentation concern, not a type concern. Document loudly that `identifier(...)` is for trusted (typically literal or app-config) input.

## Cost

CI delta: ~10-15 unit tests for the factory + identifier path; ~3 integration tests for end-to-end execution and middleware composition. Negligible runtime cost.

## Observability

`SqlExecutionPlan.meta.lane: 'raw'` continues to be the discriminator. Existing telemetry by `lane` works unchanged.

## Data Protection

No new data-protection surface. Codec encoding runs identically against raw-plan and typed-plan params.

# References

- [Umbrella spec](../spec.md) — sql-raw-factory's parent project.
- [raw-sql-ast-node task spec](../project-1/specs/raw-sql-ast-node.spec.md) — upstream sequencing dependency. Ships `RawSqlExpr`, the lowerer arm for `'param-ref'` and inlined Expressions, `planFromAst`.
- [`packages/2-sql/4-lanes/relational-core/src/types.ts:246-262`](../../../packages/2-sql/4-lanes/relational-core/src/types.ts) — current type-only `RawTemplateFactory` / `RawFactory` declarations (modified by this project).
- [`packages/2-sql/4-lanes/relational-core/src/ast/types.ts:395-436`](../../../packages/2-sql/4-lanes/relational-core/src/ast/types.ts) — existing `ParamRef` class.
- [`packages/2-sql/4-lanes/relational-core/src/expression.ts`](../../../packages/2-sql/4-lanes/relational-core/src/expression.ts) — `toExpr` shape this factory's discriminator mirrors.
- [`packages/3-targets/3-targets/postgres/src/core/migrations/operations/data-transform.ts`](../../../packages/3-targets/3-targets/postgres/src/core/migrations/operations/data-transform.ts) — `dataTransform` factory that consumes raw plans unchanged once this factory exists.

# Open Questions

1. **Public entry point for `raw`.** Definitions could live in `@prisma-next/sql-relational-core` and re-export from `@prisma-next/sql-builder` (where users already import the typed-builder surface) for discoverability. Default: dual-export.
2. **Drop the second call signature confirmed?** `RawFactory`'s current second overload `(text: string, options: RawFunctionOptions) => SqlExecutionPlan` is dropped per non-goal above. Confirm.
3. **Error messaging investment.** Default Level 0 (TypeScript's default). Polish to Level 1 (branded never with custom message) only on user feedback. Confirm.
4. **Contract acquisition for `planFromAst`.** The typed builder gets the contract from its construction context (`postgres<Contract>({ contractJson })`). The raw factory needs the same context — but it's a free top-level function, not a method on a contracted client. Two reasonable patterns: (a) a `createRaw(contract)` factory-of-factories that returns a contract-bound `raw`, (b) a thread-local-ish or implicit-context lookup. (a) is more honest. Confirm during implementation.
5. **`identifier(...)` lowerer-arm placement.** Lowerer arm for `RawSqlIdentifier` lands in this project, but it lives next to the `RawSqlExpr` arm in the renderer module. If the renderer's switch on `kind` is in a single function, this is a one-line addition. Confirm during implementation.
6. **Targets other than Postgres.** SQLite / MySQL / future SQL targets each need their own `RawSqlIdentifier` lowerer arm with their own quoting rules. This project ships Postgres only and documents the extension point.

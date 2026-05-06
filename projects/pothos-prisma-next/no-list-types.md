# `t.prismaField` doesn't support list types ✅ fixed

> Status: fixed. `t.prismaField` now accepts `type: ModelName | [ModelName]`.
> The runtime shim in `field-builder.ts` extracts the model name regardless
> of form (`Array.isArray(type) ? type[0] : type`) and stashes it as a
> string in the `PRISMA_NEXT_PREPARED` extension. Pothos's own
> `ShapeFromTypeParam` machinery resolves list-vs-single output typing
> from `type` automatically — no `IsList` generic needed (the original
> sketch in this doc over-engineered that part).
>
> Demo updated: `users: t.prismaField({ type: ['User'], resolve: (c) => c.all().toArray() })`.
> The singular form (`userById`) still works. End-to-end verified: `{ users { id firstName postCount } }` returns the expected list with the auto-include walker still firing per-user.

The original analysis is preserved below.

---

The plugin's `t.prismaField` only accepts `type: ModelName` (a string). There is no `type: [ModelName]` form. The most basic GraphQL pattern — a list-of-objects query (`users: [User!]!`) — is unexpressible through the plugin. Plugin-prisma supports both forms; this plugin's surface only does the singular case.

This is the most directly visible "this looks unfinished" gap in the demo. Worth fixing before the handoff conversation, or at minimum surfacing explicitly so the Pothos author doesn't conclude prisma-next can't return arrays.

## The smoking gun

`examples/pothos-integration/src/schema.ts:64-78`:

```ts
builder.queryType({
  fields: (t) => ({
    users: t.prismaField({
      type: 'User',
      resolve: (collection) => collection.all().firstOrThrow(),  // ← single user!
    }),
    userById: t.prismaField({
      type: 'User',
      args: { id: t.arg.string({ required: true }) },
      resolve: (collection, _root, args) =>
        collection.where({ id: args.id }).all().firstOrThrow(),
    }),
  }),
});
```

The field is named `users` (plural) but resolves to ONE user via `firstOrThrow()`. This isn't a stylistic choice — it's the only resolver shape the plugin's types accept. `collection.all().toArray()` (the list form) doesn't typecheck because `type: 'User'` constrains the field to a non-list output.

The spec example was actually `me: t.prismaField({ ... })` — a singular field, semantically correct. The demo's renaming to `users` while keeping the singular resolver is the tell.

## What users would want to write

```ts
// Canonical Pothos auto-include list query (works in plugin-prisma):
users: t.prismaField({
  type: ['User'],
  resolve: (collection) => collection.all().toArray(),
}),

// Or for a paginated slice:
recentUsers: t.prismaField({
  type: ['User'],
  args: { limit: t.arg.int({ required: true }) },
  resolve: (collection, _root, args) =>
    collection.orderBy({ createdAt: 'desc' }).take(args.limit).all().toArray(),
}),
```

Neither compiles in this plugin. To return a list of users today, the user has to drop back to a plain `t.field`:

```ts
users: t.field({
  type: ['User'],
  resolve: () => db.User.all().toArray(),
}),
```

…which works but **bypasses the auto-include walker entirely**. No `.select(...)` projection from the GraphQL selection set, no `.include(rel, ...)` for nested relations. The GraphQL response then either fails (because requested columns aren't selected) or fires N+1 queries (because relations aren't preloaded). The whole point of the plugin is gone.

## Why it doesn't compile

`examples/pothos-integration/src/plugin/global-types.ts:227-251`:

```ts
interface PrismaNextRootFieldOptions<
  Types extends SchemaTypes,
  ParentShape,
  ModelName extends string,
  Args extends InputFieldMap,
  Kind extends FieldKind,
> {
  type: ModelName;                         // ← string, not ModelName | [ModelName]
  description?: string;
  nullable?: boolean;
  args?: Args;
  _kind?: Kind;
  resolve: (
    collection: Types['PrismaNextContract'] extends Contract<SqlStorage>
      ? Collection<Types['PrismaNextContract'], ModelName>
      : Collection<Contract<SqlStorage>, ModelName>,
    parent: ParentShape,
    args: InputShapeFromFields<Args>,
    context: Types['Context'],
    info: GraphQLResolveInfo,
  ) => MaybePromise<unknown>;
}
```

`type: ModelName` admits only the singular string. The resolver's return type is `MaybePromise<unknown>` so a list return *would* technically compile at the resolver level, but Pothos generates the GraphQL output type from `type` — so the GraphQL schema would advertise `User`, the resolver would return an array, and runtime/serialization breaks.

The runtime shim has the same gap (`field-builder.ts:27-40`):

```ts
rootFieldBuilderProto['prismaField'] = function prismaField(
  this: { field: (cfg: unknown) => unknown },
  options: PrismaFieldInternalOptions,
) {
  const { type, resolve, ...rest } = options;
  return this.field({
    ...rest,
    type,                                  // ← passed through as-is, no array branching
    resolve: resolve as never,
    extensions: { [PRISMA_NEXT_PREPARED]: type },
  });
};
```

`type` is forwarded directly. No `Array.isArray(type) ? [type[0]] : type` branch. And the `PRISMA_NEXT_PREPARED` extension stores `type` as a string — so when `wrapResolve` reads it back at `index.ts:27` via `ext[PRISMA_NEXT_PREPARED] as string`, the assumption is hardcoded.

## Plugin-prisma's reference

`.claude/repos/hayes/pothos/packages/plugin-prisma/src/field-builder.ts:32-60`:

```ts
fieldBuilderProto.prismaField = function prismaField({ type, resolve, ...options }) {
  const modelOrRef = Array.isArray(type) ? type[0] : type;          // ← unwrap list form
  const typeRef =
    typeof modelOrRef === 'string'
      ? getRefFromModel(modelOrRef, this.builder)
      : (modelOrRef as ObjectRef<SchemaTypes, unknown>);
  const typeParam = Array.isArray(type)
    ? ([typeRef] as [ObjectRef<SchemaTypes, unknown>])              // ← rewrap as list ref
    : typeRef;
  return this.field({
    ...(options as {}),
    type: typeParam,                                                // ← list or single
    resolve: ...,
  }) as never;
};
```

Three lines of array-branching at the type level + at the runtime shim. The rest of plugin-prisma's `wrapResolve` doesn't change — Pothos's own field-config carries the list-ness from there, and the resolver return type is whatever the user wrote.

## What needs to change in the prisma-next plugin

### Type-level — `global-types.ts`

```ts
// 1. Allow array form on `type`:
interface PrismaNextRootFieldOptions<...> {
  type: ModelName | [ModelName];
  // ...rest unchanged
  resolve: (
    collection: WalkerCollection<TContract, ModelName>,
    parent: ParentShape,
    args: InputShapeFromFields<Args>,
    context: Types['Context'],
    info: GraphQLResolveInfo,
  ) => MaybePromise<
    [ModelName] extends [typeof options.type]
      ? RowFor<Types, ModelName>[]   // list form: array of rows
      : RowFor<Types, ModelName>      // singular form: one row
  >;
}

// 2. Adjust the augmentation in PothosSchemaTypes.RootFieldBuilder
//    so list/single both flow through Pothos's own list-handling.
prismaField<ModelName extends string, Args extends InputFieldMap, IsList extends boolean = false>(
  options: PrismaNextRootFieldOptions<Types, ParentShape, ModelName, Args, Kind, IsList>,
): FieldRef<Types, IsList extends true ? RowFor<Types, ModelName>[] : RowFor<Types, ModelName>>;
```

(Sketch — the exact form depends on how cleanly `IsList` falls out of the `type` parameter via inference.)

### Runtime shim — `field-builder.ts`

```ts
rootFieldBuilderProto['prismaField'] = function prismaField(
  this: { field: (cfg: unknown) => unknown },
  options: PrismaFieldInternalOptions,
) {
  const { type, resolve, ...rest } = options;
  const isList = Array.isArray(type);
  const modelName = isList ? type[0] : type;
  return this.field({
    ...rest,
    type,                                       // pass through list or single
    resolve: resolve as never,
    extensions: {
      [PRISMA_NEXT_PREPARED]: modelName,        // store the model name (always a string)
      [PRISMA_NEXT_PREPARED_LIST]: isList,      // remember the list-ness for wrapResolve
    },
  });
};
```

### `wrapResolve` — `index.ts:26-54`

Already handles both shapes correctly at the result mapping stage:

```ts
return Array.isArray(result) ? result.map((row) => reshape(row)) : reshape(result);
```

So the existing reshape branch covers both. No change needed there — `wrapResolve` reshapes either form. The only adjustment is reading the model name from the extension (which now always stores a string) instead of expecting `type` itself.

### Demo — `schema.ts`

Update once the plugin supports it:

```ts
users: t.prismaField({
  type: ['User'],                                   // ← list form
  resolve: (collection) => collection.all().toArray(),
}),
me: t.prismaField({
  type: 'User',
  resolve: (collection, _root, _args, ctx) =>
    collection.where({ id: ctx.userId }).all().firstOrThrow(),
}),
```

## Test coverage to add

- Walker test that asserts the prepared collection is the same shape regardless of list-vs-single (the walker doesn't care; Pothos's output type does).
- An integration test that boots the schema, runs `{ users { id } }`, and asserts on a multi-row response (currently the demo returns one).
- A type test (`expectTypeOf`) that the resolver's return-type constraint is `Row[]` for the list form and `Row` for the singular form.

## Severity

**Production: high.** Anyone reading the demo to evaluate prisma-next will see "the most basic GraphQL pattern requires a workaround." The fix is small and the impact is large; this is the single most worthwhile pre-handoff cleanup.

**For the same-day demo:** the headline differentiator (drafts/publishedPosts/postCount) is on a per-row prismaObject, not on the entry point, so this gap doesn't block the demo's value proposition. But the audience will notice the singular `users` field.

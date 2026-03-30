# Typed Cross-Model Refs: Before and After

**Status:** implemented in the current refined Option A prototype.

## Goal

Improve cross-model foreign-key authoring in refined Option A without turning the type system into a graph solver.

In the current surface, local refs are good:

- `cols.id`
- `cols.userId`

Cross-model refs are now good too:

- `User.refs.id`
- `User.ref('id')`

The older fallback still exists:

- `constraints.ref('User', 'id')`

That fallback is no longer the primary path.

## Previous Shape

This was the pre-token shape.

```ts
import {
  defineContract,
  field,
  model,
  rel,
} from '@prisma-next/sql-contract-ts/contract-builder';

export const contract = defineContract({
  target: postgresPack,
  models: {
    User: model({
      fields: {
        id: field.generated(uuidv4()).id(),
        email: field.column(textColumn),
      },
      relations: {
        posts: rel.hasMany('Post', { by: 'userId' }),
      },
    }).sql({
      table: 'user',
    }),

    Post: model({
      fields: {
        id: field.generated(uuidv4()).id(),
        userId: field.column(textColumn),
        title: field.column(textColumn),
      },
      relations: {
        user: rel.belongsTo('User', { from: 'userId', to: 'id' }),
      },
    }).sql(({ cols, constraints }) => ({
      table: 'post',
      foreignKeys: [
        constraints.foreignKey(cols.userId, constraints.ref('User', 'id'), {
          name: 'post_userId_fkey',
        }),
      ],
    })),
  },
});
```

## Current Problems

### 1. Cross-model refs are still stringly

`constraints.ref('User', 'id')` is cleaner than `refs['User']!['id']!`, but it is still based on raw strings.

That means:

- it does not feel like the rest of the typed surface
- it is easier for humans and LLMs to mistype
- it does not guide discovery well in the editor

### 2. Autocomplete stops at the model boundary

Inside `.sql(...)`, `cols.*` is pleasant because it is local and filtered to scalar fields. Cross-model refs lose that experience.

The editor can help with:

- `cols.id`
- `cols.userId`

But not with the target side in the same way.

### 3. The API tells two different stories

Local refs are object-shaped and type-driven. Cross-model refs are function-plus-strings.

That inconsistency matters:

- it makes the surface feel less polished
- it creates more special cases for docs and LLM prompts
- it weakens the “typed refs instead of string arrays” design story

### 4. The obvious-looking fix is expensive

The appealing shape is this:

```ts
foreignKeys: [constraints.foreignKey(cols.userId, refs.User.id)]
```

But that requires the `.sql(...)` callback for one model to know the exact scalar field map of every other model in the contract.

That pushes the API toward a whole-contract, self-referential type model. It is possible, but it is exactly the kind of design that tends to:

- slow down the TypeScript server
- make inference brittle
- create complicated error messages

## Implemented Shape

The implemented step is to make models into typed tokens, let those tokens expose their own scalar refs, and allow staged `.relations(...)` so mutually recursive graphs do not collapse into `any`.

```ts
import {
  defineContract,
  field,
  model,
  rel,
} from '@prisma-next/sql-contract-ts/contract-builder';

const User = model('User', {
  fields: {
    id: field.generated(uuidv4()).id(),
    email: field.column(textColumn),
  },
});

const Post = model('Post', {
  fields: {
    id: field.generated(uuidv4()).id(),
    userId: field.column(textColumn),
    title: field.column(textColumn),
  },
});

export const contract = defineContract({
  target: postgresPack,
  models: {
    User: User.relations({
      posts: rel.hasMany(Post, { by: 'userId' }),
    }).sql({
      table: 'user',
    }),
    Post: Post.relations({
      user: rel.belongsTo(User, { from: 'userId', to: 'id' }),
    }).sql(({ cols, constraints }) => ({
      table: 'post',
      foreignKeys: [
        constraints.foreignKey(cols.userId, User.refs.id, {
          name: 'post_userId_fkey',
        }),
      ],
    })),
  },
});
```

`User.ref('id')` is the equivalent method form when property access is less convenient.

## Why This Is Better

### 1. Better autocomplete

The editor can offer the scalar fields that belong to `User`.

That means:

- `User.ref('id')` can autocomplete valid field names
- `User.refs.id` can autocomplete directly
- relation names like `posts` do not need to appear

### 2. Better safety

The model token knows its own scalar field set.

So these can fail early:

- `User.ref('posts')`
- `User.ref('doesNotExist')`
- `User.refs.posts`

That is a real improvement over raw strings.

### 3. Better ergonomics for LLMs

Model tokens are stable handles.

That helps LLMs because:

- a model can be defined once and reused
- FK targets become structured references, not quoted strings
- extracted model constants are easier to diff, edit, and move

This:

```ts
constraints.foreignKey(cols.userId, User.ref('id'))
```

is easier for an LLM to generate correctly than this:

```ts
constraints.foreignKey(cols.userId, constraints.ref('User', 'id'))
```

The staged `.relations(...)` step also helps for recursive graphs because it keeps the field/token declaration phase separate from the wiring phase.

### 4. Better separation of concerns

The current `refs.User.id` idea tries to make the entire contract visible inside every `.sql(...)` callback.

Model tokens avoid that.

Each model only needs to carry:

- its own scalar field refs
- its own declared name

That is much cheaper, conceptually and type-wise, than making every callback understand the whole graph.

### 5. Better fit with extracted model constants

Refined Option A already reads well when models are extracted:

```ts
const User = model('User', { fields: { ... } });
const Post = model('Post', { fields: { ... } });

defineContract({
  models: {
    User: User.relations({ ... }).sql(...),
    Post: Post.relations({ ... }).sql(...),
  },
});
```

Adding typed model tokens leans into that strength instead of fighting it.

## Why Not Jump Straight to `refs.User.id`

Because it is the expensive version of the same idea.

To make `refs.User.id` truly typed, the `.sql(...)` callback has to know:

- every model name in the contract
- every scalar field name on every model
- which fields are valid scalar FK targets

That is possible, but it likely comes with:

- heavier generics
- slower editor feedback
- more fragile inference
- worse error messages when anything goes wrong

The token-based design gets most of the ergonomics without paying that cost.

## Recommendation

Push on typed cross-model refs in this order:

1. Keep `constraints.ref('Model', 'field')` as the fallback.
2. Add named model tokens, for example `model('User', { ... })`.
3. Let those tokens expose typed scalar refs through either `User.ref('id')` or `User.refs.id`.
4. Reassess later whether a contract-wide `refs.User.id` surface is still worth the extra type complexity.

## Bottom Line

The current cross-model story is good enough to ship, but not good enough to stop.

The next improvement should not be “make `refs` smarter everywhere.” It should be “make models reusable typed tokens.”

That gives:

- better autocomplete
- better safety
- better LLM ergonomics
- lower TypeScript complexity than a whole-contract `refs.User.id` design

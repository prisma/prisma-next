# TS Contract Authoring API Recommendation

## Recommendation

If your goal is:

- terse authoring
- intuitive structure
- strong type safety
- portability across SQL targets
- good future model/query type inference
- good LLM-assisted editing and refactoring

then the best long-term design is still **refined Option A**, but with a sharper interpretation than the current prototype slice:

- one shared semantic authoring core for TS and PSL
- pack-provided type constructors and field presets as the source vocabulary, per ADR 170
- strong typed refs for local and cross-model authoring
- a minimal SQL overlay used only when the semantic layer cannot express the intent
- first-class support for fully typed no-emit authoring

## Design Principles

- strong type safety, including auto-completed references to other models and fields, with validation
- no compatibility-checking between defaults and underlying database representations during authoring
- one shared semantic layer for PSL and TS, derived from the same data structures and helper registries
- no-emit remains a first-class fully typed experience
- the DSL changes as framework composition changes, because packs/targets own the vocabulary
- keep `.sql()` as small and local as possible
- let authors speak in application-domain terminology first, falling back to database terminology only as a last resort

## Target Shape

The recommended end-state is:

```ts
const User = model('User', {
  fields: {
    id: field.id.uuid(),
    email: field.text().unique().sql({ unique: { name: 'app_user_email_key' } }),
  },
  relations: {
    posts: rel.hasMany('Post', { by: 'authorId' }),
  },
  attributes: ({ self, attr }) => ({
    primary: attr.primaryKey(self.id, { name: 'app_user_pkey' }),
  }),
}).sql({
  table: 'app_user',
});

const Post = model('Post', {
  fields: {
    id: field.id.uuid(),
    authorId: field.uuid(),
    title: field.text(),
  },
  relations: {
    author: rel.belongsTo(User, { from: 'authorId', to: User.ref('id') }).sql({
      fk: { name: 'blog_post_author_id_fkey', onDelete: 'cascade' },
    }),
  },
  attributes: ({ self, attr }) => ({
    primary: attr.primaryKey(self.id),
  }),
}).sql({
  table: 'blog_post',
  fields: {
    authorId: { column: 'author_id' },
  },
});
```

with an object-literal contract shell:

```ts
defineContract({
  target,
  extensionPacks,
  naming,
  types,
  models,
})
```

The exact spellings of `attributes`, local `.sql(...)`, or `User.ref('id')` can still move. The important part is the layering:

- field presets and type constructors carry most meaning
- model attributes express shared semantic constraints such as keys and uniques
- relation and field-local `.sql(...)` handle one-off storage naming overrides
- model-level `.sql(...)` is the last-resort place for table mapping and advanced SQL-only detail

If the team wants a fallback for migration comfort, keep **Option B** only as a fluent shell over the same inner semantic DSL. Do not let it become a separate per-field builder language.

My recommendation is:

- **Best long-term design:** refined Option A
- **Safer fallback:** Option B as a narrow contract shell only
- **Best for LLMs:** refined Option A

## Why Refined Option A Wins

- It separates domain intent from SQL detail cleanly.
- It gives the best autocomplete story for local field refs through `cols.*`.
- It localizes target-specific code in `.sql(...)`, which helps portability.
- It is the best base for future inferred model/query/client types.
- It is easier for humans and LLMs to summarize, diff, and refactor.

The crucial improvement is not “object literal versus chain” by itself. The crucial improvement is:

- one canonical semantic DSL
- one pack-driven helper vocabulary shared by TS and PSL
- typed refs instead of string arrays
- minimal SQL overlay instead of SQL-first authoring

## Shared Design Rules

- Stage 1 is split into `fields` and `relations`.
- Stage 1 should also have a shared semantic layer for model-level attributes such as primary keys and uniques.
- `.sql(...)` should own only SQL/storage detail that the semantic layer cannot express cleanly.
- `cols` exposes only column-backed scalar fields.
- Cross-model refs should be typed and validated, ideally through model tokens or an equivalent low-cost mechanism.
- Constraint helpers should stay tiny and should not become the main authoring language.
- Primary keys must support both single-field and composite forms.
- Prefer local overrides for a single unique or a single foreign key over large model-level SQL bags.
- Target-specific helpers should be visibly namespaced.
- TS and PSL must lower through the same pack-provided constructors, presets, and semantic helpers.
- Graph-wide validation should happen mostly at `build` / emit time.
- Do not evaluate “does this default physically fit this storage representation?” during authoring.
- Keep one spelling per concept.

## Refined Option A

### Interpreting the current prototype

The current implementation slice proves the lowering path, no-emit typing, and local `cols.*` refs. It is not yet the full end-state described above.

In particular, the current slice still:

- still uses a string-based cross-model ref fallback inside `.sql(...)`
- uses a lighter cross-model ref story than the desired typed token approach
- keeps the scalar helper vocabulary intentionally pack-driven rather than shipping the full aspirational preset surface yet

### Full example

```ts
import {
  defineContract,
  field,
  model,
  rel,
} from '@prisma-next/sql-contract-ts/contract-builder';
import { textColumn, timestamptzColumn } from '@prisma-next/adapter-postgres/column-types';
import pgvector from '@prisma-next/extension-pgvector/pack';
import postgresPack from '@prisma-next/target-postgres/pack';
import { uuidv4 } from '@prisma-next/ids';
import { vector } from '@prisma-next/extension-pgvector/column-types';

const Account = model({
  fields: {
    id: field.generated(uuidv4()).id({ name: 'app_user_pkey' }),
    email: field.column(textColumn).column('email_address').unique({
      name: 'app_user_email_key',
    }),
    createdAt: field.column(timestamptzColumn).column('created_at').defaultSql('now()'),
    invitedById: field.column(textColumn).column('invited_by_id').optional(),
  },
  relations: {
    invitedBy: rel.belongsTo('Account', { from: 'invitedById', to: 'id' }),
    invitees: rel.hasMany('Account', { by: 'invitedById' }),
    posts: rel.hasMany('Post', { by: 'authorId' }),
  },
})
  .attributes(({ fields, constraints }) => ({
    uniques: [
      constraints.unique([fields.invitedById, fields.email], {
        name: 'app_user_invited_by_email_key',
      }),
    ],
  }))
  .sql(({ cols, constraints }) => ({
    table: 'app_user',
    indexes: [constraints.index(cols.email, { name: 'app_user_email_idx' })],
    foreignKeys: [
      constraints.foreignKey(cols.invitedById, constraints.ref('Account', 'id'), {
        name: 'app_user_invited_by_id_fkey',
        onDelete: 'setNull',
        onUpdate: 'cascade',
      }),
    ],
  }));

const Post = model({
  fields: {
    id: field.generated(uuidv4()).id({ name: 'blog_post_pkey' }),
    authorId: field.column(textColumn).column('author_id'),
    title: field.column(textColumn),
    slug: field.column(textColumn).default('draft'),
    createdAt: field.column(timestamptzColumn).column('created_at').defaultSql('now()'),
    embedding: field.namedType('Embedding1536').optional(),
  },
  relations: {
    author: rel.belongsTo('Account', { from: 'authorId', to: 'id' }),
  },
})
  .attributes(({ fields, constraints }) => ({
    uniques: [
      constraints.unique([fields.authorId, fields.slug], {
        name: 'blog_post_author_slug_key',
      }),
    ],
  }))
  .sql(({ cols, constraints }) => ({
    table: 'blog_post',
    indexes: [constraints.index(cols.authorId, { name: 'blog_post_author_id_idx' })],
    foreignKeys: [
      constraints.foreignKey(cols.authorId, constraints.ref('Account', 'id'), {
        name: 'blog_post_author_id_fkey',
        onDelete: 'cascade',
        onUpdate: 'cascade',
        index: true,
      }),
    ],
  }));

const Membership = model({
  fields: {
    accountId: field.column(textColumn).column('account_id'),
    postId: field.column(textColumn).column('post_id'),
    createdAt: field.column(timestamptzColumn).column('created_at').defaultSql('now()'),
  },
})
  .attributes(({ fields, constraints }) => ({
    id: constraints.id([fields.accountId, fields.postId], {
      name: 'membership_pkey',
    }),
  }))
  .sql(({ cols, constraints }) => ({
    table: 'membership',
    indexes: [constraints.index(cols.createdAt, { name: 'membership_created_at_idx' })],
    foreignKeys: [
      constraints.foreignKey(cols.accountId, constraints.ref('Account', 'id'), {
        name: 'membership_account_id_fkey',
      }),
      constraints.foreignKey(cols.postId, constraints.ref('Post', 'id'), {
        name: 'membership_post_id_fkey',
      }),
    ],
  }));

export const contract = defineContract({
  target: postgresPack,
  extensionPacks: { pgvector },
  naming: { tables: 'snake_case', columns: 'snake_case' },
  storageHash: 'sha256:refined-option-a',
  foreignKeyDefaults: { constraint: true, index: false },
  capabilities: {
    postgres: {
      returning: true,
      lateral: true,
      jsonAgg: true,
      'defaults.now': true,
      'pgvector/cosine': true,
    },
  },
  types: {
    Embedding1536: vector(1536),
  },
  models: {
    Account,
    Post,
    Membership,
  },
});
```

### Where refined Option A excels

- Best separation between model intent and SQL/storage detail.
- Best local autocomplete story via `fields.*` and `cols.*`.
- Best portability boundary for target swaps.
- Best foundation for future `InferModels` / query payload inference.
- Best shape for codemods and LLM-assisted edits.
- Best reviewability because a model is one self-contained block.

### Where refined Option A still struggles

- It still puts design pressure on `field`, `rel`, `attributes`, and `constraints`; the vocabulary must stay coherent.
- Large models can still become visually dense.
- It can feel “magical” if the lowering path is not easy to inspect.
- Cross-model relation definitions still use string model and field names even though foreign-key targets now have typed model tokens.
- If too many aliases are added, it will degrade into declarative soup.

### How to placate those gaps

- Keep `fields` and `relations` separate.
- Keep `.attributes(...)` focused on identity and uniqueness only.
- Keep `.sql(...)` small and structural.
- Keep refs opaque and helper-driven.
- Push graph-wide validation to `build` / emit time.
- Add an explain/debug surface later, but do not block the first implementation slice on it.
- Be ruthless about vocabulary discipline.

## Option B, but Narrow

### Shape

If Option B survives at all, it should look like this:

```ts
defineContract()
  .target(target)
  .extensionPacks(extensionPacks)
  .naming(naming)
  .types(types)
  .models(models)
```

The inner model DSL must still be the same refined Option A DSL:

```ts
const Account = model({
  fields: {
    id: field.generated(uuidv4()).id(),
    email: field.column(textColumn).unique(),
  },
  relations: {
    posts: rel.hasMany('Post', { by: 'authorId' }),
  },
}).sql({ table: 'account' });
```

### What Option B must not become

```ts
.model('Account', (m) =>
  m
    .field(...)
    .field(...)
    .relation(...)
    .constraint(...)
)
```

That version is worse for:

- readability
- diffability
- TS server performance
- portability review
- LLM reliability

## Type-Level and Performance Guidance

- Keep field helper return types shallow and mostly opaque.
- Infer field names from object keys at the `fields` boundary.
- Build `cols` from a simple mapped type over scalar field keys.
- Avoid eager graph-wide conditional types during authoring.
- Make `InferModels` and `InferQueryPayload` opt-in on the final built contract.
- Prefer small helper surfaces over overloaded “smart” APIs.

## Which Is Better for LLMs?

**Refined Option A is better for LLMs.**

Why:

- A model is a self-contained block.
- Stage 1 and stage 2 have different jobs.
- `cols.id` is easier to generate and preserve than string arrays or long chains.
- Portability boundaries are easier to see.
- Partial edits are safer because the local context is compact and explicit.

Option B is still workable for LLMs if it stays a top-level shell over the same DSL. It gets much worse if it turns into repeated `.field()` / `.relation()` / `.constraint()` chains.

## Bottom Line

Choose refined Option A if the bar is:

- elegant contract authoring
- strong autocomplete in constraint authoring
- low rewrite cost for target swaps
- future inferred model/query/client types
- LLM-friendly contract maintenance
- better long-term ergonomics

Choose Option B only if the team values familiarity and short-term delivery safety more than those long-term properties, and even then keep it narrow.

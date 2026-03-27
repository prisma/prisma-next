# Summary

Prisma Next should redesign the SQL TypeScript contract authoring surface around a refined Option A with a shared semantic core and a minimal SQL overlay. TS and PSL should derive from the same pack-provided constructors, presets, and lowering utilities from ADR 170, while `contract.ts` stays terse, intuitive, fully typed in no-emit mode, and portable across SQL targets. The redesign must continue to emit the same canonical `contract.json` and `contract.d.ts` through `prisma-next contract emit`.

# Description

Today the TS surface is explicit but too mechanical for common authoring:

- authors define tables and models separately
- scalar fields repeat the same information at the storage and model layers
- relations restate table/column coordinates that are already locally knowable
- common authoring patterns such as IDs, timestamps, defaults, named constraints, and mapped names require low-level choreography

This project redesigns the SQL TypeScript authoring surface only. It does not change:

- the emitted `contract.json`
- the emitted `contract.d.ts`
- runtime validation semantics
- the CLI emission command

The new surface should let authors describe the portable model graph first, express shared semantic constraints close to the fields and relations they belong to, and fall back to SQL/storage details only when necessary. That higher-level intent must still lower to the exact same explicit contract IR.

## Design principles

- strong type safety, including auto-completed references to other models and fields, with validation
- no compatibility-checking between defaults and underlying database representations during authoring
- one shared semantic layer for PSL and TS, derived from the same pack-provided constructors, presets, and helpers from ADR 170
- no-emit remains a first-class fully typed experience
- the DSL changes as framework composition changes, because packs, targets, and families own the vocabulary
- keep `.sql()` as small and local as possible
- let authors speak in application-domain terminology first, falling back to database terminology only as a last resort

## Final public API direction

The chosen direction is still refined Option A, but with a sharper target shape than the current prototype slice:

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

The contract shell should be object-literal based:

```ts
export const contract = defineContract({
  target: postgresPack,
  extensionPacks: { pgvector },
  naming: { tables: 'snake_case', columns: 'snake_case' },
  storageHash: 'sha256:...',
  foreignKeyDefaults: { constraint: true, index: false },
  capabilities: {
    postgres: {
      returning: true,
      lateral: true,
      jsonAgg: true,
    },
  },
  types: {
    Role: type.enum('account_role', ['ADMIN', 'MEMBER']),
  },
  models: {
    User,
    Post,
  },
});
```

The exact spellings of `attributes`, local `.sql(...)`, or `User.ref('id')` can still move. The non-negotiable part is the layering:

- pack-provided type constructors and field presets carry most meaning
- shared semantic constraints such as primary keys and uniques live outside the SQL overlay
- one-off storage naming overrides stay local to the field, relation, or attribute they customize
- model-level `.sql(...)` is the last-resort place for table mapping and advanced SQL-only detail

## Design rules

### Stage split

- `fields` and `relations` are separate in stage 1.
- stage 1 should also have a shared semantic layer for model-level attributes such as primary keys and uniques
- `.sql(...)` should own only SQL/storage detail that the semantic layer cannot express cleanly
- Stage 1 is intrinsic model intent:
  - scalar type
  - nullability
  - literal or SQL defaults
  - generated values
  - explicit column override
  - relation intent
- shared semantic attributes cover:
  - primary keys
  - unique constraints
  - relation ownership and validation
- Stage 2 is structural SQL detail:
  - table override
  - indexes
  - constraint names
  - index `using` and `config`
  - storage-specific mapping and storage-only detail that cannot live locally

### Typed refs

- `cols` exposes only column-backed scalar fields.
- relation fields must not appear in `pk`, `unique`, `index`, or `fk` authoring.
- cross-model refs should be strongly typed and validated, ideally through model tokens or an equivalent low-cost mechanism.
- constraint helpers should prefer refs over string arrays wherever local knowledge already exists.

### Shared TS / PSL foundation

- TS and PSL must be derived from the same shared semantic helpers and data structures.
- pack-provided constructors and presets from ADR 170 are the source of truth for the vocabulary.
- TS wrappers and PSL lowering should both consume that same semantic registry instead of re-encoding special cases separately.

### Vocabulary discipline

- one spelling per concept
- no builder-heavy sublanguage inside models
- prefer semantic names such as `attributes`, `map`, or preset-driven helpers over database-first names when either would work
- target-specific helpers must be visibly namespaced
- no multiple equivalent relation spellings
- avoid raw object bags when a small helper like `constraints.id(...)` or `constraints.foreignKey(...)` is clearer
- require single-field identity and uniqueness to feel natural inline on the field itself
- require compound identity and compound uniqueness to live in `.attributes(...)`, not in `.sql(...)`

### Authoring-time behavior

- authoring should not try to decide whether a default value can be represented by the underlying database storage shape
- compatibility between defaults and storage representation can remain a later concern; the authoring layer should simply capture the declared intent
- graph-wide validation should happen mostly at `build` / emit time

### Current prototype caveat

The current first implementation slice proves lowering, no-emit typing, inline `field.id()` / `field.unique()`, compound `.attributes(...)`, local `cols.*` refs, and typed model tokens via `model('User', ...)` plus `User.refs.id` / `User.ref('id')`. The `constraints.ref('Model', 'field')` helper can remain as a fallback, but it is no longer the primary cross-model path.

### Portability

Portable SQL-family authoring should stay mostly unchanged when switching targets such as Postgres to SQLite. The target swap acceptance bar is:

- no more than roughly 10% rewrite for an average portable `contract.ts`
- intentionally target-specific features are excluded from that budget
- target-specific code must be easy to locate because it is namespaced or isolated in `.sql(...)`

### Type-level design and TS server performance

- field helper return types should stay shallow and mostly opaque
- infer field names from object keys at the `model({ fields: ... })` boundary
- keep cross-model typing incremental and local where possible; prefer model tokens over whole-contract self-referential generics when they provide similar ergonomics
- do not carry field-name generics through every helper call
- build `cols` from a simple mapped type over scalar field keys
- keep graph-wide validation mostly at `build` / emit time
- keep derived utilities such as `InferModels` and `InferQueryPayload` opt-in on the finalized contract, not eagerly materialized during authoring

### Explainability

The design should eventually include an explain/debug surface that shows how `fields`, `relations`, and `.sql(...)` lower into the explicit contract model. This should be tracked in the spec, but it is not part of the first implementation slice.

## Inspirations

Borrow selectively from:

- Zero: clear model/relationship shape and explicit mapping helpers
- Drizzle: local field modifiers and practical aliasing
- Orchid: shared column vocabulary and reduced boilerplate

Do not copy:

- Orchid’s class-based tables
- Orange-style runtime callback defaults inside `contract.ts`
- dialect-specific top-level factories as the main public seam
- any API that makes lowering less deterministic

## Illustrative API

### 90% path

```ts
import { defineContract, field, model, rel, type } from '@prisma-next/sql-contract-ts/contract-builder';
import sqlitePack from '@prisma-next/target-sqlite/pack';

export const contract = defineContract({
  target: sqlitePack,
  naming: { tables: 'snake_case', columns: 'snake_case' },
  types: {
    UserType: type.enum('user_type', ['admin', 'user']),
  },
  models: {
    User: model({
      fields: {
        id: field.generated(uuidv4()).id(),
        email: field.column(textColumn).unique({ name: 'user_email_key' }),
        createdAt: field.column(timestampColumn).defaultSql('now()'),
        kind: field.namedType('UserType'),
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
        body: field.column(textColumn).optional(),
      },
      relations: {
        user: rel.belongsTo('User', { from: 'userId', to: 'id' }),
      },
    }).sql(({ cols, constraints }) => ({
      indexes: [constraints.index(cols.userId, { name: 'post_user_id_idx' })],
      foreignKeys: [
        constraints.foreignKey(cols.userId, constraints.ref('User', 'id'), {
          name: 'post_user_id_fkey',
          onDelete: 'cascade',
        }),
      ],
    })),
  },
});
```

### Full feature sketch

This sketch proves coverage of the current SQL authoring surface. Some older examples below still use pre-rework placeholder names such as `c.pk(...)`; read those as historical sketches rather than the implemented prototype surface.

```ts
import { defineContract, field, model, rel, type } from '@prisma-next/sql-contract-ts/contract-builder';
import pgvector from '@prisma-next/extension-pgvector/pack';
import postgresPack from '@prisma-next/target-postgres/pack';

type AccountSettings = {
  theme: 'light' | 'dark';
  marketing: boolean;
};

const accountSettingsSchema = {
  /* Standard Schema payload */
} as const;

export const contract = defineContract({
  target: postgresPack,
  extensionPacks: { pgvector },
  naming: { tables: 'snake_case', columns: 'snake_case' },
  storageHash: 'sha256:option-a-full-sketch',
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
    Email: type.text(),
    Role: type.enum('account_role', ['ADMIN', 'MEMBER']),
    Embedding1536: type.pgvector.vector(1536),
  },
  models: {
    Account: model({
      fields: {
        id: field.id.uuid({ version: 7 }),
        email: field.namedType('Email').column('email_address'),
        role: field.namedType('Role').default('MEMBER'),
        displayName: field.text().column('display_name').optional(),
        settings: field.json<AccountSettings>().schema(accountSettingsSchema).optional(),
        invitedById: field.uuid().column('invited_by_id').optional(),
      },
      relations: {
        invitedBy: rel.belongsTo('Account', { from: 'invitedById', to: 'id' }),
        invitees: rel.hasMany('Account', { by: 'invitedById' }),
        profile: rel.hasOne('Profile', { by: 'accountId' }),
        posts: rel.hasMany('Post', { by: 'authorId' }),
      },
    }).sql(({ cols, refs, c }) => ({
      table: 'app_user',
      pk: c.pk(cols.id, { name: 'app_user_pkey' }),
      unique: [c.unique(cols.email, { name: 'app_user_email_key' })],
      index: [c.index(cols.displayName, { name: 'app_user_display_name_idx' })],
      fk: [
        c.fk(cols.invitedById, refs.Account.id, {
          name: 'app_user_invited_by_id_fkey',
          onDelete: 'set null',
          onUpdate: 'cascade',
        }),
      ],
    })),

    Profile: model({
      fields: {
        id: field.id.nanoid({ size: 16 }),
        accountId: field.uuid().column('account_id'),
        bio: field.text().optional(),
        avatarUrl: field.text().column('avatar_url').optional(),
      },
      relations: {
        account: rel.belongsTo('Account', { from: 'accountId', to: 'id' }),
      },
    }).sql(({ cols, refs, c }) => ({
      table: 'user_profile',
      pk: c.pk(cols.id, { name: 'user_profile_pkey' }),
      unique: [c.unique(cols.accountId, { name: 'user_profile_account_id_key' })],
      fk: [
        c.fk(cols.accountId, refs.Account.id, {
          name: 'user_profile_account_id_fkey',
          onDelete: 'cascade',
          onUpdate: 'cascade',
        }),
      ],
    })),

    Post: model({
      fields: {
        id: field.id.cuid2(),
        publicId: field.generated.ulid().column('public_id'),
        authorId: field.uuid().column('author_id'),
        title: field.text(),
        slug: field.text().default('draft'),
        rank: field.int().default(0),
        publishedAt: field.timestamp().column('published_at').optional(),
        createdAt: field.timestamp().column('created_at').defaultSql('now()'),
        body: field.text().optional(),
        embedding: field.namedType('Embedding1536').optional(),
        metadata: field.json<{ wordCount: number }>().optional(),
        searchDocument: field.text().column('search_document').optional(),
      },
      relations: {
        author: rel.belongsTo('Account', { from: 'authorId', to: 'id' }),
        tags: rel.manyToMany('Tag', {
          through: 'PostTag',
          from: 'postId',
          to: 'tagId',
        }),
      },
    }).sql(({ cols, refs, c }) => ({
      table: 'blog_post',
      pk: c.pk(cols.id, { name: 'blog_post_pkey' }),
      unique: [
        c.unique(cols.publicId, { name: 'blog_post_public_id_key' }),
        c.unique([cols.authorId, cols.slug], { name: 'blog_post_author_slug_key' }),
      ],
      index: [
        c.index(cols.authorId, { name: 'blog_post_author_id_idx' }),
        c.index(cols.searchDocument, {
          name: 'blog_post_search_document_idx',
          using: 'gin',
          config: { parser: 'english' },
        }),
      ],
      fk: [
        c.fk(cols.authorId, refs.Account.id, {
          name: 'blog_post_author_id_fkey',
          onDelete: 'cascade',
          onUpdate: 'cascade',
          index: true,
        }),
      ],
    })),

    AuditEntry: model({
      fields: {
        id: field.id.int().autoincrement(),
        postId: field.text().column('post_id'),
        kind: field.text(),
        payload: field.json<Record<string, unknown>>(),
        createdAt: field.timestamp().column('created_at').defaultSql('now()'),
      },
      relations: {
        post: rel.belongsTo('Post', { from: 'postId', to: 'id' }),
      },
    }).sql(({ cols, refs, c }) => ({
      table: 'audit_entry',
      pk: c.pk(cols.id, { name: 'audit_entry_pkey' }),
      index: [
        c.index([cols.postId, cols.createdAt], {
          name: 'audit_entry_post_created_at_idx',
        }),
      ],
      fk: [
        c.fk(cols.postId, refs.Post.id, {
          name: 'audit_entry_post_id_fkey',
          onDelete: 'cascade',
          constraint: true,
          index: false,
        }),
      ],
    })),

    Tag: model({
      fields: {
        id: field.id.text(),
        label: field.text(),
      },
      relations: {
        posts: rel.manyToMany('Post', {
          through: 'PostTag',
          from: 'tagId',
          to: 'postId',
        }),
      },
    }).sql(({ cols, c }) => ({
      table: 'content_tag',
      pk: c.pk(cols.id, { name: 'content_tag_pkey' }),
      unique: [c.unique(cols.label, { name: 'content_tag_label_key' })],
    })),

    PostTag: model({
      fields: {
        postId: field.text().column('post_id'),
        tagId: field.text().column('tag_id'),
        createdAt: field.timestamp().column('created_at').defaultSql('now()'),
      },
      relations: {
        post: rel.belongsTo('Post', { from: 'postId', to: 'id' }),
        tag: rel.belongsTo('Tag', { from: 'tagId', to: 'id' }),
      },
    }).sql(({ cols, refs, c }) => ({
      table: 'post_tag',
      pk: c.pk([cols.postId, cols.tagId], { name: 'post_tag_pkey' }),
      fk: [
        c.fk(cols.postId, refs.Post.id, {
          name: 'post_tag_post_id_fkey',
          onDelete: 'cascade',
        }),
        c.fk(cols.tagId, refs.Tag.id, {
          name: 'post_tag_tag_id_fkey',
          onDelete: 'cascade',
        }),
      ],
    })),
  },
});
```

### Inference target

The authored contract should be the source of truth for future model/client helper types:

```ts
type Models = InferModels<typeof contract>;

type AccountSelect = Models['Account']['select'];
type AccountCreate = Models['Account']['create'];
type PostUpdate = Models['Post']['update'];

type PostWithAuthorAndTags = InferQueryPayload<
  typeof contract,
  'Post',
  {
    select: {
      id: true;
      title: true;
      slug: true;
      createdAt: true;
    };
    include: {
      author: {
        select: {
          id: true;
          email: true;
          role: true;
        };
      };
      tags: {
        select: {
          id: true;
          label: true;
        };
      };
    };
  }
>;
```

Derived-type expectations:

- `select` comes from model field names plus codec/type-map outputs
- `create` uses defaults, generators, and nullability to determine optional inputs
- `include` and nested payload inference come from declared relations

### Portability sketch

Portable contract:

```ts
export const contract = defineContract({
  target: postgresPack,
  models: {
    User: model({
      fields: {
        id: field.id.uuid(),
        email: field.text(),
        createdAt: field.createdAt(),
      },
    }).sql(({ cols, c }) => ({
      pk: c.pk(cols.id),
      unique: [c.unique(cols.email, { name: 'user_email_key' })],
    })),
  },
});
```

Target swap to SQLite:

```ts
export const contract = defineContract({
  target: sqlitePack,
  models: {
    User: model({
      fields: {
        id: field.id.uuid(),
        email: field.text(),
        createdAt: field.createdAt(),
      },
    }).sql(({ cols, c }) => ({
      pk: c.pk(cols.id),
      unique: [c.unique(cols.email, { name: 'user_email_key' })],
    })),
  },
});
```

Intended result:

- only the target import and root config change
- portable field helpers stay unchanged
- target-specific helpers are obvious and localized

### Fallback reference: Option B

Option B remains a fallback implementation path only if Option A turns out materially worse in inference quality or implementation complexity. If retained at all, it should be a fluent contract shell over the same inner model DSL, not a distinct model authoring language.

## Requirements

## Functional Requirements

- Provide a SQL TS authoring surface where an author defines a model’s scalar fields, relations, and SQL/storage modifiers in one local unit.
- Support refined Option A as the primary public API:
  - `defineContract({ ... })`
  - `model({ fields, relations }).sql(...)`
  - `field`, `rel`, `type`, and `c` helper vocabularies
- Preserve current emitted `contract.json` and `contract.d.ts` shape for equivalent intent.
- Support explicit table and column overrides while allowing naming-strategy defaults.
- Support named storage types and type references.
- Support current SQL constraint coverage:
  - single and composite primary keys
  - uniques
  - indexes
  - foreign keys
  - named constraints
  - index `using` / `config`
  - referential actions
  - FK constraint/index toggles
- Support current default coverage:
  - literal defaults
  - SQL-expression defaults
  - generated mutation-time defaults
- Support current relation coverage:
  - `belongsTo`
  - `hasOne`
  - `hasMany`
  - `manyToMany`
- Keep reverse/query-surface relations explicit, but require full FK/storage authorship only on the owning side.
- Enable typed local field refs in `.sql(...)` so PK/unique/index/FK authoring can autocomplete valid scalar fields.
- Expose opaque cross-model refs for FK authoring.
- Keep target-specific authoring visibly namespaced or isolated in `.sql(...)`.

## Non-Functional Requirements

- **Determinism:** equivalent author intent must lower to byte-stable canonical contract output.
- **Type safety:** the new API must preserve or improve current compile-time inference for downstream `schema()` / `sql()` usage.
- **Autocomplete quality:** `cols` should autocomplete valid scalar fields only.
- **Type performance:** authoring-time types should stay shallow enough to avoid significant TS server regressions.
- **Portability:** Postgres to SQLite swaps should require no more than roughly 10% rewrite for average portable contracts.
- **Migration posture:** the first implementation slice may coexist with the current chain builder, but the long-term public direction is replacement, not indefinite dual maintenance.

## Non-goals

- Changing `contract.json` schema or normalized semantics.
- Redesigning query APIs (`schema()`, `sql()`, `orm()`) beyond inference hooks needed by the authoring redesign.
- Implementing the explain/debug surface in the first slice.
- Solving non-SQL target-family authoring in this project.
- Perfect graph-wide compile-time validation at every keystroke.

# Acceptance Criteria

- [ ] An author can define a model with `fields` and `relations`, attach `.sql(...)`, and emit a valid SQL contract without separately authoring `.table(...)` and `.model(...)`.
- [ ] Common scalar fields no longer require duplicate field-to-column declarations when names match.
- [ ] Table and column naming can come from root-level naming strategy with explicit per-table/per-field overrides.
- [ ] `cols` in `.sql(...)` exposes only column-backed scalar fields and excludes relation fields.
- [ ] The API supports named PKs, uniques, indexes, and FKs, including composite constraints where currently supported.
- [ ] The API supports literal defaults, SQL defaults, generated defaults, and named storage types without changing emitted contract structure.
- [ ] The API supports explicit reverse/query-surface relations while keeping owning-side FK/storage authorship singular.
- [ ] A representative Postgres contract can switch to SQLite with no more than roughly 10% source changes, excluding intentionally target-specific features.
- [ ] Downstream `schema()` / `sql()` inference continues to work from no-emit TS-authored contracts built from the new surface.
- [ ] The lowering pipeline can eventually derive model/client helper types from the same authored contract data used by query-lane inference.

# Other Considerations

## Security

No new runtime execution semantics are introduced. The redesign remains pure authoring-time lowering to contract data. Runtime safety continues to rely on emitted contract validation, contract hashes, and existing execution-time checks.

## Cost

This is an authoring-surface redesign inside existing package boundaries. The main costs are engineering time, migration churn, and TS performance tuning rather than infra spend.

## Observability

The first slice should add tests that compare lowered refined Option A output against current builder behavior. A later explain/debug surface should make lowering inspectable during development.

## Data Protection

No new data classes are introduced. Data protection posture remains whatever the authored contract already implies.

## Analytics

No product analytics are required for the authoring API itself.

# References

- `/Users/jkomyno/work/prisma/prisma-next-clean/docs/architecture docs/adrs/ADR 170 - Pack-provided type constructors and field presets.md`
- `/Users/jkomyno/work/prisma/prisma-next-clean/docs/architecture docs/adrs/ADR 096 - TS-authored contract parity & purity rules.md`
- `/Users/jkomyno/work/prisma/prisma-next-clean/docs/architecture docs/adrs/ADR 099 - Contract authoring lint rules.md`
- `/Users/jkomyno/work/prisma/prisma-next-clean/projects/ts-contract-authoring-redesign/authoring-api-options-recommendation.md`

# Open Questions

1. How much of the current high-level field vocabulary (`field.id.uuid()`, `field.createdAt()`, `field.json().schema(...)`) should ship in the first implementation slice versus follow-on slices that still use the refined structure?
2. Should cross-model `refs` be fully autocompleteable in the first implementation slice, or is it acceptable to ship opaque refs with weaker author-time guidance first and strengthen them later?
3. Should the eventual explain/debug surface be a CLI command, a library helper, or both?

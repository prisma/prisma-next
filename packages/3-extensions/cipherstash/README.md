# @prisma-next/extension-cipherstash

[CipherStash](https://cipherstash.com) extension for Prisma Next: searchable application-layer encryption for Postgres via the [EQL bundle](https://cipherstash.com/docs/stack/platform/eql).

## What this package provides

- **Six encrypted column types** with native JS plaintexts: `EncryptedString`, `EncryptedDouble`, `EncryptedBigInt`, `EncryptedDate`, `EncryptedBoolean`, `EncryptedJson`. Each ships a PSL constructor (`cipherstash.Encrypted<Type>({...})`) and a TS contract factory (`encrypted<Type>({...})`) that lower to byte-identical contracts.
- **Per-codec search-mode flags** (`equality`, `freeTextSearch`, `orderAndRange`, `searchableJson`) that drive what EQL search-config indices the codec lifecycle hook emits at migration time. Every flag defaults to `true` so searchable encryption is the default for a codec whose entire reason for existing is to make encrypted columns queryable.
- **17 query operators** — 13 predicate operators surfaced as column methods (`m.email.cipherstashEq(...)`, `m.salary.cipherstashGt(...)`, `m.profile.cipherstashJsonbPathExists(...)`, etc.) and 4 non-predicate free-standing helpers (`cipherstashAsc(col)`, `cipherstashDesc(col)`, `cipherstashJsonbPathQueryFirst(col, path)`, `cipherstashJsonbGet(col, path)`). The split between the two surfaces is documented below.
- **`bulkEncryptMiddleware(sdk)`** — coalesces cipherstash parameters across rows into one `bulkEncrypt` SDK round-trip per `(table, column)` group before the wire-format encode.
- **`decryptAll(rows, opts?)`** — opt-in read-side amortisation that walks a result set, coalesces every cipherstash envelope it finds into one `bulkDecrypt` SDK round-trip per `(table, column)` group, and caches the resolved plaintexts back onto each envelope.
- **`SqlControlExtensionDescriptor`** carrying the EQL contract space (the `eql_v2_configuration` table, the `eql_v2_encrypted` / `ore_*` composite types, the `eql_v2` domains) plus a baseline migration that installs the vendored EQL bundle SQL.

## Subpath exports

| Subpath          | Purpose                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| `./control`      | `SqlControlExtensionDescriptor` (contract space + pack meta + codec lifecycle hooks)                   |
| `./runtime`      | Six envelope classes + `CipherstashSdk` + codec runtime + `decryptAll` + four free-standing helpers    |
| `./middleware`   | `bulkEncryptMiddleware(sdk)`                                                                           |
| `./pack`         | `cipherstashPackMeta` for TS contract authoring                                                        |
| `./column-types` | Six TS factories: `encryptedString` / `encryptedDouble` / `encryptedBigInt` / `encryptedDate` / `encryptedBoolean` / `encryptedJson` |

The `./control`, `./runtime`, and `./middleware` planes are tree-shakable: a runtime consumer never pulls the EQL bundle SQL or the codec lifecycle hooks, and a control-plane consumer never pulls the envelope classes, the SDK interface, the codec runtime, or the bulk-encrypt middleware. See [`DEVELOPING.md`](./DEVELOPING.md) for the source-layout discipline that keeps this true.

## Configuration

Add the extension to your `prisma-next.config.ts`:

```ts
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import sql from '@prisma-next/family-sql/control';
import postgres from '@prisma-next/target-postgres/control';
import cipherstash from '@prisma-next/extension-cipherstash/control';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensionPacks: [cipherstash],
});
```

## The six encrypted column types

Each type maps a JS plaintext to an EQL `cast_as` value and ships with a per-codec set of search-mode flags. Every flag defaults to `true` and is validated by an arktype schema at the contract boundary.

| TS factory / PSL constructor | JS plaintext | EQL `cast_as` | Search-mode flags |
|---|---|---|---|
| `encryptedString` / `cipherstash.EncryptedString` | `string` | `text` | `equality`, `freeTextSearch`, `orderAndRange` |
| `encryptedDouble` / `cipherstash.EncryptedDouble` | `number` (IEEE-754) | `double` | `equality`, `orderAndRange` |
| `encryptedBigInt` / `cipherstash.EncryptedBigInt` | `bigint` | `big_int` | `equality`, `orderAndRange` |
| `encryptedDate` / `cipherstash.EncryptedDate` | `Date` (calendar date) | `date` | `equality`, `orderAndRange` |
| `encryptedBoolean` / `cipherstash.EncryptedBoolean` | `boolean` | `boolean` | `equality` |
| `encryptedJson` / `cipherstash.EncryptedJson` | JSON-serialisable `unknown` | `jsonb` | `searchableJson` |

All six codecs share the same Postgres native type (`eql_v2_encrypted`) and emit `eql_v2.add_search_config(...)` / `eql_v2.remove_search_config(...)` migration operations driven by the per-codec lifecycle hooks. Each enabled flag maps to one EQL search-config index — see [EQL index types](#eql-search-config-index-types).

### PSL authoring

```prisma
model User {
  id              Int @id @default(autoincrement())

  email           cipherstash.EncryptedString({ orderAndRange: true })  // string + match + ore + unique indices
  searchableEmail cipherstash.EncryptedString({ freeTextSearch: true }) // string + match + unique indices only
  salary          cipherstash.EncryptedDouble()                         // double + ore + unique
  accountId       cipherstash.EncryptedBigInt() @map("accountid")       // big_int + ore + unique
  birthday        cipherstash.EncryptedDate()                           // date + ore + unique
  emailVerified   cipherstash.EncryptedBoolean() @map("emailverified")  // boolean + unique
  profile         cipherstash.EncryptedJson()                           // jsonb + ste_vec
}
```

### TypeScript authoring

```ts
import {
  encryptedBigInt,
  encryptedBoolean,
  encryptedDate,
  encryptedDouble,
  encryptedJson,
  encryptedString,
} from '@prisma-next/extension-cipherstash/column-types';
import cipherstash from '@prisma-next/extension-cipherstash/pack';
import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract, field, model } from '@prisma-next/sql-contract-ts/contract-builder';
import postgres from '@prisma-next/target-postgres/pack';

export const contract = defineContract({
  family: sqlFamily,
  target: postgres,
  extensionPacks: { cipherstash },
  models: {
    User: model('User', {
      fields: {
        id: field.column({ codecId: 'pg/int4@1', nativeType: 'int4' })
          .defaultSql('autoincrement()').id(),
        email: field.column(encryptedString({ orderAndRange: true })),
        salary: field.column(encryptedDouble()),
        accountId: field.column(encryptedBigInt()).columnName('accountid'),
        birthday: field.column(encryptedDate()),
        emailVerified: field.column(encryptedBoolean()).columnName('emailverified'),
        profile: field.column(encryptedJson()),
      },
    }).sql({ table: 'users' }),
  },
});
```

PSL- and TS-authored contracts emit byte-identical `contract.json` for every codec — pinned by the parity fixtures at `test/integration/test/authoring/parity/cipherstash-encrypted-{string,double,bigint,date,boolean,json}/`.

Per-codec search-mode flags default to `true` — searchable encryption is the legitimate default for an extension whose entire reason for existing is to make encrypted columns queryable. Opt out explicitly when you want storage-only encryption (`cipherstash.EncryptedString({ equality: false, freeTextSearch: false, orderAndRange: false })`) or to disable a single mode.

## The operator surface

The query operators decompose along two axes: the **type axis** (which codecs each operator applies to) and the **shape axis** (column method vs free-standing helper). [ADR 214 — Extension operator surface](../../../docs/architecture%20docs/adrs/ADR%20214%20-%20Extension%20operator%20surface%20namespaced%20replacement%20operators.md) captures the architectural reasoning. This section is the API reference.

### Predicate operators — column-method surface

Predicate operators return boolean and live in `WHERE` clauses. They surface on the column accessor through the framework's `OperationRegistry` and are gated on the column codec's search-mode flag.

| Operator | Required flag | Lowering | Applies to |
|---|---|---|---|
| `cipherstashEq(plaintext)` | `equality` | `eql_v2.eq(self, $N)` | every cipherstash codec |
| `cipherstashNe(plaintext)` | `equality` | `NOT eql_v2.eq(self, $N)` | every cipherstash codec |
| `cipherstashInArray([p1, p2, ...])` | `equality` | `(eql_v2.eq(self, $1) OR eql_v2.eq(self, $2) OR ...)` | every cipherstash codec |
| `cipherstashNotInArray([p1, p2, ...])` | `equality` | `NOT (eql_v2.eq(self, $1) OR ...)` | every cipherstash codec |
| `cipherstashIlike(pattern)` | `freeTextSearch` | `eql_v2.ilike(self, $N)` | `EncryptedString` |
| `cipherstashNotIlike(pattern)` | `freeTextSearch` | `NOT eql_v2.ilike(self, $N)` | `EncryptedString` |
| `cipherstashGt(plaintext)` | `orderAndRange` | `eql_v2.gt(self, $N)` | `EncryptedString`, `EncryptedDouble`, `EncryptedBigInt`, `EncryptedDate` |
| `cipherstashGte(plaintext)` | `orderAndRange` | `eql_v2.gte(self, $N)` | as above |
| `cipherstashLt(plaintext)` | `orderAndRange` | `eql_v2.lt(self, $N)` | as above |
| `cipherstashLte(plaintext)` | `orderAndRange` | `eql_v2.lte(self, $N)` | as above |
| `cipherstashBetween(lo, hi)` | `orderAndRange` | `eql_v2.gte(self, $1) AND eql_v2.lte(self, $2)` | as above |
| `cipherstashNotBetween(lo, hi)` | `orderAndRange` | `NOT (eql_v2.gte(self, $1) AND eql_v2.lte(self, $2))` | as above |
| `cipherstashJsonbPathExists(path)` | `searchableJson` | `eql_v2.jsonb_path_exists(self, $N)` | `EncryptedJson` (see [Known limitations](#known-limitations)) |

Why the `cipherstash`-namespaced names rather than reusing the framework built-ins (`eq`, `gt`, etc.): EQL ciphertexts contain randomized nonces, so SQL `=` / `<` / `>` against an `eql_v2_encrypted` column always returns `false` for two encrypts of the same plaintext. The cipherstash codecs declare zero of the framework's built-in traits so the built-in operators are not synthesised on cipherstash columns (`m.email.eq(...)` is a compile-time error and a runtime `no-such-method`), and the namespaced replacements lower to the corresponding `eql_v2.*` EQL functions which short-circuit through the per-column EQL search-config index. See ADR 214 for the full pattern.

### Free-standing helpers — non-predicate surface

The four non-predicate operators ship as **free-standing helper functions** rather than column methods. They take a column expression as input and return a non-boolean AST node — `OrderByItem` for sort, codec-typed `Expression` for SELECT-expression accessors. Both shapes are not assignable to the column-method dispatch contract the predicates use; see ADR 214 § Part B for the rationale.

```ts
import {
  cipherstashAsc,
  cipherstashDesc,
  cipherstashJsonbPathQueryFirst,
  cipherstashJsonbGet,
} from '@prisma-next/extension-cipherstash/runtime';
```

| Helper | Required flag | Returns | Applies to |
|---|---|---|---|
| `cipherstashAsc(col)` | `orderAndRange` | `OrderByItem` (lowers to `ORDER BY <col> ASC`) | `EncryptedString`, `EncryptedDouble`, `EncryptedBigInt`, `EncryptedDate` |
| `cipherstashDesc(col)` | `orderAndRange` | `OrderByItem` (lowers to `ORDER BY <col> DESC`) | as above |
| `cipherstashJsonbPathQueryFirst(col, path)` | `searchableJson` | `Expression<cipherstash/json@1>` (lowers to `eql_v2.jsonb_path_query_first(col, $N)`) | `EncryptedJson` |
| `cipherstashJsonbGet(col, path)` | `searchableJson` | `Expression<cipherstash/json@1>` (lowers to `eql_v2."->"(col, $N)`) | `EncryptedJson` |

Sort lowering uses the **bare column form** (`ORDER BY <col> ASC|DESC`) rather than wrapping in `eql_v2.order_by_<index>(col)`. EQL ships native `<` / `>` / `<=` / `>=` operator overloads on `eql_v2_encrypted` that drive the sort comparison at the Postgres level; the bare form is verified against the live EQL bundle in the package's e2e tests.

The JSON helpers return `Expression<cipherstash/json@1>` — i.e. the same type as their input column — so they chain into follow-on JSON helpers or predicates (`cipherstashJsonbPathQueryFirst(col, '$.user')` then `cipherstashJsonbGet(..., '$.email')`).

## Worked example

```ts
import { and } from '@prisma-next/sql-orm-client';
import { bulkEncryptMiddleware } from '@prisma-next/extension-cipherstash/middleware';
import {
  cipherstashAsc,
  decryptAll,
  EncryptedBigInt,
  EncryptedDate,
  EncryptedDouble,
  EncryptedString,
} from '@prisma-next/extension-cipherstash/runtime';
import postgres from '@prisma-next/postgres/runtime';
import type { Contract } from './prisma/contract.d';
import contractJson from './prisma/contract.json' with { type: 'json' };

const sdk = /* your CipherstashSdk implementation */;

const db = postgres<Contract>({
  contractJson,
  extensions: [createCipherstashRuntimeDescriptor({ sdk })],
  middleware: [bulkEncryptMiddleware(sdk)],
});

// Write — the bulk-encrypt middleware coalesces all four columns into
// four bulkEncrypt SDK round-trips, one per (users, column) group.
await db.orm.User.create({
  id: 1,
  email: EncryptedString.from('alice@example.com'),
  salary: EncryptedDouble.from(75_000.50),
  accountId: EncryptedBigInt.from(1_000_000_000_001n),
  birthday: EncryptedDate.from(new Date('1985-03-15')),
});

// Mixed-codec read — predicate operators on column accessors;
// cipherstashAsc as a free-standing helper.
const rows = await db.orm.User
  .where((u) => and(
    u.email.cipherstashIlike('%@example.com'),
    u.salary.cipherstashGt(50_000),
    u.birthday.cipherstashLt(new Date('1990-01-01')),
  ))
  .orderBy((u) => [cipherstashAsc(u.salary)])
  .all();

// Read-side amortisation — one bulkDecrypt per (table, column) group.
await decryptAll(rows);
console.log(await rows[0]?.email.decrypt());
```

A complete end-to-end example with a live ZeroKMS workspace lives at [`examples/cipherstash-integration/`](../../../examples/cipherstash-integration/).

## EQL search-config index types

Each codec's enabled search-mode flags map to one EQL index family. The codec lifecycle hook emits `eql_v2.add_search_config(table, column, '<index>')` migration operations at field-added events; a flag flip from `true` to `false` between contract versions emits the corresponding `eql_v2.remove_search_config(...)` op via [ADR 213 — Codec lifecycle hooks](../../../docs/architecture%20docs/adrs/ADR%20213%20-%20Codec%20lifecycle%20hooks.md).

| EQL index | Triggered by flag | What it does |
|---|---|---|
| `unique` | `equality` | Deterministic lookup over hashed equality keys; enables `eql_v2.eq` / `eql_v2.in_array`. One key per `(value, encryption-key)`; ciphertexts themselves stay randomised. |
| `match` | `freeTextSearch` | Bloom-filter index over substring n-grams; enables `eql_v2.ilike`. Probabilistic — false positives possible, false negatives not. |
| `ore` | `orderAndRange` | Order-revealing encryption index over a sortable encoding of the plaintext; enables `eql_v2.gt` / `gte` / `lt` / `lte` / `between` and bare-column `ORDER BY <col> ASC|DESC`. |
| `ste_vec` | `searchableJson` | Searchable tree encoding vector over JSON path/value pairs; enables `eql_v2.jsonb_path_query_first` and `eql_v2."->"`. See [Known limitations](#known-limitations) for the predicate-side gap. |

Each codec opts into only the indices it has a semantic story for. Boolean columns have no meaningful range, so `EncryptedBoolean` does not accept `orderAndRange`. JSON columns have no meaningful text-comparison story, so `EncryptedJson` accepts only `searchableJson`. The PSL interpreter rejects out-of-vocabulary flags with a `PSL_INVALID_ATTRIBUTE_ARGUMENT` diagnostic.

## When to use which codec

Pick the codec by the **operator semantics** you need, not by JS type alone:

| You want to … | Pick |
|---|---|
| Searchable email / arbitrary string with substring search | `encryptedString({ equality: true, freeTextSearch: true })` |
| Numeric range queries on a salary / price / score | `encryptedDouble({ equality: true, orderAndRange: true })` |
| Account / ID number with exact-match + range | `encryptedBigInt({ equality: true, orderAndRange: true })` — capped at `Number.MAX_SAFE_INTEGER` (see Known limitations) |
| Calendar-date range queries | `encryptedDate({ equality: true, orderAndRange: true })` |
| Boolean flag with `WHERE col = true` predicates | `encryptedBoolean({ equality: true })` |
| Searchable JSON document (SELECT-expression accessors) | `encryptedJson({ searchableJson: true })` |
| Storage-only encryption (no queryable indices) | Any factory with every flag opt-out: `encryptedString({ equality: false, freeTextSearch: false, orderAndRange: false })` |

When in doubt: every flag defaults to `true`. Enabling unused flags costs migration time (one extra search-config DDL op per flag per column) and EQL index storage; it does not affect the codec's encrypt/decrypt path.

## Database setup

The extension contributes its database scaffolding (the `eql_v2_configuration` table, the `eql_v2_encrypted` / `ore_*` composite types, the `eql_v2.bloom_filter` / `hmac_256` / `blake3` domains, and the EQL bundle SQL) as a **contract space** so the Prisma Next framework can plan, apply, and verify it the same way it manages an application's own schema. See [ADR 212 — Contract spaces](../../../docs/architecture%20docs/adrs/ADR%20212%20-%20Contract%20spaces.md).

After `prisma-next migrate plan`, the user's repo gains:

- `migrations/cipherstash/contract.json`,
- `migrations/cipherstash/contract.d.ts`,
- `migrations/cipherstash/refs/head.json`,
- `migrations/cipherstash/<name>/` migration directories.

`db apply` then runs CipherStash's migrations against the live database in the same transaction as any application-space migration emitted in the same `migrate` invocation.

## Authoring (maintainers)

The extension's contract + baseline migration are emitted on-disk inside this package using the same pipeline application authors use:

- `pnpm build:contract-space` — runs `prisma-next contract emit` to produce `src/contract.{json,d.ts}` from the PSL source at `src/contract.prisma`.
- `pnpm exec prisma-next migration plan --name <slug>` (run from this package directory) — scaffolds a new migration directory under `migrations/<dirName>/`. **Not chained into `pnpm build`**: `migration plan` is non-idempotent (each invocation generates a new timestamped directory), so it runs manually when the contract source changes — same convention application authors follow. The baseline migration's `migration.ts` is then hand-edited so that its `operations` getter installs the EQL bundle byte-for-byte plus the structural `cipherstash:*` no-op ops that register invariantIds for typed objects the bundle creates (see the comment in `migrations/20260601T0000_install_eql_bundle/migration.ts`).
- `pnpm tsx migrations/<dirName>/migration.ts` (run from this package directory) — re-emits `ops.json` + `migration.json` from the hand-edited subclass. Use `tsx`, not bare `node`, because the Migration subclass imports relative TypeScript siblings (`../../src/core/constants`, `../../src/core/eql-bundle`) which Node's native loader can't resolve without a TS-aware loader.
- `migrations/refs/head.json` is hand-pinned with the latest migration's `to` hash + `providedInvariants`.

The descriptor at `src/exports/control.ts` then JSON-imports those artefacts and synthesises the framework's `MigrationPackage` shape.

See [ADR 212 — Contract spaces](../../../docs/architecture%20docs/adrs/ADR%20212%20-%20Contract%20spaces.md) ("Contract-space package layout") for the canonical layout and rationale.

## Security model

- **Plaintext lifetime.** The write-side handle retains its plaintext slot post-encrypt — JS strings are immutable and zeroing is best-effort, so the GC-driven lifecycle is the sufficient bound. Practical implication: the original `Encrypted<X>.from(plaintext)` envelope's `decrypt()` returns the plaintext synchronously without consulting the SDK. Treat envelope objects as plaintext-equivalent for the lifetime of the variable.
- **Ciphertext routing.** Every read-side envelope carries the `(table, column)` it was decoded from; `decrypt` / `decryptAll` route their bulk SDK calls by that key so the SDK can pick the right key material per column.
- **Operator semantics.** Encrypted equality uses `eql_v2.eq` (deterministic-index lookup over `unique`); free-text uses `eql_v2.ilike` (bloom-filter lookup over `match`); range uses `eql_v2.gt` / `lt` / `eql_v2_encrypted` operator overloads (order-revealing-encryption lookup over `ore`). The framework's built-in `eq` / `gt` / `ilike` are unreachable on cipherstash columns — the codecs declare zero of the framework's built-in traits, so no wrong-SQL footgun can exist where a randomised EQL ciphertext is compared with `=` directly. See [ADR 214](../../../docs/architecture%20docs/adrs/ADR%20214%20-%20Extension%20operator%20surface%20namespaced%20replacement%20operators.md).
- **Plaintext redaction in implicit serialisation paths.** Every envelope's `toJSON`, `toString`, `valueOf`, `Symbol.toPrimitive`, and `Symbol.for('nodejs.util.inspect.custom')` paths return `[REDACTED]` (or, for `toJSON`, a `{ "$encrypted<Type>": "<opaque>" }` placeholder). Accidental `console.log`, `JSON.stringify`, template-literal interpolation, error string construction, and `util.inspect` paths cannot leak plaintext. Explicit access is via `envelope.expose()`.
- **Cancellation.** Every cipherstash-internal SDK call accepts an `AbortSignal`; mid-flight cancellation surfaces a `RUNTIME.ABORTED` envelope with a phase tag (`bulk-encrypt`, `decrypt`, or `decrypt-all`) mirroring the framework's envelope shape from [ADR 207](../../../docs/architecture%20docs/adrs/ADR%20207%20-%20Codec%20call%20context%20per-query%20AbortSignal%20and%20column%20metadata.md).

## Known limitations

Surfaces explicitly deferred from the current implementation. Tracked for future work if customer demand surfaces.

- **`cipherstashJsonbPathExists` predicate against the live EQL bundle.** The EQL bundle's `jsonb_path_exists` function expects a *hashed* JSONpath selector computed client-side by the CipherStash SDK's `selector(...)` API; the framework currently binds the JSONpath as a plain `pg/text@1` `ParamRef`. Predicate queries return zero rows against rows that should match. The non-predicate helpers (`cipherstashJsonbPathQueryFirst`, `cipherstashJsonbGet`) work correctly against the same column — they project encrypted JSON values without probing the STE-VEC index for an existence check. Workaround for filtering: project all rows with the SELECT-expression helpers and apply client-side post-filtering. Tracked at [TML-2504](https://linear.app/prisma-company/issue/TML-2504); closing requires either a client-side path-hashing middleware or an EQL-side plaintext-path overload.
- **`EncryptedBigInt` capped at `Number.MAX_SAFE_INTEGER`.** The `@cipherstash/stack` SDK's `JsPlaintext` union (`string | number | boolean | object | array`) does not include `bigint`, and ZeroKMS's `big_int` cast rejects string plaintexts. The example app's SDK adapter therefore converts `bigint → Number` with an eager `Number.MAX_SAFE_INTEGER` bounds check (throws on overflow rather than truncating silently). Values beyond the safe-integer range cannot be encrypted today. Lifting requires upstream SDK / ZeroKMS work.
- **Encrypted timestamp / datetime.** Lexical comparison over text-serialised timestamps is correctness-fragile (timezone offsets, DST transitions, ISO-vs-RFC formatting). CipherStash's own surface offers only calendar-date encryption (`EncryptedDate`). Deferred until a fixed-width canonical timestamp encoding is agreed with the EQL team.
- **Non-bigint integer variants.** EQL supports `cast_as` ∈ `{int, small_int, big_int, real}`. The extension ships `bigint` (`big_int`) and IEEE-754 (`double`) only. `encryptedInt`, `encryptedSmallInt`, `encryptedReal` can be added later via the same pattern if customer demand surfaces.
- **Re-encryption migration.** Adopting cipherstash for an existing populated column — flipping a column from plain `Number` to `EncryptedDouble` with rows in place — requires re-encrypting existing row data. The codec lifecycle hook emits the right search-config DDL but does not touch row data. The framework primitive for "re-encrypt existing rows" is unspecified; user works around it with hand-authored `dataTransform` migrations until a framework primitive lands.
- **Per-column key-id override.** Routing key is `(table, column)`; no per-column key-id slot on `encrypted<X>({...})` constructors. The wrapped SDK adapter chooses the key material per `(table, column)`.
- **Custom search-config tuning beyond the bundle defaults.** The extension emits `eql_v2.add_search_config(...)` with the EQL bundle's default per-index parameters. Knobs like `match` n-gram-length, `ore` block-size, or `ste_vec` depth are out of scope at the framework's authoring surface; configure them via direct SQL `dataTransform` migrations if you need non-default tuning.

## Contributing

See [`DEVELOPING.md`](./DEVELOPING.md) for the source layout, per-codec wiring template, substrate architecture, and runtime-side gotchas (physical-column-name routing keys, the `bigint → Number` SDK boundary, polymorphic `CipherstashSdk.decrypt` return type, the framework runtime middleware lifecycle reorder).

## References

- [CipherStash](https://cipherstash.com) — managed application-layer encryption for Postgres.
- [CipherStash EQL reference](https://cipherstash.com/docs/stack/platform/eql) — encrypted operator semantics and search-config index types.
- [CipherStash Drizzle integration docs](https://cipherstash.com/docs/stack/encryption/drizzle) — operator-surface precedent.
- [Prisma Next Architecture Overview](../../../docs/Architecture%20Overview.md).
- [Extension Packs Naming and Layout](../../../docs/reference/Extension-Packs-Naming-and-Layout.md).
- [ADR 207 — Codec call context per-query AbortSignal and column metadata](../../../docs/architecture%20docs/adrs/ADR%20207%20-%20Codec%20call%20context%20per-query%20AbortSignal%20and%20column%20metadata.md).
- [ADR 208 — Higher-order codecs for parameterized types](../../../docs/architecture%20docs/adrs/ADR%20208%20-%20Higher-order%20codecs%20for%20parameterized%20types.md).
- [ADR 212 — Contract spaces](../../../docs/architecture%20docs/adrs/ADR%20212%20-%20Contract%20spaces.md).
- [ADR 213 — Codec lifecycle hooks](../../../docs/architecture%20docs/adrs/ADR%20213%20-%20Codec%20lifecycle%20hooks.md).
- [ADR 214 — Extension operator surface: namespaced replacement operators and the predicate/helper split](../../../docs/architecture%20docs/adrs/ADR%20214%20-%20Extension%20operator%20surface%20namespaced%20replacement%20operators.md).
- [ADR 215 — Runtime middleware lifecycle: `beforeExecute` fires before `encodeParams`](../../../docs/architecture%20docs/adrs/ADR%20215%20-%20Runtime%20middleware%20lifecycle%20beforeExecute%20before%20encodeParams.md).
- [Subsystem doc — Ecosystem Extensions & Packs](../../../docs/architecture%20docs/subsystems/6.%20Ecosystem%20Extensions%20%26%20Packs.md).
- Contract-space layout rule: [`.cursor/rules/contract-space-package-layout.mdc`](../../../.cursor/rules/contract-space-package-layout.mdc)
- Reference fixture: [`packages/3-extensions/test-contract-space`](../test-contract-space).

# `@prisma-next/extension-cipherstash`

Searchable-encryption integration for Prisma Next, backed by
[CipherStash](https://cipherstash.com/) and the EQL Postgres extension.

> **Status:** in development. The currently-implemented surface is the
> **storage** path: an `EncryptedString` envelope, its codec, and the
> EQL-bundle install dependency. Search operators (`eq`, `ilike`),
> `decryptAll`, the bulk-encrypt middleware, the PSL constructor, and the
> `encryptedString({...})` TS factory ship in subsequent releases.

## Subpath exports

| Subpath           | Purpose                                                       |
| ----------------- | ------------------------------------------------------------- |
| `.`               | `EncryptedString` envelope (and, in a future release, `decryptAll`) |
| `./column-types`  | `encryptedString({...})` TS contract factory (forthcoming)    |
| `./runtime`       | `SqlRuntimeExtensionDescriptor` with `parameterizedCodecs`    |
| `./control`       | `SqlControlExtensionDescriptor` with `databaseDependencies`   |
| `./middleware`    | `bulkEncryptMiddleware` factory (forthcoming)                 |

## Usage

```ts
import { EncryptedString } from '@prisma-next/extension-cipherstash';

const envelope = EncryptedString.from('alice@example.com');
const plaintext = await envelope.decrypt();
```

The codec registers under the `cipherstash/string@1` codec id and
maps to the EQL `eql_v2_encrypted` Postgres native type. Per-column
search-mode parameters (`equality`, `freeTextSearch`) are validated
at the contract boundary by an arktype schema and threaded through
the parameterized-codec descriptor model — see [ADR 208 — Higher-order
codecs for parameterized types](../../../docs/architecture%20docs/adrs/ADR%20208%20-%20Higher-order%20codecs%20for%20parameterized%20types.md).
The codec`s `decode` site reads the cell's `(table, column)` from
the per-call codec context — see [ADR 207 — Codec call context per-query
AbortSignal and column metadata](../../../docs/architecture%20docs/adrs/ADR%20207%20-%20Codec%20call%20context%20per-query%20AbortSignal%20and%20column%20metadata.md).

## Database setup

The package declares the EQL extension as a database dependency.
When using `prisma-next db init`, the migration planner runs the
EQL install bundle; the precheck short-circuits if EQL is already
installed.

## References

- [pgvector extension](../pgvector/README.md) — structural precedent for codec, parameterized descriptor, and `databaseDependencies.init` shape
- [ADR 207 — Codec call context (per-query AbortSignal and column metadata)](../../../docs/architecture%20docs/adrs/ADR%20207%20-%20Codec%20call%20context%20per-query%20AbortSignal%20and%20column%20metadata.md)
- [ADR 208 — Higher-order codecs for parameterized types](../../../docs/architecture%20docs/adrs/ADR%20208%20-%20Higher-order%20codecs%20for%20parameterized%20types.md)
- [Prisma Next Architecture Overview](../../../docs/Architecture%20Overview.md)
- [DEVELOPING.md](DEVELOPING.md) — contributor-facing notes on the in-progress milestones and current source layout

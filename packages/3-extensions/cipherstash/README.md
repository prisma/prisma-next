# `@prisma-next/extension-cipherstash`

Searchable-encryption integration for Prisma Next, backed by
[CipherStash](https://cipherstash.com/) and the EQL Postgres extension.

> **Status:** in development. This package is being built incrementally as part
> of the cipherstash-integration project. The currently-implemented surface is
> the **storage** path: an `EncryptedString` envelope, its codec, and the
> EQL-bundle install dependency. Search operators (`eq`, `ilike`),
> `decryptAll`, the bulk-encrypt middleware, the PSL constructor, and the
> `encryptedString({...})` TS factory land in subsequent milestones.

## Subpath exports

Mirrors the layout enumerated in
[`envelope-codec-extension.spec.md` § Subpath exports](../../../projects/cipherstash-integration/project-1/specs/envelope-codec-extension.spec.md):

| Subpath           | Purpose                                                       |
| ----------------- | ------------------------------------------------------------- |
| `.`               | `EncryptedString`, `decryptAll` (decryptAll: TODO M4)         |
| `./column-types`  | `encryptedString({...})` TS factory (TODO M2.b)               |
| `./runtime`       | `SqlRuntimeExtensionDescriptor` with `parameterizedCodecs`    |
| `./control`       | `SqlControlExtensionDescriptor` with `databaseDependencies`   |
| `./middleware`    | `bulkEncryptMiddleware` factory (TODO M2.c)                   |

## Usage (target shape)

```ts
import { EncryptedString } from '@prisma-next/extension-cipherstash';

const envelope = EncryptedString.from('alice@example.com');
const plaintext = await envelope.decrypt();
```

See the project plan and spec under
`projects/cipherstash-integration/project-1/` for the full surface and
acceptance criteria.

/**
 * CipherStash SDK adapter.
 *
 * Adapts {@link https://www.npmjs.com/package/@cipherstash/stack | `@cipherstash/stack`}'s
 * `EncryptionClient` to the framework-native {@link CipherstashSdk} shape
 * consumed by `createCipherstashRuntimeDescriptor` and
 * `bulkEncryptMiddleware`. Every encrypt/decrypt call here is a real
 * ZeroKMS round-trip; there is no stub fallback.
 *
 * The framework passes routing keys as `(table, column)` strings (it
 * doesn't know about stack's typed schema objects). We resolve those back
 * to the typed {@link EncryptedTable}/{@link EncryptedColumn} pair via a
 * tiny registry built from the schema in `./encryption`. Any new
 * encrypted column needs an entry here AND in the schema file.
 */

import type { Encrypted } from '@cipherstash/stack';
import type {
  CipherstashRoutingKey,
  CipherstashSdk,
} from '@prisma-next/extension-cipherstash/runtime';
import { encryptionClient, users } from './encryption';

const tableRegistry = {
  users: { table: users, columns: { email: users.email } },
} as const;

function lookup(routingKey: CipherstashRoutingKey) {
  const tableName = routingKey.table as keyof typeof tableRegistry;
  const entry = tableRegistry[tableName];
  if (!entry) {
    throw new Error(
      `cipherstash SDK: unknown routing-key table "${routingKey.table}". ` +
        'Add it to the schema in src/encryption/index.ts and the registry in src/sdk.ts.',
    );
  }
  const columnName = routingKey.column as keyof typeof entry.columns;
  const column = entry.columns[columnName];
  if (!column) {
    throw new Error(
      `cipherstash SDK: unknown routing-key column "${routingKey.column}" on table "${routingKey.table}".`,
    );
  }
  return { table: entry.table, column };
}

function ensureString(value: unknown, kind: 'decrypt' | 'bulkDecrypt'): string {
  if (typeof value !== 'string') {
    throw new Error(
      `cipherstash ${kind} returned non-string plaintext (${typeof value}); ` +
        'the example schema only encrypts string columns.',
    );
  }
  return value;
}

export function createCipherstashSdk(): CipherstashSdk {
  return {
    async bulkEncrypt({ values, routingKey }) {
      const { table, column } = lookup(routingKey);
      const result = await encryptionClient.bulkEncrypt(
        values.map((plaintext) => ({ plaintext })),
        { column, table },
      );
      if (result.failure) {
        throw new Error(`cipherstash bulkEncrypt failed: ${result.failure.message}`);
      }
      return result.data.map((entry) => entry.data);
    },

    async bulkDecrypt({ ciphertexts }) {
      // Framework-side ciphertexts are typed `unknown` to keep the SDK
      // contract opaque (see `CipherstashSingleDecryptArgs`); on the wire
      // they're stack-shaped EQL v2 envelopes, so reinterpret them at the
      // SDK boundary.
      const payload = ciphertexts.map((data) => ({ data: data as Encrypted }));
      const result = await encryptionClient.bulkDecrypt(payload);
      if (result.failure) {
        throw new Error(`cipherstash bulkDecrypt failed: ${result.failure.message}`);
      }
      return result.data.map((entry) => {
        if (entry.error !== undefined) {
          throw new Error(`cipherstash bulkDecrypt entry failed: ${String(entry.error)}`);
        }
        return ensureString(entry.data, 'bulkDecrypt');
      });
    },

    async decrypt({ ciphertext }) {
      const result = await encryptionClient.decrypt(ciphertext as Encrypted);
      if (result.failure) {
        throw new Error(`cipherstash decrypt failed: ${result.failure.message}`);
      }
      return ensureString(result.data, 'decrypt');
    },
  };
}

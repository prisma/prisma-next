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

// `JsPlaintext` is the input type the stack SDK's `bulkEncrypt`
// accepts: `string | number | boolean | Record<string, unknown> | JsPlaintext[]`.
// `@cipherstash/stack` does not re-export it, and `@cipherstash/protect-ffi`
// is an indirect dependency we don't list directly in package.json,
// so we redeclare the structural shape locally rather than reach
// across packages. The redeclaration is recursive on the array
// branch — kept in sync with the stack SDK's typesync.
type JsPlaintext = string | number | boolean | { [key: string]: unknown } | JsPlaintext[];

import type {
  CipherstashRoutingKey,
  CipherstashSdk,
} from '@prisma-next/extension-cipherstash/runtime';
import { encryptionClient, users } from './encryption';

const tableRegistry = {
  users: {
    table: users,
    columns: {
      email: users.email,
      salary: users.salary,
      accountId: users.accountId,
      birthday: users.birthday,
      emailVerified: users.emailVerified,
      preferences: users.preferences,
    },
  },
} as const;

function lookup(routingKey: CipherstashRoutingKey) {
  if (!Object.hasOwn(tableRegistry, routingKey.table)) {
    throw new Error(
      `cipherstash SDK: unknown routing-key table "${routingKey.table}". ` +
        'Add it to the schema in src/encryption/index.ts and the registry in src/sdk.ts.',
    );
  }
  const entry = tableRegistry[routingKey.table as keyof typeof tableRegistry];
  if (!Object.hasOwn(entry.columns, routingKey.column)) {
    throw new Error(
      `cipherstash SDK: unknown routing-key column "${routingKey.column}" on table "${routingKey.table}".`,
    );
  }
  const column = entry.columns[routingKey.column as keyof typeof entry.columns];
  return { table: entry.table, column };
}

function isEncryptedEnvelope(value: unknown): value is Encrypted {
  if (typeof value !== 'object' || value === null) return false;
  if (!Object.hasOwn(value, 'i') || !Object.hasOwn(value, 'v')) return false;
  const candidate = value as { i: unknown; v: unknown; c?: unknown };
  if (typeof candidate.v !== 'number') return false;
  if (typeof candidate.i !== 'object' || candidate.i === null) return false;
  if (!Object.hasOwn(candidate.i, 't') || !Object.hasOwn(candidate.i, 'c')) return false;
  if (Object.hasOwn(candidate, 'c') && typeof candidate.c !== 'string') return false;
  return true;
}

function ensureEncryptedEnvelope(
  value: unknown,
  kind: 'decrypt' | 'bulkDecrypt',
  index?: number,
): Encrypted {
  if (!isEncryptedEnvelope(value)) {
    const where = index === undefined ? '' : ` at index ${index}`;
    throw new Error(
      `cipherstash ${kind}: ciphertext${where} is not a valid EQL v2 envelope ` +
        '(expected an object with `i: { t, c }`, numeric `v`, and optional string `c`).',
    );
  }
  return value;
}

/**
 * Coerce a framework-side plaintext (`unknown` — produced by a
 * cipherstash codec's `encode` call site, which strips back to the
 * envelope's bare JS plaintext before handing the value to this SDK
 * adapter) into the {@link JsPlaintext} shape `@cipherstash/stack`
 * accepts.
 *
 * The framework allows codec authors to round-trip arbitrary JS
 * values (`bigint`, `Date`, `boolean`, `Record<string, unknown>`, …)
 * but the stack SDK's wire contract is the narrower
 * `string | number | boolean | Record<string, unknown> | JsPlaintext[]`.
 * This adapter narrows on the boundary:
 *
 *   - `bigint` → decimal string (CipherStash's bigint codec
 *     round-trips through the string representation).
 *   - `Date`   → ISO 8601 string (the date codec round-trips through
 *     ISO; both ZeroKMS and the EQL bundle accept the textual form).
 *   - everything else is asserted to satisfy `JsPlaintext`; if the
 *     framework hands us something else (e.g. `null` or a function)
 *     `bulkEncrypt` will fail downstream with a clearer error than a
 *     bare cast would produce.
 */
function toJsPlaintext(value: unknown): JsPlaintext {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  return value as JsPlaintext;
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
        values.map((plaintext) => ({ plaintext: toJsPlaintext(plaintext) })),
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
      // they're stack-shaped EQL v2 envelopes, so validate each one at
      // the SDK boundary before handing it to the encryption client.
      const payload = ciphertexts.map((data, index) => ({
        data: ensureEncryptedEnvelope(data, 'bulkDecrypt', index),
      }));
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
      const result = await encryptionClient.decrypt(ensureEncryptedEnvelope(ciphertext, 'decrypt'));
      if (result.failure) {
        throw new Error(`cipherstash decrypt failed: ${result.failure.message}`);
      }
      return ensureString(result.data, 'decrypt');
    },
  };
}

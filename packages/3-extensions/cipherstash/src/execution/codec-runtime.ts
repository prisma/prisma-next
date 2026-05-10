/**
 * Cipherstash storage codec runtime — wraps the `EncryptedString`
 * envelope at the SQL codec boundary.
 *
 * Responsibilities are intentionally thin:
 *
 * - `decode(wire, ctx)` constructs a fresh envelope carrying the wire
 *   ciphertext + the cell's `(table, column)` from `ctx.column` + the
 *   SDK reference captured at codec construction time. The envelope's
 *   `decrypt({signal?})` later routes through the captured SDK; callers
 *   can also `await decryptAll(rows)` to coalesce decrypts across many
 *   envelopes into one bulk SDK call.
 *
 * - `encode(envelope, ctx)` extracts the ciphertext from the envelope's
 *   handle. The bulk-encrypt middleware populates the ciphertext slot
 *   before the codec runs; an envelope whose ciphertext
 *   slot is empty at encode time is a programmer error (the middleware
 *   was not registered, or this codec instance was used in a non-
 *   cipherstash context).
 *
 * The wire format wraps the SDK's JSON ciphertext payload in the
 * Postgres composite literal `("...escaped JSON...")` because EQL
 * defines `eql_v2_encrypted` as `CREATE TYPE eql_v2_encrypted AS (data
 * jsonb)`, not as a domain over jsonb. The default `pg` driver encodes
 * JS objects as JSON which Postgres then rejects when coercing into the
 * composite. Mirrors the reference Drizzle integration at
 * `reference/cipherstash/.../drizzle/src/pg/index.ts`.
 *
 * The codec captures the SDK at construction time, so multi-tenant
 * deployments construct one extension instance per tenant — each with
 * its own SDK — rather than sharing a module-singleton codec.
 */

import type { JsonValue } from '@prisma-next/contract/types';
import { type AnyCodecDescriptor, CodecImpl } from '@prisma-next/framework-components/codec';
import type { Codec, SqlCodecCallContext } from '@prisma-next/sql-relational-core/ast';
import { CIPHERSTASH_STRING_CODEC_ID } from '../extension-metadata/constants';
import { EncryptedString } from './envelope';
import type { CipherstashSdk } from './sdk';

const CIPHERSTASH_STRING_TARGET_TYPE = 'eql_v2_encrypted' as const;
// Cipherstash columns intentionally declare no codec traits.
//
// The framework's `equality` trait gates the built-in `eq` / `neq` /
// `in` / `notIn` comparison methods (see `COMPARISON_METHODS_META` in
// `packages/3-extensions/sql-orm-client/src/types.ts`). Those built-
// ins lower to standard SQL `=` / `!=` / `IN`, which is wrong for
// cipherstash columns because EQL ciphers contain randomized nonces
// and do not byte-equal under `=`. Declaring `equality` here would
// silently expose the wrong-SQL footgun; declaring `[]` makes
// `email.eq(...)` undefined at the column accessor and forces callers
// onto the cipherstash-namespaced operator surface
// (`email.cipherstashEq(...)` — see `./operators.ts`). The trait
// declaration is regression-pinned by `test/equality-trait-removal.test.ts`.
//
// The user-visible `EncryptedString({ equality: true })` flag in PSL
// / TS authoring is unrelated to this codec trait — it controls
// whether the codec lifecycle hook contributes a per-column search-
// config migration op for the column's `unique` index. The two
// `equality` concepts share only their name.
const CIPHERSTASH_STRING_TRAITS = [] as const;

/**
 * Encode the SDK ciphertext payload as a Postgres composite literal
 * `("...escaped JSON...")`. Embedded `"` are doubled per the composite
 * text-format escape rules.
 */
function encodeEqlV2EncryptedWire(payload: unknown): string {
  const json = JSON.stringify(payload);
  if (json === undefined) {
    throw new Error(
      'cipherstash codec: ciphertext payload is not JSON-serializable. ' +
        'The CipherStash SDK must return a JSON-encodable bulk-encrypt result.',
    );
  }
  const escaped = json.replaceAll('"', '""');
  return `("${escaped}")`;
}

/**
 * Inverse of {@link encodeEqlV2EncryptedWire}. Postgres returns
 * `eql_v2_encrypted` cells in composite text format; some pg clients
 * pre-parse composite cells into `{ data: ... }` row objects. Both
 * shapes — and `null`/`undefined` passthrough — are accepted.
 */
function decodeEqlV2EncryptedWire(wire: unknown): unknown {
  if (wire === null || wire === undefined) return wire;
  if (typeof wire === 'object') {
    if ('data' in wire) {
      return (wire as { data: unknown }).data;
    }
    return wire;
  }
  if (typeof wire !== 'string') {
    throw new Error(
      `cipherstash codec: unexpected wire shape for eql_v2_encrypted: ${typeof wire}`,
    );
  }
  const trimmed = wire.trim();
  if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) {
    throw new Error(
      `cipherstash codec: expected composite literal "(...)" but got: ${trimmed.slice(0, 40)}`,
    );
  }
  const inner = trimmed.slice(1, -1);
  const unquoted =
    inner.startsWith('"') && inner.endsWith('"') ? inner.slice(1, -1).replaceAll('""', '"') : inner;
  return JSON.parse(unquoted);
}

export class CipherstashStringCodec
  extends CodecImpl<
    typeof CIPHERSTASH_STRING_CODEC_ID,
    typeof CIPHERSTASH_STRING_TRAITS,
    unknown,
    EncryptedString
  >
  implements
    Codec<
      typeof CIPHERSTASH_STRING_CODEC_ID,
      typeof CIPHERSTASH_STRING_TRAITS,
      unknown,
      EncryptedString
    >
{
  readonly sdk: CipherstashSdk | undefined;

  constructor(descriptor: AnyCodecDescriptor, sdk: CipherstashSdk | undefined) {
    super(descriptor);
    this.sdk = sdk;
  }

  async encode(value: EncryptedString, _ctx: SqlCodecCallContext): Promise<unknown> {
    const handle = value.expose();
    if (handle.ciphertext === undefined) {
      throw new Error(
        'cipherstash codec: envelope has no ciphertext at encode time. ' +
          'Register the bulk-encrypt middleware in the runtime so envelopes are encrypted before encoding.',
      );
    }
    return encodeEqlV2EncryptedWire(handle.ciphertext);
  }

  async decode(wire: unknown, ctx: SqlCodecCallContext): Promise<EncryptedString> {
    if (this.sdk === undefined) {
      throw new Error(
        'cipherstash codec: decode called on the metadata-only codec instance. ' +
          'Construct a runtime descriptor via `createCipherstashRuntimeDescriptor({ sdk })` and use that instead.',
      );
    }
    const column = ctx.column;
    if (!column) {
      throw new Error(
        'cipherstash codec: decode requires ctx.column to construct a routing-aware envelope. ' +
          'The SQL runtime populates ctx.column for projected columns; aggregate/computed cells are not supported by this codec.',
      );
    }
    return EncryptedString.fromInternal({
      ciphertext: decodeEqlV2EncryptedWire(wire),
      table: column.table,
      column: column.name,
      sdk: this.sdk,
    });
  }

  encodeJson(_value: EncryptedString): JsonValue {
    return { $encryptedString: '<opaque>' };
  }

  decodeJson(_json: JsonValue): EncryptedString {
    throw new Error(
      'cipherstash codec: decodeJson is not supported; envelopes do not round-trip through JSON.',
    );
  }
}

/**
 * Variance-erased descriptor placeholder used by `createCipherstashStringCodec`
 * so legacy callers that need a bare `Codec` instance (e.g. extension control-
 * plane wiring that built up a flat list of codecs) can keep constructing one
 * directly. Production runtime descriptors should resolve the per-instance
 * codec through `CipherstashStringDescriptor.factory(params)(ctx)`.
 */
const FALLBACK_DESCRIPTOR: AnyCodecDescriptor = {
  codecId: CIPHERSTASH_STRING_CODEC_ID,
  traits: CIPHERSTASH_STRING_TRAITS,
  targetTypes: [CIPHERSTASH_STRING_TARGET_TYPE],
  meta: {
    db: { sql: { postgres: { nativeType: CIPHERSTASH_STRING_TARGET_TYPE } } },
  },
  paramsSchema: {
    '~standard': {
      version: 1,
      vendor: 'cipherstash',
      validate: (value: unknown) => ({ value }),
    },
  },
  isParameterized: false,
  renderOutputType: () => 'EncryptedString',
  factory: () => () => {
    throw new Error('cipherstash codec: fallback descriptor factory is not callable');
  },
};

export function createCipherstashStringCodec(sdk: CipherstashSdk): CipherstashStringCodec {
  return new CipherstashStringCodec(FALLBACK_DESCRIPTOR, sdk);
}

export { CIPHERSTASH_STRING_CODEC_ID };

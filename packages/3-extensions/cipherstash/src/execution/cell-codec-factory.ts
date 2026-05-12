/**
 * Shared factory for every cipherstash storage codec runtime.
 *
 * Every cipherstash codec (`cipherstash/string@1`, `cipherstash/double@1`,
 * `cipherstash/bigint@1`, `cipherstash/date@1`,
 * `cipherstash/boolean@1`, `cipherstash/json@1`) wires the same
 * encode/decode body:
 *
 *   - `encode(envelope, ctx)` extracts `handle.ciphertext` and renders
 *     it as the `eql_v2_encrypted` Postgres composite literal.
 *   - `decode(wire, ctx)` parses the wire (composite literal or
 *     pre-parsed `{ data: ... }` row), constructs a fresh envelope via
 *     the codec's per-type `fromInternal` factory, and stamps the
 *     `(table, column)` routing context from `ctx.column`.
 *
 * Only two values vary per codec:
 *
 *   - `codecId` — the `cipherstash/<x>@1` discriminator.
 *   - `fromInternal` — the per-type envelope factory
 *     (`EncryptedString.fromInternal`, `EncryptedDouble.fromInternal`,
 *     etc.).
 *
 * The factory parallels {@link makeCipherstashCodecHooks} on the
 * migration plane (see `../migration/codec-hooks-factory.ts`) — same
 * pattern, opposite plane: control plane = lifecycle hooks, runtime
 * plane = encode/decode bodies.
 */

import type { JsonValue } from '@prisma-next/contract/types';
import {
  type AnyCodecDescriptor,
  CodecImpl,
  type CodecTrait,
} from '@prisma-next/framework-components/codec';
import type { Codec, SqlCodecCallContext } from '@prisma-next/sql-relational-core/ast';
import { CIPHERSTASH_CODEC_TRAITS, EQL_V2_ENCRYPTED_TYPE } from '../extension-metadata/constants';
import type { EncryptedEnvelopeBase } from './envelope-base';
import type { CipherstashSdk } from './sdk';

const CIPHERSTASH_TARGET_TYPES = [EQL_V2_ENCRYPTED_TYPE] as const;

/**
 * Encode the SDK ciphertext payload as a Postgres composite literal
 * `("...escaped JSON...")`. Embedded `"` are doubled per the composite
 * text-format escape rules. Identical across every cipherstash codec —
 * the wire format is determined by `eql_v2_encrypted`'s definition
 * (`CREATE TYPE eql_v2_encrypted AS (data jsonb)`), not by the codec's
 * plaintext type.
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

export interface CipherstashCellCodecOptions<E extends EncryptedEnvelopeBase<unknown>> {
  readonly codecId: string;
  readonly typeName: string;
  readonly fromInternal: (args: {
    readonly ciphertext: unknown;
    readonly table: string;
    readonly column: string;
    readonly sdk: CipherstashSdk;
  }) => E;
}

export class CipherstashCellCodec<E extends EncryptedEnvelopeBase<unknown>> extends CodecImpl<
  string,
  readonly CodecTrait[],
  unknown,
  E
> {
  readonly sdk: CipherstashSdk | undefined;
  readonly #fromInternal: CipherstashCellCodecOptions<E>['fromInternal'];
  readonly #typeName: string;

  constructor(
    descriptor: AnyCodecDescriptor,
    sdk: CipherstashSdk | undefined,
    options: CipherstashCellCodecOptions<E>,
  ) {
    super(descriptor);
    this.sdk = sdk;
    this.#fromInternal = options.fromInternal;
    this.#typeName = options.typeName;
  }

  async encode(value: E, _ctx: SqlCodecCallContext): Promise<unknown> {
    const handle = value.expose();
    if (handle.ciphertext === undefined) {
      throw new Error(
        'cipherstash codec: envelope has no ciphertext at encode time. ' +
          'Register the bulk-encrypt middleware in the runtime so envelopes are encrypted before encoding.',
      );
    }
    return encodeEqlV2EncryptedWire(handle.ciphertext);
  }

  async decode(wire: unknown, ctx: SqlCodecCallContext): Promise<E> {
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
    return this.#fromInternal({
      ciphertext: decodeEqlV2EncryptedWire(wire),
      table: column.table,
      column: column.name,
      sdk: this.sdk,
    });
  }

  encodeJson(_value: E): JsonValue {
    const marker = `$${this.#typeName.charAt(0).toLowerCase()}${this.#typeName.slice(1)}`;
    return { [marker]: '<opaque>' } as JsonValue;
  }

  decodeJson(_json: JsonValue): E {
    throw new Error(
      'cipherstash codec: decodeJson is not supported; envelopes do not round-trip through JSON.',
    );
  }
}

/**
 * Construct a fallback descriptor for a cipherstash cell codec. Used
 * by `create*Codec(sdk)` callers that need a bare `Codec` instance and
 * by `Codec` declarations in tests; production runtime descriptors
 * resolve the per-instance codec through the parameterized descriptor's
 * `factory(params)(ctx)` path.
 */
function makeFallbackDescriptor<E extends EncryptedEnvelopeBase<unknown>>(
  options: CipherstashCellCodecOptions<E>,
): AnyCodecDescriptor {
  return {
    codecId: options.codecId,
    traits: CIPHERSTASH_CODEC_TRAITS[options.codecId] ?? [],
    targetTypes: CIPHERSTASH_TARGET_TYPES,
    meta: {
      db: { sql: { postgres: { nativeType: EQL_V2_ENCRYPTED_TYPE } } },
    },
    paramsSchema: {
      '~standard': {
        version: 1,
        vendor: 'cipherstash',
        validate: (value: unknown) => ({ value }),
      },
    },
    isParameterized: false,
    renderOutputType: () => options.typeName,
    factory: () => () => {
      throw new Error('cipherstash codec: fallback descriptor factory is not callable');
    },
  };
}

/**
 * Construct the runtime codec for a cipherstash cell codec given its
 * codec id, the user-facing type name, and the per-type envelope
 * `fromInternal` factory.
 */
export function makeCipherstashCellCodec<E extends EncryptedEnvelopeBase<unknown>>(
  sdk: CipherstashSdk,
  options: CipherstashCellCodecOptions<E>,
): CipherstashCellCodec<E> & Codec<string, readonly CodecTrait[], unknown, E> {
  return new CipherstashCellCodec(makeFallbackDescriptor(options), sdk, options);
}

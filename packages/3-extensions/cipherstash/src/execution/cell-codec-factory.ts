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
import { runtimeError } from '@prisma-next/framework-components/runtime';
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
      throw runtimeError(
        'RUNTIME.ENCODE_FAILED',
        `cipherstash ${this.descriptor.codecId}: encrypted column value has not been encrypted yet. ` +
          'Add the cipherstash bulk-encrypt middleware to your runtime so plaintext values are encrypted before encode runs. ' +
          'Example: `runtime({ ..., middleware: [bulkEncryptMiddleware({ sdk })] })`. ' +
          'See the cipherstash extension README for the full runtime wiring.',
        {
          codecId: this.descriptor.codecId,
          reason: 'cipherstash-ciphertext-missing',
          envelopeRouting: { table: handle.table, column: handle.column },
        },
      );
    }
    return encodeEqlV2EncryptedWire(handle.ciphertext);
  }

  async decode(wire: unknown, ctx: SqlCodecCallContext): Promise<E> {
    if (this.sdk === undefined) {
      throw runtimeError(
        'RUNTIME.DECODE_FAILED',
        `cipherstash ${this.descriptor.codecId}: decode invoked on a metadata-only codec instance that has no SDK attached. ` +
          'Build a runtime codec via the parameterized descriptors returned by `createParameterizedCodecDescriptors(sdk)`, ' +
          `or construct the codec directly through the matching \`create*Codec(sdk)\` factory (e.g. \`create${this.#typeName}Codec\`) ` +
          'exported from `@prisma-next/extension-cipherstash/runtime`.',
        {
          codecId: this.descriptor.codecId,
          reason: 'cipherstash-sdk-required',
        },
      );
    }
    const column = ctx.column;
    if (!column) {
      throw runtimeError(
        'RUNTIME.DECODE_FAILED',
        `cipherstash ${this.descriptor.codecId}: decode requires the column routing context that the SQL runtime populates ` +
          'for projected columns. The cell being decoded came from an aggregate, computed expression, or other unrouted source. ' +
          'cipherstash codecs need a stable `(table, column)` routing key for envelope construction and bulk-decrypt grouping; ' +
          'project the underlying encrypted column directly instead of through an aggregate.',
        {
          codecId: this.descriptor.codecId,
          reason: 'cipherstash-decode-column-context-missing',
        },
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
 * Construct an auxiliary descriptor for a cipherstash cell codec.
 *
 * The framework's `CodecImpl` base class requires a `descriptor` field
 * on every codec instance; readers like `codec.id` proxy through
 * `descriptor.codecId`. The production lookup path, however, resolves
 * cipherstash codecs through the **parameterized** descriptors built
 * in `parameterized.ts` — its `factory(params)(ctx)` returns the codec
 * instance directly, never going via `codec.descriptor.factory`.
 *
 * This descriptor therefore needs only to carry **truthful metadata**
 * (`codecId`, `traits`, `targetTypes`, `meta`, `renderOutputType`) so
 * that any caller reading those fields off the codec sees the right
 * values. Its `factory` field is intentionally a throwing stub: if
 * anything ever does invoke it, that is a programming error (the call
 * site should be going through the parameterized descriptor) and a
 * loud failure is preferred to a silent fallback.
 *
 * The auxiliary cannot be replaced by passing the parameterized
 * descriptor through to the codec constructor because the
 * parameterized descriptor's `factory` resolves to the codec instance
 * itself — constructing the descriptor before the codec, and the
 * codec before the descriptor, are mutually circular.
 */
function makeAuxiliaryDescriptor<E extends EncryptedEnvelopeBase<unknown>>(
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
      throw new Error(
        'cipherstash codec: auxiliary descriptor factory was invoked. ' +
          'This is a programming error — cipherstash codecs are resolved through the ' +
          'parameterized descriptors built in `parameterized.ts`, not through ' +
          '`codec.descriptor.factory`. Use `createParameterizedCodecDescriptors(sdk)` ' +
          'to get the production runtime descriptors.',
      );
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
  return new CipherstashCellCodec(makeAuxiliaryDescriptor(options), sdk, options);
}

/**
 * Runtime smoke tests for the class-based arktype-json codec (TML-2357
 * M0 Phase B4).
 *
 * The encode/decode/encodeJson/decodeJson bodies share semantics with
 * the legacy `arktypeJson(schema)` form (see arktype-json-codec.test.ts
 * for the comprehensive suite). These tests cover:
 *
 * - the column-author helper produces a working codec whose `id`
 *   proxies through the descriptor's `codecId`.
 * - the descriptor's factory rehydrates the schema and returns a
 *   working codec for runtime materialization paths.
 * - schema validation rejects malformed payloads at decode through
 *   the codec class.
 */

import type { CodecInstanceContext } from '@prisma-next/framework-components/codec';
import type { SqlCodecCallContext } from '@prisma-next/sql-relational-core/ast';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { ARKTYPE_JSON_CODEC_ID } from '../src/core/arktype-json-codec';
import {
  arktypeJsonColumn,
  arktypeJsonDescriptorClass,
} from '../src/core/arktype-json-codec-class';

const SYNTH_CTX: CodecInstanceContext = { name: '<arktype-json-class-test>' };
const CALL_CTX: SqlCodecCallContext = {};

const productSchema = type({
  name: 'string',
  price: 'number',
  'description?': 'string',
});

describe('arktypeJsonColumn(schema)', () => {
  it('returns a ColumnSpec with codecId, nativeType, typeParams', () => {
    const col = arktypeJsonColumn(productSchema);
    expect(col.codecId).toBe(ARKTYPE_JSON_CODEC_ID);
    expect(col.nativeType).toBe('jsonb');
    expect(col.typeParams.expression).toBe(productSchema.expression);
    expect(col.typeParams.jsonIr).toEqual(productSchema.json);
  });

  it('codecFactory(ctx) materializes a working codec', async () => {
    const col = arktypeJsonColumn(productSchema);
    const codec = col.codecFactory(SYNTH_CTX);
    expect(codec.id).toBe(ARKTYPE_JSON_CODEC_ID);

    const value = { name: 'Widget', price: 9.99 };
    const wire = await codec.encode(value, CALL_CTX);
    expect(typeof wire).toBe('string');
    const decoded = await codec.decode(wire, CALL_CTX);
    expect(decoded).toEqual(value);
  });

  it('decode rejects payloads that fail schema validation', async () => {
    const col = arktypeJsonColumn(productSchema);
    const codec = col.codecFactory(SYNTH_CTX);
    const wire = JSON.stringify({ name: 'Widget' });
    await expect(codec.decode(wire, CALL_CTX)).rejects.toThrow(/schema validation failed/);
  });

  it('encodeJson / decodeJson round-trip through schema', () => {
    const col = arktypeJsonColumn(productSchema);
    const codec = col.codecFactory(SYNTH_CTX);
    const value = { name: 'Widget', price: 9.99, description: 'A widget' };
    const json = codec.encodeJson(value);
    const decoded = codec.decodeJson(json);
    expect(decoded).toEqual(value);
  });

  it('rejects non-callable schema lookalikes at the call site', () => {
    const notASchema = { foo: 'bar' };
    // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed input for the call-site guard
    expect(() => arktypeJsonColumn(notASchema as any)).toThrow(/callable arktype Type/);
  });
});

describe('arktypeJsonDescriptorClass.factory(params)', () => {
  it('rehydrates the schema from typeParams.jsonIr and produces a working codec', async () => {
    const col = arktypeJsonColumn(productSchema);
    const factory = arktypeJsonDescriptorClass.factory(col.typeParams);
    const codec = factory(SYNTH_CTX);
    expect(codec.id).toBe(ARKTYPE_JSON_CODEC_ID);

    const value = { name: 'Widget', price: 9.99 };
    const wire = await codec.encode(value, CALL_CTX);
    const decoded = await codec.decode(wire, CALL_CTX);
    expect(decoded).toEqual(value);
  });

  it('descriptor metadata: traits, targetTypes', () => {
    expect(arktypeJsonDescriptorClass.codecId).toBe(ARKTYPE_JSON_CODEC_ID);
    expect(arktypeJsonDescriptorClass.traits).toEqual(['equality']);
    expect(arktypeJsonDescriptorClass.targetTypes).toEqual(['jsonb']);
  });

  it('renderOutputType returns the eager-extracted expression', () => {
    const col = arktypeJsonColumn(productSchema);
    const rendered = arktypeJsonDescriptorClass.renderOutputType(col.typeParams);
    expect(rendered).toBe(productSchema.expression);
  });

  it('throws on corrupt jsonIr at factory time', () => {
    expect(() =>
      arktypeJsonDescriptorClass.factory({
        expression: 'string',
        jsonIr: { not: 'a-valid-arktype-ir' },
      }),
    ).toThrow(/Failed to rehydrate arktype schema from contract IR/);
  });
});

import {
  type Codec,
  type ContractCodecRegistry,
  newCodecRegistry,
  type SqlCodecCallContext,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { encodeParam } from '../src/codecs/encoding';
import { defineTestCodec } from './test-codec';

/**
 * Encode-side dispatch (AC-5):
 *
 * `encodeParam` consults `paramRef.refs` and resolves through
 * `contractCodecs.forColumn(refs.table, refs.column)` when present. The
 * codec-id-keyed fallback (`forCodecId`) is reserved for refs-less
 * non-parameterized codec ids — parameterized codec ids reaching encode
 * without refs are caught by `validateParamRefRefs` upstream.
 */
describe('encodeParam — column-aware dispatch', () => {
  it('resolves the per-instance parameterized codec via forColumn when paramRef.refs is populated', async () => {
    const codec1024 = defineTestCodec({
      typeId: 'pgvector/vector@1',
      encode: (v: number[]) => `enc1024:${v.join(',')}`,
      decode: (wire: string) => wire.split(',').map(Number),
    });
    const codec1536 = defineTestCodec({
      typeId: 'pgvector/vector@1',
      encode: (v: number[]) => `enc1536:${v.join(',')}`,
      decode: (wire: string) => wire.split(',').map(Number),
    });

    const calls: Array<['forColumn', string, string] | ['forCodecId', string]> = [];
    const contractCodecs: ContractCodecRegistry = {
      forColumn: (table, column) => {
        calls.push(['forColumn', table, column]);
        if (table === 'Doc' && column === 'embedding') return codec1024;
        if (table === 'Page' && column === 'embedding') return codec1536;
        return undefined;
      },
      forCodecId: (codecId) => {
        calls.push(['forCodecId', codecId]);
        return undefined;
      },
    };

    const registry = newCodecRegistry();
    const ctx: SqlCodecCallContext = { signal: new AbortController().signal };

    const wireDoc = await encodeParam(
      [0.1, 0.2, 0.3],
      {
        codecId: 'pgvector/vector@1',
        name: 'p0',
        refs: { table: 'Doc', column: 'embedding' },
      },
      0,
      registry,
      ctx,
      contractCodecs,
    );

    expect(wireDoc).toBe('enc1024:0.1,0.2,0.3');
    expect(calls).toEqual([['forColumn', 'Doc', 'embedding']]);

    const wirePage = await encodeParam(
      [0.4, 0.5],
      {
        codecId: 'pgvector/vector@1',
        name: 'p0',
        refs: { table: 'Page', column: 'embedding' },
      },
      0,
      registry,
      ctx,
      contractCodecs,
    );

    expect(wirePage).toBe('enc1536:0.4,0.5');
    expect(calls).toEqual([
      ['forColumn', 'Doc', 'embedding'],
      ['forColumn', 'Page', 'embedding'],
    ]);
  });

  it('falls through to forCodecId only when refs are absent (refs-less non-parameterized path)', async () => {
    const scalarCodec = defineTestCodec({
      typeId: 'test/scalar@1',
      encode: (v: string) => `enc:${v}`,
      decode: (wire: string) => wire,
    });

    const calls: Array<['forColumn', string, string] | ['forCodecId', string]> = [];
    const contractCodecs: ContractCodecRegistry = {
      forColumn: (table, column) => {
        calls.push(['forColumn', table, column]);
        return undefined;
      },
      forCodecId: (codecId) => {
        calls.push(['forCodecId', codecId]);
        return scalarCodec;
      },
    };

    const registry = newCodecRegistry();
    const ctx: SqlCodecCallContext = { signal: new AbortController().signal };

    const wire = await encodeParam(
      'hello',
      { codecId: 'test/scalar@1', name: 'p0' },
      0,
      registry,
      ctx,
      contractCodecs,
    );

    expect(wire).toBe('enc:hello');
    expect(calls).toEqual([['forCodecId', 'test/scalar@1']]);
  });

  it('prefers forColumn when refs are present even if forCodecId would also resolve', async () => {
    const columnCodec = defineTestCodec({
      typeId: 'pgvector/vector@1',
      encode: (v: number[]) => `column:${v.join(',')}`,
      decode: (w: string) => w.split(',').map(Number),
    });
    const fallbackCodec = defineTestCodec({
      typeId: 'pgvector/vector@1',
      encode: (v: number[]) => `fallback:${v.join(',')}`,
      decode: (w: string) => w.split(',').map(Number),
    });

    const contractCodecs: ContractCodecRegistry = {
      forColumn: () => columnCodec,
      forCodecId: () => fallbackCodec,
    };

    const registry = newCodecRegistry();
    const ctx: SqlCodecCallContext = { signal: new AbortController().signal };

    const wire = await encodeParam(
      [0.1],
      {
        codecId: 'pgvector/vector@1',
        name: 'p0',
        refs: { table: 'Doc', column: 'embedding' },
      },
      0,
      registry,
      ctx,
      contractCodecs,
    );

    expect(wire).toBe('column:0.1');
  });

  it('null/undefined values bypass codec dispatch entirely', async () => {
    let invoked = false;
    const codec: Codec = defineTestCodec({
      typeId: 'pgvector/vector@1',
      encode: (v: number[]) => {
        invoked = true;
        return v;
      },
      decode: (w: number[]) => w,
    });

    const contractCodecs: ContractCodecRegistry = {
      forColumn: () => codec,
      forCodecId: () => codec,
    };

    const registry = newCodecRegistry();
    const ctx: SqlCodecCallContext = { signal: new AbortController().signal };

    const result = await encodeParam(
      null,
      {
        codecId: 'pgvector/vector@1',
        name: 'p0',
        refs: { table: 'Doc', column: 'embedding' },
      },
      0,
      registry,
      ctx,
      contractCodecs,
    );

    expect(result).toBeNull();
    expect(invoked).toBe(false);
  });
});

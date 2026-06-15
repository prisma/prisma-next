import type {
  Codec,
  CodecDescriptor,
  CodecRegistry,
} from '@prisma-next/framework-components/codec';
import {
  CodecDescriptorImpl,
  emptyCodecLookup,
  voidParamsSchema,
} from '@prisma-next/framework-components/codec';
import { extractCodecLookup } from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import {
  buildSqlNamespace,
  SqlStorage,
  type StorageTableInput,
} from '@prisma-next/sql-contract/types';
import type { ContractCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { col, fn, lit } from '@prisma-next/sql-relational-core/contract-free';
import { postgresCodecRegistry } from '@prisma-next/target-postgres/codecs';
import { jsonb, pgTable, text } from '@prisma-next/target-postgres/contract-free';
import { PostgresCreateTable } from '@prisma-next/target-postgres/ddl';
import { createContract } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { createPostgresBuiltinCodecLookup } from '../src/core/codec-lookup';
import { PostgresControlAdapter } from '../src/core/control-adapter';
import { encodeControlQueryParams } from '../src/core/control-codecs';
import type { PostgresContract } from '../src/core/types';

const adapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());
const ctx = { contract: {} as PostgresContract };

/**
 * A codec whose `encode` transforms its input (uppercases + prefixes). The
 * raw value never appears in correct output, so this test distinguishes
 * codec routing (the walker calls `encode` and inlines the wire result)
 * from the type-branching fallback (which would inline the raw value).
 */
const transformingCodec = {
  id: 'test/transform@1',
  encode: async (value: unknown) => `ENC:${String(value).toUpperCase()}`,
  decode: async (wire: unknown) => wire,
} as unknown as Codec;

const transformingLookup: CodecRegistry = {
  ...emptyCodecLookup,
  get: (id) => (id === 'test/transform@1' ? transformingCodec : undefined),
  forCodecRef: () => {
    throw new Error('not used in DDL tests');
  },
  forColumn: () => undefined,
};

describe('PostgresControlAdapter.lowerToExecuteRequest — DDL literal defaults', () => {
  it('inlines a string default with single-quoting and ::nativeType cast on non-text columns', async () => {
    const ast = new PostgresCreateTable({
      table: 'events',
      columns: [col('status', 'my_enum', { default: lit('active') })],
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toContain(`"status" my_enum DEFAULT 'active'::my_enum`);
    expect(result.params).toEqual([]);
  });

  it('inlines a string default without cast on text columns', async () => {
    const ast = new PostgresCreateTable({
      table: 't',
      columns: [col('note', 'text', { default: lit('hello') })],
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toContain(`"note" text DEFAULT 'hello'`);
    expect(result.sql).not.toContain('::');
    expect(result.params).toEqual([]);
  });

  it('inlines a Date default as ISO string with ::nativeType cast', async () => {
    const date = new Date('2025-06-01T00:00:00.000Z');
    const ast = new PostgresCreateTable({
      table: 'events',
      columns: [col('created_at', 'timestamptz', { default: lit(date) })],
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toContain(
      `"created_at" timestamptz DEFAULT '2025-06-01T00:00:00.000Z'::timestamptz`,
    );
    expect(result.params).toEqual([]);
  });

  it('inlines a bigint default as a bare numeric string', async () => {
    // Use a large integer stored as a number (ColumnDefaultLiteralInputValue includes number)
    const ast = new PostgresCreateTable({
      table: 'counters',
      columns: [col('big', 'int8', { default: lit(9007199254740991) })],
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toContain('"big" int8 DEFAULT 9007199254740991');
    expect(result.params).toEqual([]);
  });

  it('inlines a boolean default as bare true/false', async () => {
    const ast = new PostgresCreateTable({
      table: 'flags',
      columns: [
        col('active', 'boolean', { default: lit(true) }),
        col('disabled', 'boolean', { default: lit(false) }),
      ],
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toContain('"active" boolean DEFAULT true');
    expect(result.sql).toContain('"disabled" boolean DEFAULT false');
    expect(result.params).toEqual([]);
  });

  it('inlines a JSON-object default with ::jsonb cast', async () => {
    const ast = new PostgresCreateTable({
      table: 't',
      columns: [col('meta', 'jsonb', { default: lit({ key: 'val' }) })],
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toContain(`"meta" jsonb DEFAULT '{"key":"val"}'::jsonb`);
    expect(result.params).toEqual([]);
  });

  it('inlines a null default as DEFAULT NULL', async () => {
    const ast = new PostgresCreateTable({
      table: 't',
      columns: [col('opt', 'uuid', { default: lit(null) })],
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toContain('"opt" uuid DEFAULT NULL');
    expect(result.params).toEqual([]);
  });

  it('preserves a function default expression unchanged', async () => {
    const ast = new PostgresCreateTable({
      table: 't',
      columns: [
        col('id', 'uuid', { default: fn('gen_random_uuid()') }),
        col('ts', 'timestamptz', { default: fn('now()') }),
      ],
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toContain('"id" uuid DEFAULT (gen_random_uuid())');
    expect(result.sql).toContain('"ts" timestamptz DEFAULT (now())');
    expect(result.params).toEqual([]);
  });

  it('escapes single quotes in string defaults', async () => {
    const ast = new PostgresCreateTable({
      table: 't',
      columns: [col('name', 'text', { default: lit("O'Brien") })],
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toContain(`"name" text DEFAULT 'O''Brien'`);
    expect(result.params).toEqual([]);
  });
});

describe('PostgresControlAdapter.lowerToExecuteRequest — guards', () => {
  it('throws when a numeric literal default is non-finite (NaN / ±Infinity)', async () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const ast = new PostgresCreateTable({
        table: 'defaults',
        columns: [col('x', 'double precision', { default: lit(value) })],
      });
      await expect(adapter.lowerToExecuteRequest(ast, ctx)).rejects.toThrow(
        /non-finite number wire value/,
      );
    }
  });

  it('throws when a Date literal default is invalid', async () => {
    const ast = new PostgresCreateTable({
      table: 'defaults',
      columns: [col('x', 'timestamptz', { default: lit(new Date('not-a-date')) })],
    });
    await expect(adapter.lowerToExecuteRequest(ast, ctx)).rejects.toThrow(/invalid Date/);
  });

  it('routes a codec-bearing literal default through codec.encode (not raw type-branching)', async () => {
    const codecAdapter = new PostgresControlAdapter(transformingLookup);
    const ast = new PostgresCreateTable({
      table: 'secrets',
      columns: [
        col('token', 'text', {
          default: lit('plaintext'),
          codecRef: { codecId: 'test/transform@1' },
        }),
      ],
    });
    const result = await codecAdapter.lowerToExecuteRequest(ast, ctx);
    // The codec transformed 'plaintext' → 'ENC:PLAINTEXT'; the raw value must
    // NOT appear — that's the difference between routing and type-branching.
    expect(result.sql).toContain(`DEFAULT 'ENC:PLAINTEXT'`);
    expect(result.sql).not.toContain('plaintext');
  });

  it('falls back to raw inlining when the codecRef resolves to no codec', async () => {
    const ast = new PostgresCreateTable({
      table: 'secrets',
      columns: [
        col('token', 'text', {
          default: lit('plaintext'),
          codecRef: { codecId: 'unregistered@1' },
        }),
      ],
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    // Built-in lookup has no 'unregistered@1' → fallback inlines the raw value.
    expect(result.sql).toContain(`DEFAULT 'plaintext'`);
  });
});

const TEST_CODEC_ID = 'test/transform@1';

const queryTransformingCodec = {
  id: TEST_CODEC_ID,
  encode: async (value: unknown) => `ENC:${String(value).toUpperCase()}`,
  decode: async (wire: unknown) => wire,
} as unknown as Codec;

const testRegistry: ContractCodecRegistry = {
  forColumn: () => undefined,
  forCodecRef: (ref) => {
    if (ref.codecId === TEST_CODEC_ID) return queryTransformingCodec;
    throw new Error(`unknown codec ${ref.codecId}`);
  },
};

const testTable = pgTable(
  { name: 'things' },
  {
    label: { codecId: TEST_CODEC_ID, nullable: false },
    name: text(),
  },
);

const jsonbTable = pgTable(
  { name: 'json_things' },
  {
    meta: jsonb(),
    name: text(),
  },
);

const codecAdapter = new PostgresControlAdapter(transformingLookup);

describe('PostgresControlAdapter.lowerToExecuteRequest — query branch encoding', () => {
  it('codec-encodes a literal param bound to a transforming-codec column', async () => {
    const ast = testTable.select(testTable.label).where(testTable.label.eq('plaintext')).build();
    const lowered = codecAdapter.lower(ast, ctx);
    const params = await encodeControlQueryParams(lowered, ast, testRegistry);
    expect(params).not.toContain('plaintext');
    expect(params).toContain('ENC:PLAINTEXT');
  });

  it('passes uncodec-d params through unchanged', async () => {
    const ast = testTable.select(testTable.name).where(testTable.name.eq('raw-value')).build();
    const lowered = adapter.lower(ast, ctx);
    const params = await encodeControlQueryParams(lowered, ast);
    expect(params).toContain('raw-value');
  });

  it('lowerToExecuteRequest query branch returns an execute request for a plain column', async () => {
    const ast = testTable.select(testTable.name).where(testTable.name.eq('value')).build();
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result).toHaveProperty('sql');
    expect(result.params).toContain('value');
  });

  it('lowerToExecuteRequest encodes a jsonb param end-to-end via CONTROL_CODECS', async () => {
    const ast = jsonbTable
      .select(jsonbTable.name)
      .where(jsonbTable.meta.eq({ key: 'val' }))
      .build();
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.params).toContain('{"key":"val"}');
    expect(result.params).not.toContainEqual({ key: 'val' });
  });
});

const EXT_CODEC_ID = 'test/ext-transform@1';

class ExtTransformDescriptor extends CodecDescriptorImpl<void> {
  override readonly codecId = EXT_CODEC_ID;
  override readonly traits = [] as const;
  override readonly targetTypes = ['text'] as const;
  override readonly paramsSchema = voidParamsSchema;
  override factory(): (ctx: object) => Codec {
    return () =>
      ({
        id: EXT_CODEC_ID,
        encode: async (value: unknown) => `ENC:${String(value).toUpperCase()}`,
        decode: async (wire: unknown) => wire,
        encodeJson: (v: unknown) => v as never,
        decodeJson: (v: unknown) => v as never,
      }) as unknown as Codec;
  }
}

const extTransformDescriptor = new ExtTransformDescriptor();

function buildExtContractAndTable() {
  const tableColumns: StorageTableInput['columns'] = {
    label: { codecId: EXT_CODEC_ID, nativeType: 'text', nullable: false },
    name: { codecId: 'pg/text@1', nativeType: 'text', nullable: true },
  };
  const ns = buildSqlNamespace({
    id: UNBOUND_NAMESPACE_ID,
    entries: {
      table: {
        things: {
          columns: tableColumns,
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    },
  });
  const contract = createContract<PostgresContract['storage']>({
    storage: new SqlStorage({
      storageHash: 'sha256:test' as SqlStorage['storageHash'],
      namespaces: { [UNBOUND_NAMESPACE_ID]: ns },
    }),
  }) as PostgresContract;

  const table = pgTable(
    { name: 'things' },
    {
      label: { codecId: EXT_CODEC_ID, nullable: false },
      name: text(),
    },
  );
  return { contract, table };
}

describe('PostgresControlAdapter.lowerToExecuteRequest — extension codec end-to-end', () => {
  const extDescriptors = [
    ...Array.from(postgresCodecRegistry.values()),
    extTransformDescriptor as unknown as CodecDescriptor<unknown>,
  ];
  const extCodecLookup = extractCodecLookup([
    { id: 'ext-test-codecs', types: { codecTypes: { codecDescriptors: extDescriptors } } },
  ]);

  it('encodes a query param through an extension codec when the adapter receives the descriptor', async () => {
    const { contract, table } = buildExtContractAndTable();
    const extAdapter = new PostgresControlAdapter(extCodecLookup);

    const ast = table.select(table.label).where(table.label.eq('plaintext')).build();
    const result = await extAdapter.lowerToExecuteRequest(ast, { contract });

    expect(result.params).toContain('ENC:PLAINTEXT');
    expect(result.params).not.toContain('plaintext');
  });

  it('throws when a contract column references a codec absent from the adapter lookup', async () => {
    const { contract, table } = buildExtContractAndTable();
    const noExtAdapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());

    const ast = table.select(table.label).where(table.label.eq('plaintext')).build();
    await expect(noExtAdapter.lowerToExecuteRequest(ast, { contract })).rejects.toThrow(
      /ParamRef carries codecId|CODEC_DESCRIPTOR_MISSING|No codec descriptor registered/,
    );
  });
});

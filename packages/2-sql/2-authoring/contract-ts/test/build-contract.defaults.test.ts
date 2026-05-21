/**
 * Unit tests for the contract emitter's default-dispatch logic.
 *
 * Four paths exercised:
 * 1. autoincrement() sentinel → { kind: 'autoincrement' }; codec NOT invoked.
 * 2. .defaultSql(expr) function-form → { kind: 'expression', expression: '<source>' }; codec NOT invoked.
 * 3. null literal on a nullable column → { kind: 'expression', expression: 'NULL' }; codec NOT invoked.
 * 4. null literal on a NOT NULL column → diagnostic naming column + codec id; codec NOT invoked.
 * 5. Other literals → codec.renderSqlLiteral(value) → { kind: 'expression', expression: <result> }.
 *
 * "Codec NOT invoked" is enforced by a spy codec whose renderSqlLiteral
 * throws if called.
 */

import type { JsonValue } from '@prisma-next/contract/types';
import type { Codec, CodecCallContext, CodecLookup } from '@prisma-next/framework-components/codec';
import type { TargetPackRef } from '@prisma-next/framework-components/components';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { describe, expect, it, vi } from 'vitest';
import { buildSqlContractFromDefinition } from '../src/build-contract';
import type { ContractDefinition, FieldNode, ModelNode } from '../src/contract-definition';

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
};

function spyCodec(
  id: string,
  renderSqlLiteral: (value: unknown) => string,
): Codec & { renderSqlLiteral: ReturnType<typeof vi.fn> } {
  const spy = vi.fn(renderSqlLiteral);
  // The framework `Codec` interface (from `framework-components`) types
  // encode/decode as taking `CodecCallContext` and returning `Promise<TWire>`
  // / `Promise<TInput>`. The SQL `Codec` extension (from `relational-core`)
  // narrows the context to `SqlCodecCallContext` and adds `renderSqlLiteral`.
  // Building a literal that satisfies both shapes precisely would couple this
  // test to the SQL-lane types (a layering violation: contract-ts cannot
  // depend on lanes). The `as unknown as` bridges the structural mismatch on
  // the call-context type so the spy can stand in for a SQL codec via the
  // framework-level surface that `buildSqlContractFromDefinition` consumes.
  const codec: Codec & { renderSqlLiteral: ReturnType<typeof vi.fn> } = {
    id,
    encode: async (value: unknown, _ctx: CodecCallContext) => value,
    decode: async (wire: unknown, _ctx: CodecCallContext) => wire,
    encodeJson: (value: unknown) => value as JsonValue,
    decodeJson: (json: JsonValue) => json,
    renderSqlLiteral: spy,
  } as unknown as Codec & { renderSqlLiteral: ReturnType<typeof vi.fn> };
  return codec;
}

function codecLookupFor(codec: Codec & { id: string }): CodecLookup {
  return {
    get: (id: string) => (id === codec.id ? codec : undefined),
    targetTypesFor: () => undefined,
    metaFor: () => undefined,
    renderOutputTypeFor: () => undefined,
  };
}

function fieldNode(
  fieldName: string,
  columnName: string,
  codecId: string,
  nativeType: string,
  defaultValue: FieldNode['default'] | undefined,
  nullable: boolean,
): FieldNode {
  return {
    fieldName,
    columnName,
    descriptor: { codecId, nativeType },
    nullable,
    ...(defaultValue !== undefined ? { default: defaultValue } : {}),
  };
}

const probePkField: FieldNode = {
  fieldName: 'pkId',
  columnName: 'pk_id',
  descriptor: { codecId: 'pg/int4@1', nativeType: 'int4' },
  nullable: false,
};

function buildSingleColumnContract(field: FieldNode, codecLookup?: CodecLookup) {
  const model: ModelNode = {
    modelName: 'Probe',
    tableName: 'probe',
    namespaceId: UNBOUND_NAMESPACE_ID,
    fields: [probePkField, field],
    id: { columns: [probePkField.columnName] },
  };
  const definition: ContractDefinition = {
    target: postgresTargetPack,
    models: [model],
  };
  const contract = buildSqlContractFromDefinition(definition, codecLookup);
  const namespaces = contract.storage.namespaces as Record<
    string,
    { tables: Record<string, { columns: Record<string, unknown> }> }
  >;
  const column = namespaces[UNBOUND_NAMESPACE_ID]?.tables['probe']?.columns[field.columnName];
  return column as { default?: { kind: string; expression?: string } } | undefined;
}

describe('build-contract: column default dispatch', () => {
  it('lowers autoincrement sentinel to { kind: "autoincrement" } without invoking the codec', () => {
    const codec = spyCodec('pg/int4@1', () => {
      throw new Error('codec.renderSqlLiteral should not be invoked for autoincrement');
    });
    const column = buildSingleColumnContract(
      fieldNode('id', 'id', 'pg/int4@1', 'int4', { kind: 'autoincrement' }, false),
      codecLookupFor(codec),
    );
    expect(column?.default).toEqual({ kind: 'autoincrement' });
    expect(codec.renderSqlLiteral).not.toHaveBeenCalled();
  });

  it('passes function-form expression through unchanged; codec is not invoked', () => {
    const codec = spyCodec('pg/timestamptz@1', () => {
      throw new Error('codec.renderSqlLiteral should not be invoked for function-form');
    });
    const column = buildSingleColumnContract(
      fieldNode(
        'createdAt',
        'created_at',
        'pg/timestamptz@1',
        'timestamptz',
        { kind: 'expression', expression: 'now()' },
        false,
      ),
      codecLookupFor(codec),
    );
    expect(column?.default).toEqual({ kind: 'expression', expression: 'now()' });
    expect(codec.renderSqlLiteral).not.toHaveBeenCalled();
  });

  it('renders null on a nullable column to expression NULL; codec is not invoked', () => {
    const codec = spyCodec('pg/text@1', () => {
      throw new Error('codec.renderSqlLiteral should not be invoked for null literal');
    });
    const column = buildSingleColumnContract(
      fieldNode(
        'nickname',
        'nickname',
        'pg/text@1',
        'text',
        { kind: 'codecValue', value: null },
        true,
      ),
      codecLookupFor(codec),
    );
    expect(column?.default).toEqual({ kind: 'expression', expression: 'NULL' });
    expect(codec.renderSqlLiteral).not.toHaveBeenCalled();
  });

  it('rejects null on a NOT NULL column with a diagnostic naming the column and codec id', () => {
    const codec = spyCodec('pg/text@1', () => {
      throw new Error('codec.renderSqlLiteral should not be invoked when diagnostic raises');
    });
    expect(() =>
      buildSingleColumnContract(
        fieldNode(
          'email',
          'email',
          'pg/text@1',
          'text',
          { kind: 'codecValue', value: null },
          false,
        ),
        codecLookupFor(codec),
      ),
    ).toThrowError(/probe\.email.*pg\/text@1/s);
    expect(codec.renderSqlLiteral).not.toHaveBeenCalled();
  });

  it('invokes codec.renderSqlLiteral for non-null literal values and stamps the rendered expression', () => {
    const codec = spyCodec('pg/text@1', (value) => `'${String(value).replace(/'/g, "''")}'`);
    const column = buildSingleColumnContract(
      fieldNode(
        'status',
        'status',
        'pg/text@1',
        'text',
        { kind: 'codecValue', value: 'draft' },
        false,
      ),
      codecLookupFor(codec),
    );
    expect(column?.default).toEqual({ kind: 'expression', expression: "'draft'" });
    expect(codec.renderSqlLiteral).toHaveBeenCalledExactlyOnceWith('draft');
  });

  it('throws when a literal default needs codec dispatch but no codec lookup is provided', () => {
    expect(() =>
      buildSingleColumnContract(
        fieldNode(
          'status',
          'status',
          'pg/text@1',
          'text',
          { kind: 'codecValue', value: 'draft' },
          false,
        ),
        // no codec lookup
      ),
    ).toThrowError(/pg\/text@1/);
  });

  it('throws when the codec lookup returns no codec for the column id', () => {
    expect(() =>
      buildSingleColumnContract(
        fieldNode(
          'status',
          'status',
          'pg/text@1',
          'text',
          { kind: 'codecValue', value: 'draft' },
          false,
        ),
        {
          get: () => undefined,
          targetTypesFor: () => undefined,
          metaFor: () => undefined,
          renderOutputTypeFor: () => undefined,
        },
      ),
    ).toThrowError(/pg\/text@1/);
  });

  it('passes Date literal values directly to codec.renderSqlLiteral without JSON round-trip', () => {
    const received: unknown[] = [];
    const codec = spyCodec('pg/timestamptz@1', (value) => {
      received.push(value);
      if (!(value instanceof Date)) {
        throw new Error('Expected codec to receive the Date instance directly');
      }
      return `'${value.toISOString()}'::timestamptz`;
    });
    const sample = new Date('2026-05-20T12:34:56.000Z');
    const column = buildSingleColumnContract(
      fieldNode(
        'scheduledAt',
        'scheduled_at',
        'pg/timestamptz@1',
        'timestamptz',
        { kind: 'codecValue', value: sample },
        false,
      ),
      codecLookupFor(codec),
    );
    expect(column?.default).toEqual({
      kind: 'expression',
      expression: "'2026-05-20T12:34:56.000Z'::timestamptz",
    });
    expect(received).toEqual([sample]);
  });

  it('passes bigint literal values directly to codec.renderSqlLiteral without JSON round-trip', () => {
    const codec = spyCodec('pg/int8@1', (value) => {
      if (typeof value !== 'bigint') {
        throw new Error('Expected codec to receive the bigint directly');
      }
      return `${value.toString()}::int8`;
    });
    const column = buildSingleColumnContract(
      fieldNode(
        'serial',
        'serial',
        'pg/int8@1',
        'int8',
        { kind: 'codecValue', value: 9007199254740993n },
        false,
      ),
      codecLookupFor(codec),
    );
    expect(column?.default).toEqual({
      kind: 'expression',
      expression: '9007199254740993::int8',
    });
  });

  it('passes Uint8Array literal values directly to codec.renderSqlLiteral without JSON round-trip', () => {
    const codec = spyCodec('pg/bytea@1', (value) => {
      if (!(value instanceof Uint8Array)) {
        throw new Error('Expected codec to receive the Uint8Array directly');
      }
      const hex = Array.from(value)
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
      return `'\\x${hex}'::bytea`;
    });
    const column = buildSingleColumnContract(
      fieldNode(
        'salt',
        'salt',
        'pg/bytea@1',
        'bytea',
        { kind: 'codecValue', value: new Uint8Array([0xde, 0xad, 0xbe, 0xef]) },
        false,
      ),
      codecLookupFor(codec),
    );
    expect(column?.default).toEqual({
      kind: 'expression',
      expression: "'\\xdeadbeef'::bytea",
    });
  });

  it('passes JSON object literal values to codec.renderSqlLiteral', () => {
    const codec = spyCodec(
      'pg/jsonb@1',
      (value) => `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`,
    );
    const column = buildSingleColumnContract(
      fieldNode(
        'meta',
        'meta',
        'pg/jsonb@1',
        'jsonb',
        { kind: 'codecValue', value: { plan: 'pro', seats: 10 } },
        false,
      ),
      codecLookupFor(codec),
    );
    expect(column?.default).toEqual({
      kind: 'expression',
      expression: `'${JSON.stringify({ plan: 'pro', seats: 10 })}'::jsonb`,
    });
  });
});

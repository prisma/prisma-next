import { ifDefined } from '@prisma-next/utils/defined';
import { describe, expect, it } from 'vitest';
import {
  createPostgresDefaultFunctionRegistry,
  createPostgresMutationDefaultGeneratorDescriptors,
  createPostgresScalarTypeDescriptors,
} from '../src/core/control-mutation-defaults';
import runtimeAdapterDescriptor from '../src/exports/runtime';

const stubSpan = {
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 0, line: 1, column: 1 },
} as const;

const stubContext = {
  sourceId: 'test.prisma',
  modelName: 'TestModel',
  fieldName: 'testField',
} as const;

function makeCall(fn: string, args: Record<string, unknown> = {}) {
  return { fn, span: stubSpan, args };
}

describe('createPostgresDefaultFunctionRegistry', () => {
  const registry = createPostgresDefaultFunctionRegistry();

  it('contains all builtin default function entries', () => {
    expect([...registry.keys()]).toEqual(
      expect.arrayContaining([
        'autoincrement',
        'now',
        'uuid',
        'cuid',
        'ulid',
        'nanoid',
        'dbgenerated',
      ]),
    );
  });

  it('lowers autoincrement() to a storage default', () => {
    const handler = registry.get('autoincrement')!;
    const result = handler.lower({ call: makeCall('autoincrement'), context: stubContext });
    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'storage', defaultValue: { kind: 'function', expression: 'autoincrement()' } },
    });
  });

  it('lowers now() to a storage default', () => {
    const handler = registry.get('now')!;
    const result = handler.lower({ call: makeCall('now'), context: stubContext });
    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'storage', defaultValue: { kind: 'function', expression: 'now()' } },
    });
  });

  it('lowers uuid() to uuidv4 execution generator', () => {
    const handler = registry.get('uuid')!;
    const result = handler.lower({ call: makeCall('uuid'), context: stubContext });
    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'execution', generated: { kind: 'generator', id: 'uuidv4' } },
    });
  });

  it('lowers uuid(7) to uuidv7 execution generator', () => {
    const handler = registry.get('uuid')!;
    const result = handler.lower({
      call: makeCall('uuid', { version: 7 }),
      context: stubContext,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'execution', generated: { kind: 'generator', id: 'uuidv7' } },
    });
  });

  it('lowers cuid(2) to cuid2 execution generator', () => {
    const handler = registry.get('cuid')!;
    const result = handler.lower({
      call: makeCall('cuid', { version: 2 }),
      context: stubContext,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'execution', generated: { kind: 'generator', id: 'cuid2' } },
    });
  });

  it('lowers ulid() to execution generator', () => {
    const handler = registry.get('ulid')!;
    const result = handler.lower({ call: makeCall('ulid'), context: stubContext });
    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'execution', generated: { kind: 'generator', id: 'ulid' } },
    });
  });

  it('lowers nanoid() to execution generator', () => {
    const handler = registry.get('nanoid')!;
    const result = handler.lower({ call: makeCall('nanoid'), context: stubContext });
    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'execution', generated: { kind: 'generator', id: 'nanoid' } },
    });
  });

  it('lowers nanoid(16) with size param', () => {
    const handler = registry.get('nanoid')!;
    const result = handler.lower({
      call: makeCall('nanoid', { size: 16 }),
      context: stubContext,
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        kind: 'execution',
        generated: { kind: 'generator', id: 'nanoid', params: { size: 16 } },
      },
    });
  });

  it('lowers dbgenerated("expr") to storage default', () => {
    const handler = registry.get('dbgenerated')!;
    const result = handler.lower({
      call: makeCall('dbgenerated', { expression: 'gen_random_uuid()' }),
      context: stubContext,
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        kind: 'storage',
        defaultValue: { kind: 'function', expression: 'gen_random_uuid()' },
      },
    });
  });

  it('rejects dbgenerated with empty string', () => {
    const handler = registry.get('dbgenerated')!;
    const result = handler.lower({
      call: makeCall('dbgenerated', { expression: '' }),
      context: stubContext,
    });
    expect(result).toMatchObject({ ok: false });
  });

  describe('dbgenerated resolves literal SQL text to a literal default', () => {
    const handler = createPostgresDefaultFunctionRegistry().get('dbgenerated')!;

    function lower(expression: string, nativeType?: string) {
      return handler.lower({
        call: makeCall('dbgenerated', { expression }),
        context: { ...stubContext, ...ifDefined('nativeType', nativeType) },
      });
    }

    it('resolves an empty jsonb literal to a literal object', () => {
      const result = lower("'{}'::jsonb", 'jsonb');
      expect(result).toMatchObject({
        ok: true,
        value: { kind: 'storage', defaultValue: { kind: 'literal', value: {} } },
      });
    });

    it('resolves a populated jsonb literal to a parsed literal object', () => {
      const result = lower(`'{"a":1}'::jsonb`, 'jsonb');
      expect(result).toMatchObject({
        ok: true,
        value: { kind: 'storage', defaultValue: { kind: 'literal', value: { a: 1 } } },
      });
    });

    it('resolves an empty text[] literal to a literal empty array', () => {
      const result = lower("'{}'::text[]", 'text[]');
      expect(result).toMatchObject({
        ok: true,
        value: { kind: 'storage', defaultValue: { kind: 'literal', value: [] } },
      });
    });

    it('resolves a populated integer[] literal to a literal array of numbers', () => {
      const result = lower("'{1,2,3}'::integer[]", 'int4[]');
      expect(result).toMatchObject({
        ok: true,
        value: { kind: 'storage', defaultValue: { kind: 'literal', value: [1, 2, 3] } },
      });
    });

    it('resolves NULL to a literal null', () => {
      const result = lower('NULL');
      expect(result).toMatchObject({
        ok: true,
        value: { kind: 'storage', defaultValue: { kind: 'literal', value: null } },
      });
    });

    it('resolves true/false to literal booleans', () => {
      expect(lower('true')).toMatchObject({
        ok: true,
        value: { kind: 'storage', defaultValue: { kind: 'literal', value: true } },
      });
      expect(lower('false')).toMatchObject({
        ok: true,
        value: { kind: 'storage', defaultValue: { kind: 'literal', value: false } },
      });
    });

    it('resolves a bare numeric literal to a literal number', () => {
      expect(lower('42')).toMatchObject({
        ok: true,
        value: { kind: 'storage', defaultValue: { kind: 'literal', value: 42 } },
      });
      expect(lower('3.14')).toMatchObject({
        ok: true,
        value: { kind: 'storage', defaultValue: { kind: 'literal', value: 3.14 } },
      });
    });

    it('resolves a plain quoted string to a literal string', () => {
      const result = lower("'hello'", 'text');
      expect(result).toMatchObject({
        ok: true,
        value: { kind: 'storage', defaultValue: { kind: 'literal', value: 'hello' } },
      });
    });

    it('keeps an out-of-safe-range bigint literal as its raw text, not a lossy number', () => {
      const result = lower("'99999999999999999'::int8", 'int8');
      expect(result).toMatchObject({
        ok: true,
        value: {
          kind: 'storage',
          defaultValue: { kind: 'literal', value: '99999999999999999' },
        },
      });
    });
  });

  describe('dbgenerated keeps genuine functions as functions (F13: guard against over-reach)', () => {
    const handler = createPostgresDefaultFunctionRegistry().get('dbgenerated')!;

    function lower(expression: string, nativeType?: string) {
      return handler.lower({
        call: makeCall('dbgenerated', { expression }),
        context: { ...stubContext, ...ifDefined('nativeType', nativeType) },
      });
    }

    it('keeps gen_random_uuid() a function', () => {
      const result = lower('gen_random_uuid()');
      expect(result).toMatchObject({
        ok: true,
        value: {
          kind: 'storage',
          defaultValue: { kind: 'function', expression: 'gen_random_uuid()' },
        },
      });
    });

    it('keeps a now()-plus-interval expression a function, unchanged', () => {
      const expression = "(now() + '00:03:00'::interval)";
      const result = lower(expression, 'timestamptz');
      expect(result).toMatchObject({
        ok: true,
        value: {
          kind: 'storage',
          defaultValue: { kind: 'function', expression },
        },
      });
    });

    it('keeps nextval(...) a function (normalized to autoincrement(), not demoted to a literal)', () => {
      const result = lower("nextval('seq'::regclass)", 'int4');
      expect(result).toMatchObject({
        ok: true,
        value: {
          kind: 'storage',
          defaultValue: { kind: 'function', expression: 'autoincrement()' },
        },
      });
    });

    it('keeps an enum-cast literal a function (unqualified cast type defeats the string-literal pattern)', () => {
      const expression = "'confidential'::auth.oauth_client_type";
      const result = lower(expression, 'oauth_client_type');
      expect(result).toMatchObject({
        ok: true,
        value: {
          kind: 'storage',
          defaultValue: { kind: 'function', expression },
        },
      });
    });
  });

  it('lowers uuid(4) explicitly to uuidv4 execution generator', () => {
    const handler = registry.get('uuid')!;
    const result = handler.lower({
      call: makeCall('uuid', { version: 4 }),
      context: stubContext,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'execution', generated: { kind: 'generator', id: 'uuidv4' } },
    });
  });
});

describe('createPostgresMutationDefaultGeneratorDescriptors', () => {
  const descriptors = createPostgresMutationDefaultGeneratorDescriptors();

  it('returns descriptors for all builtin generators', () => {
    const ids = descriptors.map((d) => d.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'ulid',
        'nanoid',
        'uuidv7',
        'uuidv4',
        'cuid2',
        'ksuid',
        'timestampNow',
      ]),
    );
  });

  it('omits applicableCodecIds for timestampNow (preset-only generator)', () => {
    const descriptor = descriptors.find((d) => d.id === 'timestampNow')!;

    // timestampNow is reachable only via temporal.{createdAt,updatedAt}()
    // preset descriptors that co-register the codec — the @default(...)
    // lowering compatibility check has no role to play here, so the
    // field is intentionally absent. F04 / spec NFR3 (corrected).
    expect(descriptor.applicableCodecIds).toBeUndefined();
  });

  it('resolves column descriptor for matching generator', () => {
    const uuidv4Descriptor = descriptors.find((d) => d.id === 'uuidv4')!;
    const resolve = uuidv4Descriptor.resolveGeneratedColumnDescriptor;
    expect(resolve).toBeDefined();
    const result = resolve!({
      generated: { kind: 'generator', id: 'uuidv4' },
    });
    expect(result).toMatchObject({
      codecId: 'sql/char@1',
      nativeType: 'character',
      typeParams: { length: 36 },
    });
  });

  it('returns undefined for non-matching generator', () => {
    const uuidv4Descriptor = descriptors.find((d) => d.id === 'uuidv4')!;
    const resolve = uuidv4Descriptor.resolveGeneratedColumnDescriptor;
    expect(resolve).toBeDefined();
    const result = resolve!({
      generated: { kind: 'generator', id: 'nanoid' },
    });
    expect(result).toBeUndefined();
  });
});

describe('postgres runtime mutation default generators', () => {
  it('provides timestampNow as a Date generator', () => {
    const generator = (runtimeAdapterDescriptor.mutationDefaultGenerators?.() ?? []).find(
      (entry) => entry.id === 'timestampNow',
    );

    expect(generator?.generate()).toBeInstanceOf(Date);
  });
});

describe('createPostgresScalarTypeDescriptors', () => {
  const descriptors = createPostgresScalarTypeDescriptors();

  it('maps all standard PSL scalar types', () => {
    expect([...descriptors.keys()]).toEqual(
      expect.arrayContaining([
        'String',
        'Boolean',
        'Int',
        'BigInt',
        'Float',
        'Decimal',
        'DateTime',
        'Json',
        'Bytes',
      ]),
    );
  });

  it('maps String to pg/text@1', () => {
    expect(descriptors.get('String')).toBe('pg/text@1');
  });
});

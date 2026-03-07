import { describe, expect, it } from 'vitest';
import {
  createPostgresDefaultFunctionRegistry,
  createPostgresMutationDefaultGeneratorDescriptors,
  createPostgresPslScalarTypeDescriptors,
} from '../src/core/control-mutation-defaults';

const stubContext = { sourceId: 'test.prisma' } as const;

function makeCall(name: string, args: Array<{ raw: string; span?: undefined }> = []) {
  return { name, args, span: undefined };
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
      call: makeCall('uuid', [{ raw: '7' }]),
      context: stubContext,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'execution', generated: { kind: 'generator', id: 'uuidv7' } },
    });
  });

  it('rejects cuid() without version', () => {
    const handler = registry.get('cuid')!;
    const result = handler.lower({ call: makeCall('cuid'), context: stubContext });
    expect(result).toMatchObject({ ok: false });
  });

  it('lowers cuid(2) to cuid2 execution generator', () => {
    const handler = registry.get('cuid')!;
    const result = handler.lower({
      call: makeCall('cuid', [{ raw: '2' }]),
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
      call: makeCall('nanoid', [{ raw: '16' }]),
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
      call: makeCall('dbgenerated', [{ raw: '"gen_random_uuid()"' }]),
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

  it('rejects dbgenerated() without argument', () => {
    const handler = registry.get('dbgenerated')!;
    const result = handler.lower({ call: makeCall('dbgenerated'), context: stubContext });
    expect(result).toMatchObject({ ok: false });
  });

  it('rejects dbgenerated with empty string', () => {
    const handler = registry.get('dbgenerated')!;
    const result = handler.lower({
      call: makeCall('dbgenerated', [{ raw: '""' }]),
      context: stubContext,
    });
    expect(result).toMatchObject({ ok: false });
  });

  it('rejects uuid with invalid version', () => {
    const handler = registry.get('uuid')!;
    const result = handler.lower({
      call: makeCall('uuid', [{ raw: '3' }]),
      context: stubContext,
    });
    expect(result).toMatchObject({ ok: false });
  });

  it('rejects uuid with too many arguments', () => {
    const handler = registry.get('uuid')!;
    const result = handler.lower({
      call: makeCall('uuid', [{ raw: '4' }, { raw: '7' }]),
      context: stubContext,
    });
    expect(result).toMatchObject({ ok: false });
  });

  it('rejects nanoid with out-of-range size', () => {
    const handler = registry.get('nanoid')!;
    const result = handler.lower({
      call: makeCall('nanoid', [{ raw: '1' }]),
      context: stubContext,
    });
    expect(result).toMatchObject({ ok: false });
  });

  it('rejects autoincrement with arguments', () => {
    const handler = registry.get('autoincrement')!;
    const result = handler.lower({
      call: makeCall('autoincrement', [{ raw: '1' }]),
      context: stubContext,
    });
    expect(result).toMatchObject({ ok: false });
  });

  it('rejects cuid with invalid version', () => {
    const handler = registry.get('cuid')!;
    const result = handler.lower({
      call: makeCall('cuid', [{ raw: '1' }]),
      context: stubContext,
    });
    expect(result).toMatchObject({ ok: false });
  });

  it('rejects cuid with too many arguments', () => {
    const handler = registry.get('cuid')!;
    const result = handler.lower({
      call: makeCall('cuid', [{ raw: '2' }, { raw: '3' }]),
      context: stubContext,
    });
    expect(result).toMatchObject({ ok: false });
  });

  it('rejects nanoid with too many arguments', () => {
    const handler = registry.get('nanoid')!;
    const result = handler.lower({
      call: makeCall('nanoid', [{ raw: '16' }, { raw: '32' }]),
      context: stubContext,
    });
    expect(result).toMatchObject({ ok: false });
  });

  it('rejects dbgenerated with non-string argument', () => {
    const handler = registry.get('dbgenerated')!;
    const result = handler.lower({
      call: makeCall('dbgenerated', [{ raw: 'notAString' }]),
      context: stubContext,
    });
    expect(result).toMatchObject({ ok: false });
  });
});

describe('createPostgresMutationDefaultGeneratorDescriptors', () => {
  const descriptors = createPostgresMutationDefaultGeneratorDescriptors();

  it('returns descriptors for all builtin generators', () => {
    const ids = descriptors.map((d) => d.id);
    expect(ids).toEqual(
      expect.arrayContaining(['ulid', 'nanoid', 'uuidv7', 'uuidv4', 'cuid2', 'ksuid']),
    );
  });

  it('resolves column descriptor for matching generator', () => {
    const uuidv4Descriptor = descriptors.find((d) => d.id === 'uuidv4')!;
    const result = uuidv4Descriptor.resolveGeneratedColumnDescriptor({
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
    const result = uuidv4Descriptor.resolveGeneratedColumnDescriptor({
      generated: { kind: 'generator', id: 'nanoid' },
    });
    expect(result).toBeUndefined();
  });
});

describe('createPostgresPslScalarTypeDescriptors', () => {
  const descriptors = createPostgresPslScalarTypeDescriptors();

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
    expect(descriptors.get('String')).toEqual({
      codecId: 'pg/text@1',
      nativeType: 'text',
    });
  });
});

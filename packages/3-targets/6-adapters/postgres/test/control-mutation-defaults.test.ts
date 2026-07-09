import type { AuthoringTypeNamespace } from '@prisma-next/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { createPostgresBuiltinCodecLookup } from '../src/core/codec-lookup';
import {
  createPostgresDefaultFunctionRegistry,
  createPostgresMutationDefaultGeneratorDescriptors,
  postgresScalarAuthoringTypes,
} from '../src/core/control-mutation-defaults';
import postgresAdapterDescriptor from '../src/exports/control';
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

function makeCall(name: string, args: Array<{ raw: string; span: typeof stubSpan }> = []) {
  return { name, raw: `${name}(${args.map((a) => a.raw).join(', ')})`, args, span: stubSpan };
}

function arg(raw: string) {
  return { raw, span: stubSpan };
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
      call: makeCall('uuid', [arg('7')]),
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
      call: makeCall('cuid', [arg('2')]),
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
      call: makeCall('nanoid', [arg('16')]),
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
      call: makeCall('dbgenerated', [arg('"gen_random_uuid()"')]),
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
      call: makeCall('dbgenerated', [arg('""')]),
      context: stubContext,
    });
    expect(result).toMatchObject({ ok: false });
  });

  it('rejects uuid with invalid version', () => {
    const handler = registry.get('uuid')!;
    const result = handler.lower({
      call: makeCall('uuid', [arg('3')]),
      context: stubContext,
    });
    expect(result).toMatchObject({ ok: false });
  });

  it('rejects uuid with too many arguments', () => {
    const handler = registry.get('uuid')!;
    const result = handler.lower({
      call: makeCall('uuid', [arg('4'), arg('7')]),
      context: stubContext,
    });
    expect(result).toMatchObject({ ok: false });
  });

  it('rejects nanoid with out-of-range size', () => {
    const handler = registry.get('nanoid')!;
    const result = handler.lower({
      call: makeCall('nanoid', [arg('1')]),
      context: stubContext,
    });
    expect(result).toMatchObject({ ok: false });
  });

  it('rejects autoincrement with arguments', () => {
    const handler = registry.get('autoincrement')!;
    const result = handler.lower({
      call: makeCall('autoincrement', [arg('1')]),
      context: stubContext,
    });
    expect(result).toMatchObject({ ok: false });
  });

  it('rejects cuid with invalid version', () => {
    const handler = registry.get('cuid')!;
    const result = handler.lower({
      call: makeCall('cuid', [arg('1')]),
      context: stubContext,
    });
    expect(result).toMatchObject({ ok: false });
  });

  it('rejects cuid with too many arguments', () => {
    const handler = registry.get('cuid')!;
    const result = handler.lower({
      call: makeCall('cuid', [arg('2'), arg('3')]),
      context: stubContext,
    });
    expect(result).toMatchObject({ ok: false });
  });

  it('rejects nanoid with too many arguments', () => {
    const handler = registry.get('nanoid')!;
    const result = handler.lower({
      call: makeCall('nanoid', [arg('16'), arg('32')]),
      context: stubContext,
    });
    expect(result).toMatchObject({ ok: false });
  });

  it('rejects dbgenerated with non-string argument', () => {
    const handler = registry.get('dbgenerated')!;
    const result = handler.lower({
      call: makeCall('dbgenerated', [arg('notAString')]),
      context: stubContext,
    });
    expect(result).toMatchObject({ ok: false });
  });

  it('rejects now() with arguments', () => {
    const handler = registry.get('now')!;
    const result = handler.lower({
      call: makeCall('now', [arg('1')]),
      context: stubContext,
    });
    expect(result).toMatchObject({ ok: false });
  });

  it('rejects ulid() with arguments', () => {
    const handler = registry.get('ulid')!;
    const result = handler.lower({
      call: makeCall('ulid', [arg('1')]),
      context: stubContext,
    });
    expect(result).toMatchObject({ ok: false });
  });

  it('lowers uuid(4) explicitly to uuidv4 execution generator', () => {
    const handler = registry.get('uuid')!;
    const result = handler.lower({
      call: makeCall('uuid', [arg('4')]),
      context: stubContext,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'execution', generated: { kind: 'generator', id: 'uuidv4' } },
    });
  });

  it('rejects uuid with non-numeric version literal', () => {
    const handler = registry.get('uuid')!;
    const result = handler.lower({
      call: makeCall('uuid', [arg('foo')]),
      context: stubContext,
    });
    expect(result).toMatchObject({ ok: false });
  });

  it('rejects nanoid with non-integer size literal', () => {
    const handler = registry.get('nanoid')!;
    const result = handler.lower({
      call: makeCall('nanoid', [arg('"sixteen"')]),
      context: stubContext,
    });
    expect(result).toMatchObject({ ok: false });
  });

  // The arg-rejection diagnostics use `input.call.args[0]?.span ?? input.call.span`
  // so a missing arg-side span falls back to the call-side span. Pin the
  // fallback path for each lowerer that has it so the per-file branch
  // coverage stays above 87%. We construct a "spanless" arg by deleting
  // the property after construction — TypeScript otherwise enforces
  // `span` as required.
  function spanlessArg(raw: string) {
    const a: { raw: string; span?: typeof stubSpan } = { raw, span: stubSpan };
    delete a.span;
    return a as { raw: string; span: typeof stubSpan };
  }

  it("uuid: invalid-version diagnostic falls back to the call's span when the arg lacks one", () => {
    const handler = registry.get('uuid')!;
    const result = handler.lower({
      call: makeCall('uuid', [spanlessArg('5')]),
      context: stubContext,
    });
    expect(result).toMatchObject({ ok: false, diagnostic: { span: stubSpan } });
  });

  it("cuid: invalid-version diagnostic falls back to the call's span when the arg lacks one", () => {
    const handler = registry.get('cuid')!;
    const result = handler.lower({
      call: makeCall('cuid', [spanlessArg('3')]),
      context: stubContext,
    });
    expect(result).toMatchObject({ ok: false, diagnostic: { span: stubSpan } });
  });

  it("nanoid: out-of-range diagnostic falls back to the call's span when the arg lacks one", () => {
    const handler = registry.get('nanoid')!;
    const result = handler.lower({
      call: makeCall('nanoid', [spanlessArg('1')]),
      context: stubContext,
    });
    expect(result).toMatchObject({ ok: false, diagnostic: { span: stubSpan } });
  });

  it("dbgenerated: non-string-literal diagnostic falls back to the call's span when the arg lacks one", () => {
    const handler = registry.get('dbgenerated')!;
    const result = handler.lower({
      call: makeCall('dbgenerated', [spanlessArg('NOW()')]),
      context: stubContext,
    });
    expect(result).toMatchObject({ ok: false, diagnostic: { span: stubSpan } });
  });

  it("dbgenerated: empty-string diagnostic falls back to the call's span when the arg lacks one", () => {
    const handler = registry.get('dbgenerated')!;
    const result = handler.lower({
      call: makeCall('dbgenerated', [spanlessArg('"   "')]),
      context: stubContext,
    });
    expect(result).toMatchObject({ ok: false, diagnostic: { span: stubSpan } });
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

describe('postgresScalarAuthoringTypes', () => {
  const codecLookup = createPostgresBuiltinCodecLookup();
  const namespace: AuthoringTypeNamespace = postgresScalarAuthoringTypes;

  // The legacy scalar-type map channel (name-to-codecId, retired in TML-2985) is gone; the pinned
  // name → codecId pairs below carry the retired map's claims forward.
  const expectedScalars = [
    ['String', 'pg/text@1'],
    ['Boolean', 'pg/bool@1'],
    ['Int', 'pg/int4@1'],
    ['BigInt', 'pg/int8@1'],
    ['Float', 'pg/float8@1'],
    ['Decimal', 'pg/numeric@1'],
    ['DateTime', 'pg/timestamptz@1'],
    ['Json', 'pg/jsonb@1'],
    ['Bytes', 'pg/bytea@1'],
  ] as const;

  it('pins every base scalar as a zero-arg type constructor with manifest-derived nativeType', () => {
    expect(Object.keys(namespace).sort()).toEqual(expectedScalars.map(([name]) => name).sort());
    for (const [name, codecId] of expectedScalars) {
      expect(namespace[name]).toEqual({
        kind: 'typeConstructor',
        output: { codecId, nativeType: codecLookup.targetTypesFor(codecId)?.[0] },
      });
    }
  });

  it('is wired as the adapter descriptor authoring type contribution', () => {
    expect(postgresAdapterDescriptor.authoring?.type).toBe(postgresScalarAuthoringTypes);
  });
});

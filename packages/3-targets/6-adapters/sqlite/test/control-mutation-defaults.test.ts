import { describe, expect, it } from 'vitest';
import {
  createSqliteDefaultFunctionRegistry,
  createSqliteMutationDefaultGeneratorDescriptors,
} from '../src/core/control-mutation-defaults';
import runtimeAdapterDescriptor from '../src/core/runtime-adapter';

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

describe('createSqliteDefaultFunctionRegistry — dbgenerated canonicalization', () => {
  const registry = createSqliteDefaultFunctionRegistry();
  const dbgenerated = registry.get('dbgenerated');
  if (!dbgenerated) throw new Error('expected `dbgenerated` registry entry');

  // Symmetric with `parseSqliteDefault` on the introspection side: SQLite's
  // synonyms for "current wall-clock time" all canonicalize to `now()` so
  // the verifier compares canonical-vs-canonical and a contract using
  // `dbgenerated("CURRENT_TIMESTAMP")` doesn't drift against the schema it
  // just produced.
  it('canonicalizes dbgenerated("CURRENT_TIMESTAMP") to { function "now()" }', () => {
    const result = dbgenerated.lower({
      call: makeCall('dbgenerated', { expression: 'CURRENT_TIMESTAMP' }),
      context: stubContext,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'storage', defaultValue: { kind: 'function', expression: 'now()' } },
    });
  });

  it('canonicalizes dbgenerated("current_timestamp") (lowercase) to { function "now()" }', () => {
    const result = dbgenerated.lower({
      call: makeCall('dbgenerated', { expression: 'current_timestamp' }),
      context: stubContext,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'storage', defaultValue: { kind: 'function', expression: 'now()' } },
    });
  });

  it('canonicalizes dbgenerated("datetime(\'now\')") to { function "now()" }', () => {
    const result = dbgenerated.lower({
      call: makeCall('dbgenerated', { expression: "datetime('now')" }),
      context: stubContext,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'storage', defaultValue: { kind: 'function', expression: 'now()' } },
    });
  });

  it('preserves unknown expressions verbatim', () => {
    const result = dbgenerated.lower({
      call: makeCall('dbgenerated', { expression: 'random()' }),
      context: stubContext,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'storage', defaultValue: { kind: 'function', expression: 'random()' } },
    });
  });
});

describe('createSqliteMutationDefaultGeneratorDescriptors', () => {
  const descriptors = createSqliteMutationDefaultGeneratorDescriptors();

  it('includes timestampNow without applicableCodecIds (preset-only generator)', () => {
    const descriptor = descriptors.find((d) => d.id === 'timestampNow');

    // timestampNow ships only through the temporal.{createdAt,updatedAt}()
    // preset path; the codec is co-registered there, so the
    // @default(...) compatibility list is intentionally absent.
    expect(descriptor).toBeDefined();
    expect(descriptor?.applicableCodecIds).toBeUndefined();
  });
});

describe('sqlite runtime mutation default generators', () => {
  it('provides timestampNow as a Date generator', () => {
    const generator = (runtimeAdapterDescriptor.mutationDefaultGenerators?.() ?? []).find(
      (entry) => entry.id === 'timestampNow',
    );

    expect(generator?.generate()).toBeInstanceOf(Date);
  });
});

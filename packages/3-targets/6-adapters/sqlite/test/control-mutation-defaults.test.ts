import { describe, expect, it } from 'vitest';
import { createSqliteDefaultFunctionRegistry } from '../src/core/control-mutation-defaults';

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
      call: makeCall('dbgenerated', [arg('"CURRENT_TIMESTAMP"')]),
      context: stubContext,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'storage', defaultValue: { kind: 'function', expression: 'now()' } },
    });
  });

  it('canonicalizes dbgenerated("current_timestamp") (lowercase) to { function "now()" }', () => {
    const result = dbgenerated.lower({
      call: makeCall('dbgenerated', [arg('"current_timestamp"')]),
      context: stubContext,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'storage', defaultValue: { kind: 'function', expression: 'now()' } },
    });
  });

  it('canonicalizes dbgenerated("datetime(\'now\')") to { function "now()" }', () => {
    const result = dbgenerated.lower({
      call: makeCall('dbgenerated', [arg('"datetime(\'now\')"')]),
      context: stubContext,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'storage', defaultValue: { kind: 'function', expression: 'now()' } },
    });
  });

  it('preserves unknown expressions verbatim', () => {
    const result = dbgenerated.lower({
      call: makeCall('dbgenerated', [arg('"random()"')]),
      context: stubContext,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'storage', defaultValue: { kind: 'function', expression: 'random()' } },
    });
  });
});

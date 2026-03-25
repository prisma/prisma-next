import { describe, expect, it } from 'vitest';
import { mapDefault } from '../src/default-mapping';
import { createPostgresDefaultMapping } from '../src/postgres-default-mapping';

describe('mapDefault', () => {
  it('maps autoincrement()', () => {
    expect(mapDefault({ kind: 'function', expression: 'autoincrement()' })).toEqual({
      attribute: '@default(autoincrement())',
    });
  });

  it('maps now()', () => {
    expect(mapDefault({ kind: 'function', expression: 'now()' })).toEqual({
      attribute: '@default(now())',
    });
  });

  it('maps gen_random_uuid() when Postgres mapping is injected', () => {
    expect(
      mapDefault(
        { kind: 'function', expression: 'gen_random_uuid()' },
        createPostgresDefaultMapping(),
      ),
    ).toEqual({
      attribute: '@default(dbgenerated("gen_random_uuid()"))',
    });
  });

  it('maps boolean true', () => {
    expect(mapDefault({ kind: 'literal', value: true })).toEqual({
      attribute: '@default(true)',
    });
  });

  it('maps boolean false', () => {
    expect(mapDefault({ kind: 'literal', value: false })).toEqual({
      attribute: '@default(false)',
    });
  });

  it('maps number', () => {
    expect(mapDefault({ kind: 'literal', value: 42 })).toEqual({
      attribute: '@default(42)',
    });
  });

  it('maps bigint', () => {
    expect(mapDefault({ kind: 'literal', value: 42n })).toEqual({
      attribute: '@default(42)',
    });
  });

  it('maps string', () => {
    expect(mapDefault({ kind: 'literal', value: 'hello' })).toEqual({
      attribute: '@default("hello")',
    });
  });

  it('maps string with quotes', () => {
    expect(mapDefault({ kind: 'literal', value: 'he said "hi"' })).toEqual({
      attribute: '@default("he said \\"hi\\"")',
    });
  });

  it('escapes control characters in string defaults', () => {
    expect(mapDefault({ kind: 'literal', value: 'line 1\nline 2\t"quoted"' })).toEqual({
      attribute: '@default("line 1\\nline 2\\t\\"quoted\\"")',
    });
  });

  it('unrecognized function becomes comment', () => {
    expect(mapDefault({ kind: 'function', expression: 'custom_func()' })).toEqual({
      comment: '// Raw default: custom_func()',
    });
  });

  it('treats Postgres-specific functions as raw defaults without injected mapping', () => {
    expect(mapDefault({ kind: 'function', expression: 'gen_random_uuid()' })).toEqual({
      comment: '// Raw default: gen_random_uuid()',
    });
  });

  it('maps null literal', () => {
    expect(mapDefault({ kind: 'literal', value: null })).toEqual({
      attribute: '@default(null)',
    });
  });

  it('maps tagged bigint', () => {
    expect(
      mapDefault({ kind: 'literal', value: { $type: 'bigint', value: '9007199254740993' } }),
    ).toEqual({
      attribute: '@default(9007199254740993)',
    });
  });

  it('stringifies unsupported literal defaults', () => {
    expect(mapDefault({ kind: 'literal', value: { nested: ['value'] } })).toEqual({
      attribute: '@default("{\\"nested\\":[\\"value\\"]}")',
    });
  });
});

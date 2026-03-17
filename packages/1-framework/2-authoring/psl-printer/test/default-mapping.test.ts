import { describe, expect, it } from 'vitest';
import { mapDefault } from '../src/default-mapping';

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

  it('maps gen_random_uuid() to uuid()', () => {
    expect(mapDefault({ kind: 'function', expression: 'gen_random_uuid()' })).toEqual({
      attribute: '@default(uuid())',
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

  it('unrecognized function becomes comment', () => {
    expect(mapDefault({ kind: 'function', expression: 'custom_func()' })).toEqual({
      comment: '// Raw default: custom_func()',
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
});

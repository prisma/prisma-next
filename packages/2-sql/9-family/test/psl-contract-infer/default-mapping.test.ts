import { describe, expect, it } from 'vitest';
import { mapDefault } from '../../src/core/psl-contract-infer/default-mapping';
import { createPostgresDefaultMapping } from '../../src/core/psl-contract-infer/postgres-default-mapping';

describe('mapDefault', () => {
  it('maps autoincrement', () => {
    expect(mapDefault({ kind: 'autoincrement' })).toEqual({
      attribute: '@default(autoincrement())',
    });
  });

  it('maps now()', () => {
    expect(mapDefault({ kind: 'expression', expression: 'now()' })).toEqual({
      attribute: '@default(now())',
    });
  });

  it('maps gen_random_uuid() when Postgres mapping is injected', () => {
    expect(
      mapDefault(
        { kind: 'expression', expression: 'gen_random_uuid()' },
        createPostgresDefaultMapping(),
      ),
    ).toEqual({
      attribute: '@default(dbgenerated("gen_random_uuid()"))',
    });
  });

  it('maps unmapped Postgres defaults to dbgenerated when Postgres mapping is injected', () => {
    expect(
      mapDefault({ kind: 'expression', expression: "'{}'::jsonb" }, createPostgresDefaultMapping()),
    ).toEqual({
      attribute: `@default(dbgenerated(${JSON.stringify("'{}'::jsonb")}))`,
    });
  });

  it('maps boolean true expression', () => {
    expect(mapDefault({ kind: 'expression', expression: 'true' })).toEqual({
      comment: '// Raw default: true',
    });
  });

  it('maps boolean false expression', () => {
    expect(mapDefault({ kind: 'expression', expression: 'false' })).toEqual({
      comment: '// Raw default: false',
    });
  });

  it('maps number expression', () => {
    expect(mapDefault({ kind: 'expression', expression: '42' })).toEqual({
      comment: '// Raw default: 42',
    });
  });

  it('maps string expression', () => {
    expect(mapDefault({ kind: 'expression', expression: 'hello' })).toEqual({
      comment: '// Raw default: hello',
    });
  });

  it('unrecognized function becomes comment', () => {
    expect(mapDefault({ kind: 'expression', expression: 'custom_func()' })).toEqual({
      comment: '// Raw default: custom_func()',
    });
  });

  it('treats Postgres-specific functions as raw defaults without injected mapping', () => {
    expect(mapDefault({ kind: 'expression', expression: 'gen_random_uuid()' })).toEqual({
      comment: '// Raw default: gen_random_uuid()',
    });
  });

  it('maps NULL expression', () => {
    expect(mapDefault({ kind: 'expression', expression: 'NULL' })).toEqual({
      comment: '// Raw default: NULL',
    });
  });

  it('maps large number expression', () => {
    expect(mapDefault({ kind: 'expression', expression: '9007199254740991' })).toEqual({
      comment: '// Raw default: 9007199254740991',
    });
  });
});

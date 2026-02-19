import { describe, expect, it } from 'vitest';
import { transformKyselyToPnAst } from '../src/transform/transform';
import { compileQuery, compilerDb, contract } from './transform.fixtures';

describe('transformKyselyToPnAst — paramDescriptors', () => {
  it('includes codecId and nativeType when contract has column metadata', () => {
    const compiled = compileQuery(
      compilerDb.selectFrom('user').selectAll().where('id', '=', 'uid'),
    );

    const result = transformKyselyToPnAst(contract, compiled.query, compiled.parameters);
    const descriptor = result.metaAdditions.paramDescriptors[0];

    expect(descriptor).toBeDefined();
    expect(descriptor?.refs).toEqual({ table: 'user', column: 'id' });
    expect(descriptor?.codecId).toBeDefined();
    expect(descriptor?.nativeType).toBeDefined();
  });
});

describe('transformKyselyToPnAst — param indexing', () => {
  it('keeps descriptor order aligned with compiled parameter order', () => {
    const compiled = compileQuery(
      compilerDb
        .selectFrom('user')
        .select(['id', 'email'])
        .where((eb) =>
          eb.and([
            eb('id', '=', 'first'),
            eb('email', 'like', 'second'),
            eb('id', 'in', ['third', 'fourth']),
          ]),
        ),
    );

    const result = transformKyselyToPnAst(contract, compiled.query, compiled.parameters);
    const descriptors = result.metaAdditions.paramDescriptors;

    expect(descriptors).toHaveLength(4);
    expect(descriptors.map((descriptor) => descriptor.index)).toEqual([1, 2, 3, 4]);
    expect(descriptors.map((descriptor) => descriptor.source)).toEqual([
      'lane',
      'lane',
      'lane',
      'lane',
    ]);
    expect(descriptors.map((descriptor) => descriptor.refs)).toEqual([
      { table: 'user', column: 'id' },
      { table: 'user', column: 'email' },
      { table: 'user', column: 'id' },
      { table: 'user', column: 'id' },
    ]);
  });
});

describe('transformKyselyToPnAst — ref extraction', () => {
  it('populates meta.refs.tables and meta.refs.columns from transformed ast', () => {
    const compiled = compileQuery(compilerDb.selectFrom('user').selectAll().where('id', '=', 'u1'));

    const result = transformKyselyToPnAst(contract, compiled.query, compiled.parameters);

    expect(result.metaAdditions.refs.tables).toContain('user');
    expect(result.metaAdditions.refs.columns).toContainEqual({
      table: 'user',
      column: 'id',
    });
  });
});

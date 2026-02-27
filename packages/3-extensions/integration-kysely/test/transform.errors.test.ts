import { describe, expect, it } from 'vitest';
import { KYSELY_TRANSFORM_ERROR_CODES, KyselyTransformError } from '../src/transform/errors';
import { transformKyselyToPnAst } from '../src/transform/transform';
import { compileQuery, compilerDb, contract } from './transform.fixtures';

function cloneQuery<T>(query: T): T {
  return JSON.parse(JSON.stringify(query)) as T;
}

describe('transformKyselyToPnAst — unsupported nodes', () => {
  it('throws on unknown query kind', () => {
    expect(() => transformKyselyToPnAst(contract, { kind: 'UnknownNode' }, [])).toThrow(
      KyselyTransformError,
    );

    try {
      transformKyselyToPnAst(contract, { kind: 'UnknownNode' }, []);
    } catch (error) {
      expect((error as KyselyTransformError).code).toBe(
        KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE,
      );
    }
  });

  it('throws on SubQueryNode as root', () => {
    expect(() => transformKyselyToPnAst(contract, { kind: 'SubQueryNode', query: {} }, [])).toThrow(
      KyselyTransformError,
    );

    try {
      transformKyselyToPnAst(contract, { kind: 'SubQueryNode', query: {} }, []);
    } catch (error) {
      expect((error as KyselyTransformError).code).toBe(
        KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE,
      );
    }
  });

  it('throws on non-string operator payload', () => {
    const compiled = compileQuery(compilerDb.selectFrom('user').selectAll().where('id', '=', 'x'));
    const malformed = cloneQuery(compiled.query) as unknown as {
      where?: { where?: { operator?: { operator?: unknown } } };
    };
    if (malformed.where?.where?.operator) {
      malformed.where.where.operator.operator = { value: '=' };
    }

    expect(() => transformKyselyToPnAst(contract, malformed, compiled.parameters)).toThrow(
      KyselyTransformError,
    );
    try {
      transformKyselyToPnAst(contract, malformed, compiled.parameters);
    } catch (error) {
      expect((error as KyselyTransformError).code).toBe(
        KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE,
      );
    }
  });
});

describe('transformKyselyToPnAst — defensive throws on ambiguous/invalid shapes', () => {
  it('throws on unqualified column ref in multi-table scope', () => {
    const compiled = compileQuery(
      compilerDb.selectFrom('user as u').leftJoin('post as p', 'u.id', 'p.userId').select(['u.id']),
    );
    const malformed = cloneQuery(compiled.query) as unknown as {
      selections: Array<{ selection: { table?: unknown } }>;
    };
    delete malformed.selections[0]?.selection.table;

    expect(() => transformKyselyToPnAst(contract, malformed, compiled.parameters)).toThrow(
      KyselyTransformError,
    );
    try {
      transformKyselyToPnAst(contract, malformed, compiled.parameters);
    } catch (error) {
      expect((error as KyselyTransformError).code).toBe(
        KYSELY_TRANSFORM_ERROR_CODES.UNQUALIFIED_REF_IN_MULTI_TABLE,
      );
    }
  });

  it('throws on ambiguous selectAll in multi-table scope', () => {
    const compiled = compileQuery(
      compilerDb.selectFrom('user as u').leftJoin('post as p', 'u.id', 'p.userId').selectAll(),
    );

    expect(() => transformKyselyToPnAst(contract, compiled.query, compiled.parameters)).toThrow(
      KyselyTransformError,
    );
    try {
      transformKyselyToPnAst(contract, compiled.query, compiled.parameters);
    } catch (error) {
      expect((error as KyselyTransformError).code).toBe(
        KYSELY_TRANSFORM_ERROR_CODES.AMBIGUOUS_SELECT_ALL,
      );
    }
  });
});

describe('transformKyselyToPnAst — contract validation', () => {
  it('throws on unknown table', () => {
    const compiled = compileQuery(compilerDb.selectFrom('user').selectAll());
    const malformed = cloneQuery(compiled.query) as unknown as {
      from?: { froms?: Array<{ table?: { identifier?: { name?: string } } }> };
    };
    const tableIdentifier = malformed.from?.froms?.[0]?.table?.identifier;
    if (tableIdentifier) {
      tableIdentifier.name = 'nonexistent_table';
    }

    expect(() => transformKyselyToPnAst(contract, malformed, compiled.parameters)).toThrow(
      KyselyTransformError,
    );

    try {
      transformKyselyToPnAst(contract, malformed, compiled.parameters);
    } catch (error) {
      expect((error as KyselyTransformError).code).toBe(KYSELY_TRANSFORM_ERROR_CODES.INVALID_REF);
      expect((error as KyselyTransformError).details?.table).toBe('nonexistent_table');
    }
  });

  it('throws on unknown column in where', () => {
    const compiled = compileQuery(compilerDb.selectFrom('user').selectAll().where('id', '=', 'x'));
    const malformed = cloneQuery(compiled.query) as unknown as {
      where?: { where?: { leftOperand?: { column?: { column?: { name?: string } } } } };
    };
    const columnIdentifier = malformed.where?.where?.leftOperand?.column?.column;
    if (columnIdentifier) {
      columnIdentifier.name = 'nonexistent_col';
    }

    expect(() => transformKyselyToPnAst(contract, malformed, compiled.parameters)).toThrow(
      KyselyTransformError,
    );

    try {
      transformKyselyToPnAst(contract, malformed, compiled.parameters);
    } catch (error) {
      expect((error as KyselyTransformError).code).toBe(KYSELY_TRANSFORM_ERROR_CODES.INVALID_REF);
    }
  });
});

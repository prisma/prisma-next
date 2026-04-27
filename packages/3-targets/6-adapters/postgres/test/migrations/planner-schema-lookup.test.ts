import type { ForeignKey } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import {
  buildSchemaLookupMap,
  hasForeignKey,
  hasIndex,
  hasUniqueConstraint,
} from '@prisma-next/target-postgres/planner-schema-lookup';
import { describe, expect, it } from 'vitest';

function makeTable(
  overrides: Partial<SqlSchemaIR['tables'][string]> = {},
): SqlSchemaIR['tables'][string] {
  return {
    name: 'test',
    columns: {},
    foreignKeys: [],
    uniques: [],
    indexes: [],
    ...overrides,
  };
}

describe('buildSchemaLookupMap', () => {
  it('creates a lookup entry for each table', () => {
    const schema: SqlSchemaIR = {
      tables: {
        user: makeTable({ name: 'user' }),
        post: makeTable({ name: 'post' }),
      },
      dependencies: [],
    };
    const map = buildSchemaLookupMap(schema);
    expect(map.size).toBe(2);
    expect(map.has('user')).toBe(true);
    expect(map.has('post')).toBe(true);
  });

  it('populates uniqueKeys from uniques', () => {
    const schema: SqlSchemaIR = {
      tables: {
        user: makeTable({
          uniques: [{ columns: ['email'] }, { columns: ['tenant', 'slug'] }],
        }),
      },
      dependencies: [],
    };
    const lookup = buildSchemaLookupMap(schema).get('user')!;
    expect(lookup.uniqueKeys.has('email')).toBe(true);
    expect(lookup.uniqueKeys.has('tenant,slug')).toBe(true);
  });

  it('populates indexKeys and uniqueIndexKeys from indexes', () => {
    const schema: SqlSchemaIR = {
      tables: {
        user: makeTable({
          indexes: [
            { columns: ['created_at'], unique: false },
            { columns: ['email'], unique: true },
          ],
        }),
      },
      dependencies: [],
    };
    const lookup = buildSchemaLookupMap(schema).get('user')!;
    expect(lookup.indexKeys.has('created_at')).toBe(true);
    expect(lookup.indexKeys.has('email')).toBe(true);
    expect(lookup.uniqueIndexKeys.has('email')).toBe(true);
    expect(lookup.uniqueIndexKeys.has('created_at')).toBe(false);
  });

  it('populates fkKeys with pipe-delimited encoding', () => {
    const schema: SqlSchemaIR = {
      tables: {
        post: makeTable({
          foreignKeys: [
            { columns: ['author_id'], referencedTable: 'user', referencedColumns: ['id'] },
          ],
        }),
      },
      dependencies: [],
    };
    const lookup = buildSchemaLookupMap(schema).get('post')!;
    expect(lookup.fkKeys.has('author_id|user|id')).toBe(true);
  });
});

describe('hasUniqueConstraint', () => {
  const schema: SqlSchemaIR = {
    tables: {
      user: makeTable({
        uniques: [{ columns: ['email'] }],
        indexes: [{ columns: ['tenant', 'slug'], unique: true }],
      }),
    },
    dependencies: [],
  };
  const lookup = buildSchemaLookupMap(schema).get('user')!;

  it('matches a declared unique constraint', () => {
    expect(hasUniqueConstraint(lookup, ['email'])).toBe(true);
  });

  it('matches a unique index', () => {
    expect(hasUniqueConstraint(lookup, ['tenant', 'slug'])).toBe(true);
  });

  it('rejects non-matching columns', () => {
    expect(hasUniqueConstraint(lookup, ['name'])).toBe(false);
  });

  it('rejects subset of composite unique columns', () => {
    expect(hasUniqueConstraint(lookup, ['tenant'])).toBe(false);
  });
});

describe('hasIndex', () => {
  const schema: SqlSchemaIR = {
    tables: {
      user: makeTable({
        uniques: [{ columns: ['email'] }],
        indexes: [{ columns: ['created_at'], unique: false }],
      }),
    },
    dependencies: [],
  };
  const lookup = buildSchemaLookupMap(schema).get('user')!;

  it('matches a declared index', () => {
    expect(hasIndex(lookup, ['created_at'])).toBe(true);
  });

  it('matches a unique constraint used as an index', () => {
    expect(hasIndex(lookup, ['email'])).toBe(true);
  });

  it('rejects non-matching columns', () => {
    expect(hasIndex(lookup, ['name'])).toBe(false);
  });
});

describe('hasForeignKey', () => {
  const schema: SqlSchemaIR = {
    tables: {
      post: makeTable({
        foreignKeys: [
          { columns: ['author_id'], referencedTable: 'user', referencedColumns: ['id'] },
          {
            columns: ['org_id', 'team_id'],
            referencedTable: 'team',
            referencedColumns: ['org_id', 'id'],
          },
        ],
      }),
    },
    dependencies: [],
  };
  const lookup = buildSchemaLookupMap(schema).get('post')!;

  const fk = (
    overrides: Partial<ForeignKey> & Pick<ForeignKey, 'columns' | 'references'>,
  ): ForeignKey => ({
    constraint: true,
    index: true,
    ...overrides,
  });

  it('matches a single-column FK', () => {
    expect(
      hasForeignKey(
        lookup,
        fk({ columns: ['author_id'], references: { table: 'user', columns: ['id'] } }),
      ),
    ).toBe(true);
  });

  it('matches a composite FK', () => {
    expect(
      hasForeignKey(
        lookup,
        fk({
          columns: ['org_id', 'team_id'],
          references: { table: 'team', columns: ['org_id', 'id'] },
        }),
      ),
    ).toBe(true);
  });

  it('rejects when referenced table differs', () => {
    expect(
      hasForeignKey(
        lookup,
        fk({ columns: ['author_id'], references: { table: 'account', columns: ['id'] } }),
      ),
    ).toBe(false);
  });

  it('rejects when referenced columns differ', () => {
    expect(
      hasForeignKey(
        lookup,
        fk({ columns: ['author_id'], references: { table: 'user', columns: ['uid'] } }),
      ),
    ).toBe(false);
  });

  it('rejects when source columns differ', () => {
    expect(
      hasForeignKey(
        lookup,
        fk({ columns: ['user_id'], references: { table: 'user', columns: ['id'] } }),
      ),
    ).toBe(false);
  });
});

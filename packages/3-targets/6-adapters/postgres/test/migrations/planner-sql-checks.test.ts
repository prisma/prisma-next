import { describe, expect, it } from 'vitest';
import {
  buildExpectedFormatType,
  columnExistsCheck,
  columnHasNoDefaultCheck,
  columnNullabilityCheck,
  constraintExistsCheck,
  qualifyTableName,
  tableHasPrimaryKeyCheck,
  tableIsEmptyCheck,
  toRegclassLiteral,
} from '../../src/core/migrations/planner-sql-checks';

describe('qualifyTableName', () => {
  it('quotes schema and table', () => {
    expect(qualifyTableName('public', 'user')).toBe('"public"."user"');
  });
});

describe('toRegclassLiteral', () => {
  it('produces an escaped regclass literal', () => {
    expect(toRegclassLiteral('public', 'user')).toBe(`'"public"."user"'`);
  });
});

describe('constraintExistsCheck', () => {
  it('defaults to EXISTS', () => {
    const sql = constraintExistsCheck({ constraintName: 'user_pkey', schema: 'public' });
    expect(sql).toContain('SELECT EXISTS');
    expect(sql).toContain("c.conname = 'user_pkey'");
    expect(sql).toContain("n.nspname = 'public'");
  });

  it('uses NOT EXISTS when exists=false', () => {
    const sql = constraintExistsCheck({
      constraintName: 'user_pkey',
      schema: 'public',
      exists: false,
    });
    expect(sql).toContain('SELECT NOT EXISTS');
  });
});

describe('columnExistsCheck', () => {
  it('defaults to EXISTS', () => {
    const sql = columnExistsCheck({ schema: 'public', table: 'user', column: 'email' });
    expect(sql).toContain('SELECT EXISTS');
    expect(sql).toContain("table_schema = 'public'");
    expect(sql).toContain("table_name = 'user'");
    expect(sql).toContain("column_name = 'email'");
  });

  it('uses NOT EXISTS when exists=false', () => {
    const sql = columnExistsCheck({
      schema: 'public',
      table: 'user',
      column: 'email',
      exists: false,
    });
    expect(sql).toContain('SELECT NOT EXISTS');
  });
});

describe('columnNullabilityCheck', () => {
  it('checks for NOT NULL', () => {
    const sql = columnNullabilityCheck({
      schema: 'public',
      table: 'user',
      column: 'email',
      nullable: false,
    });
    expect(sql).toContain("is_nullable = 'NO'");
  });

  it('checks for nullable', () => {
    const sql = columnNullabilityCheck({
      schema: 'public',
      table: 'user',
      column: 'bio',
      nullable: true,
    });
    expect(sql).toContain("is_nullable = 'YES'");
  });
});

describe('tableIsEmptyCheck', () => {
  it('produces NOT EXISTS with LIMIT 1', () => {
    expect(tableIsEmptyCheck('"public"."user"')).toBe(
      'SELECT NOT EXISTS (SELECT 1 FROM "public"."user" LIMIT 1)',
    );
  });
});

describe('columnHasNoDefaultCheck', () => {
  it('checks column_default IS NOT NULL', () => {
    const sql = columnHasNoDefaultCheck({ schema: 'public', table: 'user', column: 'name' });
    expect(sql).toContain('SELECT NOT EXISTS');
    expect(sql).toContain('column_default IS NOT NULL');
    expect(sql).toContain("column_name = 'name'");
  });
});

describe('tableHasPrimaryKeyCheck', () => {
  it('checks PK exists without constraint name', () => {
    const sql = tableHasPrimaryKeyCheck('public', 'user', true);
    expect(sql).toContain('SELECT EXISTS');
    expect(sql).toContain("n.nspname = 'public'");
    expect(sql).toContain("c.relname = 'user'");
    expect(sql).toContain('i.indisprimary');
    expect(sql).not.toContain('c2.relname');
  });

  it('checks PK does not exist', () => {
    const sql = tableHasPrimaryKeyCheck('public', 'user', false);
    expect(sql).toContain('SELECT NOT EXISTS');
  });

  it('filters by constraint name when provided', () => {
    const sql = tableHasPrimaryKeyCheck('public', 'user', true, 'user_pkey');
    expect(sql).toContain("c2.relname = 'user_pkey'");
  });
});

describe('buildExpectedFormatType', () => {
  const noHooks = new Map();

  describe('FORMAT_TYPE_DISPLAY mappings', () => {
    it('maps int2 to smallint', () => {
      expect(
        buildExpectedFormatType(
          { nativeType: 'int2', codecId: 'pg/int2@1', nullable: false },
          noHooks,
        ),
      ).toBe('smallint');
    });

    it('maps int4 to integer', () => {
      expect(
        buildExpectedFormatType(
          { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
          noHooks,
        ),
      ).toBe('integer');
    });

    it('maps int8 to bigint', () => {
      expect(
        buildExpectedFormatType(
          { nativeType: 'int8', codecId: 'pg/int8@1', nullable: false },
          noHooks,
        ),
      ).toBe('bigint');
    });

    it('maps float4 to real', () => {
      expect(
        buildExpectedFormatType(
          { nativeType: 'float4', codecId: 'pg/float4@1', nullable: false },
          noHooks,
        ),
      ).toBe('real');
    });

    it('maps float8 to double precision', () => {
      expect(
        buildExpectedFormatType(
          { nativeType: 'float8', codecId: 'pg/float8@1', nullable: false },
          noHooks,
        ),
      ).toBe('double precision');
    });

    it('maps bool to boolean', () => {
      expect(
        buildExpectedFormatType(
          { nativeType: 'bool', codecId: 'pg/bool@1', nullable: false },
          noHooks,
        ),
      ).toBe('boolean');
    });
  });

  describe('unmapped native types pass through', () => {
    it('returns nativeType as-is for text', () => {
      expect(
        buildExpectedFormatType(
          { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
          noHooks,
        ),
      ).toBe('text');
    });

    it('returns nativeType as-is for uuid', () => {
      expect(
        buildExpectedFormatType(
          { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          noHooks,
        ),
      ).toBe('uuid');
    });
  });

  describe('user-defined types (typeRef path)', () => {
    it('returns simple lowercase UDT name unquoted', () => {
      expect(
        buildExpectedFormatType(
          { nativeType: 'my_status', codecId: 'pg/enum@1', nullable: false, typeRef: 'MyStatus' },
          noHooks,
        ),
      ).toBe('my_status');
    });

    it('quotes reserved word used as UDT name', () => {
      expect(
        buildExpectedFormatType(
          { nativeType: 'user', codecId: 'pg/enum@1', nullable: false, typeRef: 'User' },
          noHooks,
        ),
      ).toBe('"user"');
    });

    it('quotes another reserved word (select)', () => {
      expect(
        buildExpectedFormatType(
          { nativeType: 'select', codecId: 'pg/enum@1', nullable: false, typeRef: 'Select' },
          noHooks,
        ),
      ).toBe('"select"');
    });

    it('quotes mixed-case identifier', () => {
      expect(
        buildExpectedFormatType(
          {
            nativeType: 'OrderStatus',
            codecId: 'pg/enum@1',
            nullable: false,
            typeRef: 'OrderStatus',
          },
          noHooks,
        ),
      ).toBe('"OrderStatus"');
    });

    it('quotes identifier with hyphens', () => {
      expect(
        buildExpectedFormatType(
          {
            nativeType: 'order-status',
            codecId: 'pg/enum@1',
            nullable: false,
            typeRef: 'OrderStatus',
          },
          noHooks,
        ),
      ).toBe('"order-status"');
    });

    it('quotes identifier with spaces', () => {
      expect(
        buildExpectedFormatType(
          {
            nativeType: 'order status',
            codecId: 'pg/enum@1',
            nullable: false,
            typeRef: 'OrderStatus',
          },
          noHooks,
        ),
      ).toBe('"order status"');
    });

    it('quotes identifier starting with digit', () => {
      expect(
        buildExpectedFormatType(
          { nativeType: '2fa_type', codecId: 'pg/enum@1', nullable: false, typeRef: 'TwoFaType' },
          noHooks,
        ),
      ).toBe('"2fa_type"');
    });
  });

  describe('codec hook expansion', () => {
    it('delegates to expandNativeType when typeParams and codec hook exist', () => {
      const hooks = new Map([
        [
          'pg/decimal@1',
          {
            expandNativeType: ({
              nativeType,
              typeParams,
            }: {
              nativeType: string;
              typeParams?: Record<string, unknown>;
            }) => `${nativeType}(${typeParams?.['precision']},${typeParams?.['scale']})`,
          },
        ],
      ]);
      expect(
        buildExpectedFormatType(
          {
            nativeType: 'numeric',
            codecId: 'pg/decimal@1',
            nullable: false,
            typeParams: { precision: 10, scale: 2 },
          },
          hooks,
        ),
      ).toBe('numeric(10,2)');
    });

    it('falls back to display map when typeParams present but no hook', () => {
      expect(
        buildExpectedFormatType(
          {
            nativeType: 'int4',
            codecId: 'pg/int4@1',
            nullable: false,
            typeParams: { someParam: true },
          },
          noHooks,
        ),
      ).toBe('integer');
    });
  });
});

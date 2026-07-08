import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { printPslFromFlat } from '../fixtures';

// A schema exercising both a single-column FK and a composite FK, so the gate
// covers every shape the relation printer emits. The host of each `@relation`
// is the FK-owning side, which is where `from:`/`to:` are rendered.
const schemaIR: SqlSchemaIR = {
  tables: {
    account: {
      name: 'account',
      columns: {
        tenant_id: { name: 'tenant_id', nativeType: 'int4', nullable: false },
        id: { name: 'id', nativeType: 'int4', nullable: false },
      },
      primaryKey: { columns: ['tenant_id', 'id'] },
      foreignKeys: [],
      uniques: [],
      indexes: [],
    },
    user: {
      name: 'user',
      columns: {
        id: { name: 'id', nativeType: 'int4', nullable: false },
      },
      primaryKey: { columns: ['id'] },
      foreignKeys: [],
      uniques: [],
      indexes: [],
    },
    profile: {
      name: 'profile',
      columns: {
        id: { name: 'id', nativeType: 'int4', nullable: false },
        user_id: { name: 'user_id', nativeType: 'int4', nullable: false },
        tenant_id: { name: 'tenant_id', nativeType: 'int4', nullable: false },
        account_id: { name: 'account_id', nativeType: 'int4', nullable: false },
      },
      primaryKey: { columns: ['id'] },
      foreignKeys: [
        { columns: ['user_id'], referencedTable: 'user', referencedColumns: ['id'] },
        {
          columns: ['tenant_id', 'account_id'],
          referencedTable: 'account',
          referencedColumns: ['tenant_id', 'id'],
        },
      ],
      uniques: [],
      indexes: [],
    },
  },
};

describe('contract infer emits single-dialect relation vocabulary', () => {
  const printed = printPslFromFlat(schemaIR);

  it('emits no legacy @relation fields:/references: keys', () => {
    expect(printed).not.toMatch(/@relation\([^)]*\bfields:/);
    expect(printed).not.toMatch(/@relation\([^)]*\breferences:/);
  });

  it('emits the canonical from:/to: keys for FK relations', () => {
    expect(printed).toMatch(/@relation\([^)]*\bfrom:/);
    expect(printed).toMatch(/@relation\([^)]*\bto:/);
  });
});

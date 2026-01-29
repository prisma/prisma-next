import type {
  ControlAdapterDescriptor,
  ControlTargetDescriptor,
} from '@prisma-next/core-control-plane/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { createSqlFamilyInstance } from '../src/core/instance';

function createMockTarget(): ControlTargetDescriptor<'sql', 'postgres'> {
  return {
    kind: 'target',
    id: 'postgres',
    version: '0.0.1',
    familyId: 'sql',
    targetId: 'postgres',
    create: () => ({ familyId: 'sql' as const, targetId: 'postgres' as const }),
  };
}

function createMockAdapter(): ControlAdapterDescriptor<'sql', 'postgres'> {
  return {
    kind: 'adapter',
    id: 'postgres',
    version: '0.0.1',
    familyId: 'sql',
    targetId: 'postgres',
    create: () => ({ familyId: 'sql', targetId: 'postgres' }),
  };
}

describe('SqlFamilyInstance.toSchemaView', () => {
  it('stores column defaults in meta, not in label', () => {
    const familyInstance = createSqlFamilyInstance({
      target: createMockTarget(),
      adapter: createMockAdapter(),
      extensionPacks: [],
    });

    const schema: SqlSchemaIR = {
      tables: {
        User: {
          name: 'User',
          columns: {
            id: {
              name: 'id',
              nativeType: 'int4',
              nullable: false,
              default: { kind: 'db-generated', expression: 'autoincrement()' },
            },
            status: {
              name: 'status',
              nativeType: 'text',
              nullable: false,
              default: { kind: 'literal', expression: "'draft'" },
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      extensions: [],
    };

    const view = familyInstance.toSchemaView(schema);
    const userTable = view.root.children?.find((n) => n.id === 'table-User');
    expect(userTable?.kind).toBe('entity');

    const columnsGroup = userTable?.children?.find((n) => n.id === 'columns-User');
    expect(columnsGroup?.kind).toBe('collection');

    // Defaults are in meta (for JSON/programmatic access), not in label (for tree output)
    const idNode = columnsGroup?.children?.find((n) => n.id === 'column-User-id');
    expect(idNode?.kind).toBe('field');
    expect(idNode?.label).toBe('id: int4 (not nullable)');
    expect(idNode?.meta).toMatchObject({
      nativeType: 'int4',
      nullable: false,
      default: { kind: 'db-generated', expression: 'autoincrement()' },
    });

    const statusNode = columnsGroup?.children?.find((n) => n.id === 'column-User-status');
    expect(statusNode?.kind).toBe('field');
    expect(statusNode?.label).toBe('status: text (not nullable)');
    expect(statusNode?.meta).toMatchObject({
      nativeType: 'text',
      nullable: false,
      default: { kind: 'literal', expression: "'draft'" },
    });
  });
});

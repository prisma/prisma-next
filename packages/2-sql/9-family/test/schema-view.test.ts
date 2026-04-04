import type { ControlFamilyDescriptor } from '@prisma-next/framework-components/control';
import { createControlStack } from '@prisma-next/framework-components/control';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { createSqlFamilyInstance } from '../src/core/control-instance';

function createMockStack() {
  return createControlStack({
    family: {
      kind: 'family',
      id: 'sql',
      familyId: 'sql',
      version: '0.0.1',
      create: (() => ({})) as unknown as ControlFamilyDescriptor<'sql'>['create'],
      hook: {
        id: 'sql',
        validateTypes() {},
        validateStructure() {},
        generateContractTypes: () => '',
      },
    },
    target: {
      kind: 'target',
      id: 'postgres',
      version: '0.0.1',
      familyId: 'sql',
      targetId: 'postgres',
      operationSignatures: () => [],
      create: () => ({ familyId: 'sql', targetId: 'postgres' }),
    },
    adapter: {
      kind: 'adapter',
      id: 'postgres',
      version: '0.0.1',
      familyId: 'sql',
      targetId: 'postgres',
      operationSignatures: () => [],
      create: () => ({ familyId: 'sql', targetId: 'postgres' }),
    },
    extensionPacks: [],
  });
}

describe('SqlFamilyInstance.toSchemaView', () => {
  it('stores column defaults in meta, not in label', () => {
    const familyInstance = createSqlFamilyInstance(createMockStack());

    const schema: SqlSchemaIR = {
      tables: {
        User: {
          name: 'User',
          columns: {
            id: {
              name: 'id',
              nativeType: 'int4',
              nullable: false,
              default: "nextval('users_id_seq'::regclass)",
            },
            status: {
              name: 'status',
              nativeType: 'text',
              nullable: false,
              default: "'draft'::text",
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      dependencies: [],
    };

    const view = familyInstance.toSchemaView(schema);
    const userTable = view.root.children?.find((n) => n.id === 'table-User');
    expect(userTable?.kind).toBe('entity');

    const columnsGroup = userTable?.children?.find((n) => n.id === 'columns-User');
    expect(columnsGroup?.kind).toBe('collection');

    const idNode = columnsGroup?.children?.find((n) => n.id === 'column-User-id');
    expect(idNode?.kind).toBe('field');
    expect(idNode?.label).toBe('id: int4 (not nullable)');
    expect(idNode?.meta).toMatchObject({
      nativeType: 'int4',
      nullable: false,
      default: "nextval('users_id_seq'::regclass)",
    });

    const statusNode = columnsGroup?.children?.find((n) => n.id === 'column-User-status');
    expect(statusNode?.kind).toBe('field');
    expect(statusNode?.label).toBe('status: text (not nullable)');
    expect(statusNode?.meta).toMatchObject({
      nativeType: 'text',
      nullable: false,
      default: "'draft'::text",
    });
  });

  it('renders dependency nodes with dependency-oriented wording', () => {
    const familyInstance = createSqlFamilyInstance(createMockStack());

    const schema: SqlSchemaIR = {
      tables: {},
      dependencies: [{ id: 'postgres.extension.vector' }],
    };

    const view = familyInstance.toSchemaView(schema);
    const dependencyNode = view.root.children?.find(
      (n) => n.id === 'dependency-postgres.extension.vector',
    );

    expect(dependencyNode?.kind).toBe('dependency');
    expect(dependencyNode?.label).toBe('vector dependency is installed');
  });
});

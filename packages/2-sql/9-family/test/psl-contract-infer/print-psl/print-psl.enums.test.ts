import { printPsl } from '@prisma-next/psl-printer';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { sqlSchemaIrToPslAst } from '../../../src/core/psl-contract-infer/sql-schema-ir-to-psl-ast';

function printPslFromSql(schemaIR: SqlSchemaIR): string {
  return printPsl(sqlSchemaIrToPslAst(schemaIR));
}

describe('printPsl', () => {
  it('enum types', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        user: {
          name: 'user',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            role: { name: 'role', nativeType: 'user_role', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      annotations: {
        pg: {
          storageTypes: {
            user_role: {
              codecId: 'pg/enum@1',
              nativeType: 'user_role',
              typeParams: { values: ['USER', 'ADMIN', 'MODERATOR'] },
            },
          },
        },
      },
      dependencies: [],
    };
    const result = printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// Contract inferred from the live database schema. Edit as needed, then run \`prisma-next contract emit\`.

      enum UserRole {
        USER
        ADMIN
        MODERATOR

        @@map("user_role")
      }

      model User {
        id   Int      @id
        role UserRole

        @@map("user")
      }
      "
    `);
  });

  it('normalizes invalid enum labels to valid PSL identifiers', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        deployment: {
          name: 'deployment',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            status: {
              name: 'status',
              nativeType: 'deployment_status',
              nullable: false,
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      annotations: {
        pg: {
          storageTypes: {
            deployment_status: {
              codecId: 'pg/enum@1',
              nativeType: 'deployment_status',
              typeParams: {
                values: ['READY', 'in-progress', '2FA', 'default', 'inProgress'],
              },
            },
          },
        },
      },
      dependencies: [],
    };

    const result = printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// Contract inferred from the live database schema. Edit as needed, then run \`prisma-next contract emit\`.

      enum DeploymentStatus {
        READY
        inProgress
        _2fa
        _default
        inProgress2

        @@map("deployment_status")
      }

      model Deployment {
        id     Int              @id
        status DeploymentStatus

        @@map("deployment")
      }
      "
    `);
  });

  it('normalizes symbol-only enum labels and omits @@map when the enum name is already PSL-safe', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        User: {
          name: 'User',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            role: { name: 'role', nativeType: 'Role', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      annotations: {
        pg: {
          storageTypes: {
            Role: {
              codecId: 'pg/enum@1',
              nativeType: 'Role',
              typeParams: { values: ['!!!'] },
            },
          },
        },
      },
      dependencies: [],
    };

    const result = printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// Contract inferred from the live database schema. Edit as needed, then run \`prisma-next contract emit\`.

      enum Role {
        value
      }

      model User {
        id   Int  @id
        role Role
      }
      "
    `);
  });
});

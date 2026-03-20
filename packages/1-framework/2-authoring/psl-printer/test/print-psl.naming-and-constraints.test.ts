import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { printPsl } from '../src/exports/index';
import { makeOptions } from './print-psl-test-helpers';

describe('printPsl', () => {
  it('escapes inferred relation field names that would start with a digit', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        account: {
          name: 'account',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false, default: undefined },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
        login: {
          name: 'login',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false, default: undefined },
            '2fa_id': {
              name: '2fa_id',
              nativeType: 'int4',
              nullable: false,
              default: undefined,
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            {
              columns: ['2fa_id'],
              referencedTable: 'account',
              referencedColumns: ['id'],
            },
          ],
          uniques: [],
          indexes: [],
        },
      },
      dependencies: [],
    };
    const result = printPsl(schemaIR, makeOptions(schemaIR));
    expect(result).toMatchInlineSnapshot(`
      "// This file was introspected from the database. Do not edit manually.

      model Account {
        id     Int     @id
        logins Login[]

        @@map("account")
      }

      model Login {
        id     Int     @id
        _2faId Int     @map("2fa_id")
        _2fa   Account @relation(fields: [_2faId], references: [id])

        @@map("login")
      }
      "
    `);
  });

  it('disambiguates colliding normalized field names and preserves relation references', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        account: {
          name: 'account',
          columns: {
            user_id: {
              name: 'user_id',
              nativeType: 'int4',
              nullable: false,
              default: undefined,
            },
            userId: {
              name: 'userId',
              nativeType: 'text',
              nullable: false,
              default: undefined,
            },
          },
          primaryKey: { columns: ['user_id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
        login: {
          name: 'login',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false, default: undefined },
            account_id: {
              name: 'account_id',
              nativeType: 'int4',
              nullable: false,
              default: undefined,
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            {
              columns: ['account_id'],
              referencedTable: 'account',
              referencedColumns: ['user_id'],
            },
          ],
          uniques: [],
          indexes: [],
        },
      },
      dependencies: [],
    };
    const result = printPsl(schemaIR, makeOptions(schemaIR));
    expect(result).toMatchInlineSnapshot(`
      "// This file was introspected from the database. Do not edit manually.

      model Account {
        userId2 Int     @id @map("user_id")
        userId  String
        logins  Login[]

        @@map("account")
      }

      model Login {
        id        Int     @id
        accountId Int     @map("account_id")
        account   Account @relation(fields: [accountId], references: [userId2])

        @@map("login")
      }
      "
    `);
  });

  it('composite unique constraint and index', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        record: {
          name: 'record',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false, default: undefined },
            type: { name: 'type', nativeType: 'text', nullable: false, default: undefined },
            code: { name: 'code', nativeType: 'text', nullable: false, default: undefined },
            category: { name: 'category', nativeType: 'text', nullable: false, default: undefined },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [{ columns: ['type', 'code'] }],
          indexes: [{ columns: ['category', 'type'], unique: false }],
        },
      },
      dependencies: [],
    };
    const result = printPsl(schemaIR, makeOptions(schemaIR));
    expect(result).toMatchInlineSnapshot(`
      "// This file was introspected from the database. Do not edit manually.

      model Record {
        id       Int    @id
        _type    String @map("type")
        code     String
        category String

        @@unique([_type, code])
        @@index([category, _type])
        @@map("record")
      }
      "
    `);
  });

  it('reserved word table names are escaped', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        type: {
          name: 'type',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false, default: undefined },
            model: { name: 'model', nativeType: 'text', nullable: false, default: undefined },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      dependencies: [],
    };
    const result = printPsl(schemaIR, makeOptions(schemaIR));
    expect(result).toMatchInlineSnapshot(`
      "// This file was introspected from the database. Do not edit manually.

      model _Type {
        id     Int    @id
        _model String @map("model")

        @@map("type")
      }
      "
    `);
  });

  it('throws when model names collide after normalization', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        user_profile: {
          name: 'user_profile',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false, default: undefined },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
        UserProfile: {
          name: 'UserProfile',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false, default: undefined },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      dependencies: [],
    };

    expect(() => printPsl(schemaIR, makeOptions(schemaIR))).toThrowErrorMatchingInlineSnapshot(`
      [Error: PSL model name collisions detected:
      - model "UserProfile" from tables "user_profile", "UserProfile"]
    `);
  });

  it('throws when a model and enum normalize to the same top-level name', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        user_role: {
          name: 'user_role',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false, default: undefined },
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
              typeParams: { values: ['USER', 'ADMIN'] },
            },
          },
        },
      },
      dependencies: [],
    };

    expect(() => printPsl(schemaIR, makeOptions(schemaIR))).toThrowErrorMatchingInlineSnapshot(`
      [Error: PSL top-level name collisions detected:
      - identifier "UserRole" from table "user_role" collides with enum type "user_role"]
    `);
  });
});

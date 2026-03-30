import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { printPsl } from '../src/print-psl';
import { makeOptions } from './print-psl-test-helpers';

describe('printPsl', () => {
  it('empty schema', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {},
      dependencies: [],
    };
    const result = printPsl(schemaIR, makeOptions(schemaIR));
    expect(result).toMatchInlineSnapshot(`
      "// This file was introspected from the database. Do not edit manually.
      "
    `);
  });

  it('simple schema with single table', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        user: {
          name: 'user',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false, default: undefined },
            email: { name: 'email', nativeType: 'text', nullable: false, default: undefined },
            name: { name: 'name', nativeType: 'text', nullable: true, default: undefined },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [{ columns: ['email'] }],
          indexes: [],
        },
      },
      dependencies: [],
    };
    const result = printPsl(schemaIR, makeOptions(schemaIR));
    expect(result).toMatchInlineSnapshot(`
      "// This file was introspected from the database. Do not edit manually.

      model User {
        id    Int     @id
        email String  @unique
        name  String?

        @@map("user")
      }
      "
    `);
  });

  it('custom header', () => {
    const schemaIR: SqlSchemaIR = { tables: {}, dependencies: [] };
    const result = printPsl(schemaIR, {
      ...makeOptions(schemaIR),
      header: '// Custom header line',
    });
    expect(result).toMatchInlineSnapshot(`
      "// Custom header line
      "
    `);
  });

  it('table without primary key', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        audit_log: {
          name: 'audit_log',
          columns: {
            event: { name: 'event', nativeType: 'text', nullable: false, default: undefined },
            timestamp: {
              name: 'timestamp',
              nativeType: 'timestamptz',
              nullable: false,
              default: undefined,
            },
          },
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

      // WARNING: This table has no primary key in the database
      model AuditLog {
        event     String
        timestamp DateTime

        @@map("audit_log")
      }
      "
    `);
  });

  it('composite primary key', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        order_item: {
          name: 'order_item',
          columns: {
            order_id: { name: 'order_id', nativeType: 'int4', nullable: false, default: undefined },
            product_id: {
              name: 'product_id',
              nativeType: 'int4',
              nullable: false,
              default: undefined,
            },
            quantity: { name: 'quantity', nativeType: 'int4', nullable: false, default: undefined },
          },
          primaryKey: { columns: ['order_id', 'product_id'], name: 'order_item_pkey' },
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

      model OrderItem {
        orderId   Int @map("order_id")
        productId Int @map("product_id")
        quantity  Int

        @@id([orderId, productId], map: "order_item_pkey")
        @@map("order_item")
      }
      "
    `);
  });

  it('deterministic output: same input always produces same output', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        b_table: {
          name: 'b_table',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false, default: undefined },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
        a_table: {
          name: 'a_table',
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
    const result1 = printPsl(schemaIR, makeOptions(schemaIR));
    const result2 = printPsl(schemaIR, makeOptions(schemaIR));
    expect(result1).toBe(result2);
    expect(result1.indexOf('ATable')).toBeLessThan(result1.indexOf('BTable'));
  });
});

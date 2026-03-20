import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { createPostgresTypeMap, extractEnumTypeNames, printPsl } from '../src/exports/index';

function makeOptions(schemaIR: SqlSchemaIR) {
  const enumTypeNames = extractEnumTypeNames(schemaIR.annotations);
  return {
    typeMap: createPostgresTypeMap(enumTypeNames),
  };
}

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

  it('schema with defaults (autoincrement, now, boolean, string, number)', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        post: {
          name: 'post',
          columns: {
            id: {
              name: 'id',
              nativeType: 'int4',
              nullable: false,
              default: { kind: 'function', expression: 'autoincrement()' } as unknown as string,
            },
            title: {
              name: 'title',
              nativeType: 'text',
              nullable: false,
              default: { kind: 'literal', value: 'Untitled' } as unknown as string,
            },
            is_published: {
              name: 'is_published',
              nativeType: 'bool',
              nullable: false,
              default: { kind: 'literal', value: false } as unknown as string,
            },
            view_count: {
              name: 'view_count',
              nativeType: 'int4',
              nullable: false,
              default: { kind: 'literal', value: 0 } as unknown as string,
            },
            created_at: {
              name: 'created_at',
              nativeType: 'timestamptz',
              nullable: false,
              default: { kind: 'function', expression: 'now()' } as unknown as string,
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
    const result = printPsl(schemaIR, makeOptions(schemaIR));
    expect(result).toMatchInlineSnapshot(`
      "// This file was introspected from the database. Do not edit manually.

      model Post {
        id          Int      @id @default(autoincrement())
        title       String   @default("Untitled")
        isPublished Boolean  @default(false) @map("is_published")
        viewCount   Int      @default(0) @map("view_count")
        createdAt   DateTime @default(now()) @map("created_at")

        @@map("post")
      }
      "
    `);
  });

  it('schema with 1:N relation', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        user: {
          name: 'user',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false, default: undefined },
            name: { name: 'name', nativeType: 'text', nullable: false, default: undefined },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
        post: {
          name: 'post',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false, default: undefined },
            title: { name: 'title', nativeType: 'text', nullable: false, default: undefined },
            user_id: { name: 'user_id', nativeType: 'int4', nullable: false, default: undefined },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            {
              columns: ['user_id'],
              referencedTable: 'user',
              referencedColumns: ['id'],
            },
          ],
          uniques: [],
          indexes: [{ columns: ['user_id'], unique: false }],
        },
      },
      dependencies: [],
    };
    const result = printPsl(schemaIR, makeOptions(schemaIR));
    expect(result).toMatchInlineSnapshot(`
      "// This file was introspected from the database. Do not edit manually.

      model User {
        id    Int    @id
        name  String
        posts Post[]

        @@map("user")
      }

      model Post {
        id     Int    @id
        title  String
        userId Int    @map("user_id")
        user   User   @relation(fields: [userId], references: [id])

        @@index([userId])
        @@map("post")
      }
      "
    `);
  });

  it('schema with 1:1 relation (FK column is unique)', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        user: {
          name: 'user',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false, default: undefined },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
        profile: {
          name: 'profile',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false, default: undefined },
            user_id: { name: 'user_id', nativeType: 'int4', nullable: false, default: undefined },
            bio: { name: 'bio', nativeType: 'text', nullable: true, default: undefined },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            {
              columns: ['user_id'],
              referencedTable: 'user',
              referencedColumns: ['id'],
            },
          ],
          uniques: [{ columns: ['user_id'] }],
          indexes: [],
        },
      },
      dependencies: [],
    };
    const result = printPsl(schemaIR, makeOptions(schemaIR));
    expect(result).toMatchInlineSnapshot(`
      "// This file was introspected from the database. Do not edit manually.

      model User {
        id      Int      @id
        profile Profile?

        @@map("user")
      }

      model Profile {
        id     Int     @id
        userId Int     @unique @map("user_id")
        bio    String?
        user   User    @relation(fields: [userId], references: [id])

        @@map("profile")
      }
      "
    `);
  });

  it('self-referencing FK', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        employee: {
          name: 'employee',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false, default: undefined },
            name: { name: 'name', nativeType: 'text', nullable: false, default: undefined },
            manager_id: {
              name: 'manager_id',
              nativeType: 'int4',
              nullable: true,
              default: undefined,
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            {
              columns: ['manager_id'],
              referencedTable: 'employee',
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

      model Employee {
        id        Int        @id
        name      String
        managerId Int?       @map("manager_id")
        manager   Employee   @relation(fields: [managerId], references: [id])
        employees Employee[]

        @@map("employee")
      }
      "
    `);
  });

  it('multiple FKs to same table (named relations)', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        user: {
          name: 'user',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false, default: undefined },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
        message: {
          name: 'message',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false, default: undefined },
            sender_id: {
              name: 'sender_id',
              nativeType: 'int4',
              nullable: false,
              default: undefined,
            },
            recipient_id: {
              name: 'recipient_id',
              nativeType: 'int4',
              nullable: false,
              default: undefined,
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            {
              name: 'message_sender_fk',
              columns: ['sender_id'],
              referencedTable: 'user',
              referencedColumns: ['id'],
            },
            {
              name: 'message_recipient_fk',
              columns: ['recipient_id'],
              referencedTable: 'user',
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

      model User {
        id              Int       @id
        messages        Message[] @relation(name: "message_sender_fk")
        messagesMessage Message[] @relation(name: "message_recipient_fk")

        @@map("user")
      }

      model Message {
        id          Int  @id
        senderId    Int  @map("sender_id")
        recipientId Int  @map("recipient_id")
        sender      User @relation(name: "message_sender_fk", fields: [senderId], references: [id])
        recipient   User @relation(name: "message_recipient_fk", fields: [recipientId], references: [id])

        @@map("message")
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
          primaryKey: { columns: ['order_id', 'product_id'] },
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

        @@id([orderId, productId])
        @@map("order_item")
      }
      "
    `);
  });

  it('enum types', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        user: {
          name: 'user',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false, default: undefined },
            role: { name: 'role', nativeType: 'user_role', nullable: false, default: undefined },
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
    const result = printPsl(schemaIR, makeOptions(schemaIR));
    expect(result).toMatchInlineSnapshot(`
      "// This file was introspected from the database. Do not edit manually.

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

  it('unsupported (unmappable) types', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        geo_data: {
          name: 'geo_data',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false, default: undefined },
            location: {
              name: 'location',
              nativeType: 'geometry',
              nullable: true,
              default: undefined,
            },
            metadata: {
              name: 'metadata',
              nativeType: 'hstore',
              nullable: false,
              default: undefined,
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
    const result = printPsl(schemaIR, makeOptions(schemaIR));
    expect(result).toMatchInlineSnapshot(`
      "// This file was introspected from the database. Do not edit manually.

      model GeoData {
        id       Int                      @id
        location Unsupported("geometry")?
        metadata Unsupported("hstore")

        @@map("geo_data")
      }
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

  it('parameterized types generate types block entries', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        contact: {
          name: 'contact',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false, default: undefined },
            email: {
              name: 'email',
              nativeType: 'character varying(255)',
              nullable: false,
              default: undefined,
            },
            phone: {
              name: 'phone',
              nativeType: 'character(20)',
              nullable: true,
              default: undefined,
            },
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

      types {
        Email = String
        Phone = String
      }

      model Contact {
        id    Int    @id
        email Email  @unique
        phone Phone?

        @@map("contact")
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

  it('composite FK relation fields use table name', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        product: {
          name: 'product',
          columns: {
            category_id: {
              name: 'category_id',
              nativeType: 'int4',
              nullable: false,
              default: undefined,
            },
            product_id: {
              name: 'product_id',
              nativeType: 'int4',
              nullable: false,
              default: undefined,
            },
          },
          primaryKey: { columns: ['category_id', 'product_id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
        review: {
          name: 'review',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false, default: undefined },
            product_category_id: {
              name: 'product_category_id',
              nativeType: 'int4',
              nullable: false,
              default: undefined,
            },
            product_product_id: {
              name: 'product_product_id',
              nativeType: 'int4',
              nullable: false,
              default: undefined,
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            {
              columns: ['product_category_id', 'product_product_id'],
              referencedTable: 'product',
              referencedColumns: ['category_id', 'product_id'],
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

      model Product {
        categoryId Int      @map("category_id")
        productId  Int      @map("product_id")
        reviews    Review[]

        @@id([categoryId, productId])
        @@map("product")
      }

      model Review {
        id                Int     @id
        productCategoryId Int     @map("product_category_id")
        productProductId  Int     @map("product_product_id")
        product           Product @relation(fields: [productCategoryId, productProductId], references: [categoryId, productId])

        @@map("review")
      }
      "
    `);
  });

  it('uuid default', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        item: {
          name: 'item',
          columns: {
            id: {
              name: 'id',
              nativeType: 'uuid',
              nullable: false,
              default: { kind: 'function', expression: 'gen_random_uuid()' } as unknown as string,
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
    const result = printPsl(schemaIR, makeOptions(schemaIR));
    expect(result).toMatchInlineSnapshot(`
      "// This file was introspected from the database. Do not edit manually.

      model Item {
        id String @id @default(dbgenerated("gen_random_uuid()"))

        @@map("item")
      }
      "
    `);
  });

  it('unrecognized default becomes comment', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        data: {
          name: 'data',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false, default: undefined },
            computed: {
              name: 'computed',
              nativeType: 'text',
              nullable: false,
              default: { kind: 'function', expression: 'my_custom_func()' } as unknown as string,
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
    const result = printPsl(schemaIR, makeOptions(schemaIR));
    expect(result).toMatchInlineSnapshot(`
      "// This file was introspected from the database. Do not edit manually.

      model Data {
        id       Int    @id
        // Raw default: my_custom_func()
        computed String

        @@map("data")
      }
      "
    `);
  });

  it('onDelete and onUpdate referential actions', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        parent: {
          name: 'parent',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false, default: undefined },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
        child: {
          name: 'child',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false, default: undefined },
            parent_id: {
              name: 'parent_id',
              nativeType: 'int4',
              nullable: false,
              default: undefined,
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            {
              columns: ['parent_id'],
              referencedTable: 'parent',
              referencedColumns: ['id'],
              onDelete: 'cascade',
              onUpdate: 'cascade',
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

      model Parent {
        id     Int     @id
        childs Child[]

        @@map("parent")
      }

      model Child {
        id       Int    @id
        parentId Int    @map("parent_id")
        parent   Parent @relation(fields: [parentId], references: [id], onDelete: Cascade, onUpdate: Cascade)

        @@map("child")
      }
      "
    `);
  });

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
    // Models should be alphabetically sorted (no FK deps)
    expect(result1.indexOf('ATable')).toBeLessThan(result1.indexOf('BTable'));
  });
});

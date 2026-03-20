import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { printPsl } from '../src/print-psl';
import { makeOptions } from './print-psl-test-helpers';

describe('printPsl', () => {
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
        manager   Employee?  @relation(name: "ManagerEmployees", fields: [managerId], references: [id])
        employees Employee[] @relation(name: "ManagerEmployees")

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
        sender      User @relation(name: "message_sender_fk", fields: [senderId], references: [id], map: "message_sender_fk")
        recipient   User @relation(name: "message_recipient_fk", fields: [recipientId], references: [id], map: "message_recipient_fk")

        @@map("message")
      }
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

  it('preserves foreign key constraint names with relation map arguments', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        team: {
          name: 'team',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false, default: undefined },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
        member: {
          name: 'member',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false, default: undefined },
            team_id: { name: 'team_id', nativeType: 'int4', nullable: false, default: undefined },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            {
              name: 'member_team_id_fkey',
              columns: ['team_id'],
              referencedTable: 'team',
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

      model Team {
        id      Int      @id
        members Member[]

        @@map("team")
      }

      model Member {
        id     Int  @id
        teamId Int  @map("team_id")
        team   Team @relation(fields: [teamId], references: [id], map: "member_team_id_fkey")

        @@map("member")
      }
      "
    `);
  });

  it('orders cyclic table dependencies deterministically', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        alpha: {
          name: 'alpha',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false, default: undefined },
            beta_id: { name: 'beta_id', nativeType: 'int4', nullable: false, default: undefined },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            { columns: ['beta_id'], referencedTable: 'beta', referencedColumns: ['id'] },
          ],
          uniques: [],
          indexes: [],
        },
        beta: {
          name: 'beta',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false, default: undefined },
            alpha_id: {
              name: 'alpha_id',
              nativeType: 'int4',
              nullable: false,
              default: undefined,
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            { columns: ['alpha_id'], referencedTable: 'alpha', referencedColumns: ['id'] },
          ],
          uniques: [],
          indexes: [],
        },
      },
      dependencies: [],
    };

    const result = printPsl(schemaIR, makeOptions(schemaIR));
    const betaIndex = result.indexOf('model Beta');
    const alphaIndex = result.indexOf('model Alpha');

    expect(betaIndex).toBeGreaterThanOrEqual(0);
    expect(alphaIndex).toBeGreaterThanOrEqual(0);
    expect(betaIndex).toBeLessThan(alphaIndex);
  });
});

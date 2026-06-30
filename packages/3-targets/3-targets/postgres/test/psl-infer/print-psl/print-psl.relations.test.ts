import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { printPslFromFlat as printPslFromSql } from '../fixtures';

const MULTI_FK_BETWEEN_SAME_MODELS: SqlSchemaIR = {
  tables: {
    user: {
      name: 'user',
      columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
      primaryKey: { columns: ['id'] },
      foreignKeys: [],
      uniques: [],
      indexes: [],
    },
    message: {
      name: 'message',
      columns: {
        id: { name: 'id', nativeType: 'int4', nullable: false },
        sender_id: { name: 'sender_id', nativeType: 'int4', nullable: false },
        recipient_id: { name: 'recipient_id', nativeType: 'int4', nullable: false },
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
};

describe('printPsl', () => {
  it('schema with 1:N relation', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        user: {
          name: 'user',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            name: { name: 'name', nativeType: 'text', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
        post: {
          name: 'post',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            title: { name: 'title', nativeType: 'text', nullable: false },
            user_id: { name: 'user_id', nativeType: 'int4', nullable: false },
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
    };
    const result = printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// use prisma-next
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma-next contract emit\`.

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
        user   User   @relation(from: [userId], to: [id])

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
            bio: { name: 'bio', nativeType: 'text', nullable: true },
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
    };
    const result = printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// use prisma-next
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma-next contract emit\`.

      model User {
        id      Int      @id
        profile Profile?

        @@map("user")
      }

      model Profile {
        id     Int     @id
        userId Int     @unique @map("user_id")
        bio    String?
        user   User    @relation(from: [userId], to: [id])

        @@map("profile")
      }
      "
    `);
  });

  it('schema with 1:1 relation from a composite unique foreign key', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        account: {
          name: 'account',
          columns: {
            tenant_id: {
              name: 'tenant_id',
              nativeType: 'int4',
              nullable: false,
            },
            id: { name: 'id', nativeType: 'int4', nullable: false },
          },
          primaryKey: { columns: ['tenant_id', 'id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
        profile: {
          name: 'profile',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            tenant_id: {
              name: 'tenant_id',
              nativeType: 'int4',
              nullable: false,
            },
            account_id: {
              name: 'account_id',
              nativeType: 'int4',
              nullable: false,
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            {
              columns: ['tenant_id', 'account_id'],
              referencedTable: 'account',
              referencedColumns: ['tenant_id', 'id'],
            },
          ],
          uniques: [{ columns: ['tenant_id', 'account_id'] }],
          indexes: [],
        },
      },
    };
    const result = printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// use prisma-next
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma-next contract emit\`.

      model Account {
        tenantId Int      @map("tenant_id")
        id       Int
        profile  Profile?

        @@id([tenantId, id])
        @@map("account")
      }

      model Profile {
        id        Int     @id
        tenantId  Int     @map("tenant_id")
        accountId Int     @map("account_id")
        account   Account @relation(from: [tenantId, accountId], to: [tenantId, id])

        @@unique([tenantId, accountId])
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
            id: { name: 'id', nativeType: 'int4', nullable: false },
            name: { name: 'name', nativeType: 'text', nullable: false },
            manager_id: {
              name: 'manager_id',
              nativeType: 'int4',
              nullable: true,
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
    };
    const result = printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// use prisma-next
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma-next contract emit\`.

      model Employee {
        id        Int        @id
        name      String
        managerId Int?       @map("manager_id")
        manager   Employee?  @relation(from: [managerId], to: [id])
        employees Employee[] @relation(inverse: manager)

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
            id: { name: 'id', nativeType: 'int4', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
        message: {
          name: 'message',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            sender_id: {
              name: 'sender_id',
              nativeType: 'int4',
              nullable: false,
            },
            recipient_id: {
              name: 'recipient_id',
              nativeType: 'int4',
              nullable: false,
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
    };
    const result = printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// use prisma-next
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma-next contract emit\`.

      model User {
        id              Int       @id
        messages        Message[] @relation(inverse: sender)
        messagesMessage Message[] @relation(inverse: recipient)

        @@map("user")
      }

      model Message {
        id          Int  @id
        senderId    Int  @map("sender_id")
        recipientId Int  @map("recipient_id")
        sender      User @relation(from: [senderId], to: [id], map: "message_sender_fk")
        recipient   User @relation(from: [recipientId], to: [id], map: "message_recipient_fk")

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
            },
            product_id: {
              name: 'product_id',
              nativeType: 'int4',
              nullable: false,
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
            id: { name: 'id', nativeType: 'int4', nullable: false },
            product_category_id: {
              name: 'product_category_id',
              nativeType: 'int4',
              nullable: false,
            },
            product_product_id: {
              name: 'product_product_id',
              nativeType: 'int4',
              nullable: false,
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
    };
    const result = printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// use prisma-next
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma-next contract emit\`.

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
        product           Product @relation(from: [productCategoryId, productProductId], to: [categoryId, productId])

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
            id: { name: 'id', nativeType: 'int4', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
        child: {
          name: 'child',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            parent_id: {
              name: 'parent_id',
              nativeType: 'int4',
              nullable: false,
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
    };
    const result = printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// use prisma-next
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma-next contract emit\`.

      model Parent {
        id     Int     @id
        childs Child[]

        @@map("parent")
      }

      model Child {
        id       Int    @id
        parentId Int    @map("parent_id")
        parent   Parent @relation(from: [parentId], to: [id], onDelete: Cascade, onUpdate: Cascade)

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
            id: { name: 'id', nativeType: 'int4', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
        member: {
          name: 'member',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            team_id: { name: 'team_id', nativeType: 'int4', nullable: false },
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
    };

    const result = printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// use prisma-next
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma-next contract emit\`.

      model Team {
        id      Int      @id
        members Member[]

        @@map("team")
      }

      model Member {
        id     Int  @id
        teamId Int  @map("team_id")
        team   Team @relation(from: [teamId], to: [id], map: "member_team_id_fkey")

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
            id: { name: 'id', nativeType: 'int4', nullable: false },
            beta_id: { name: 'beta_id', nativeType: 'int4', nullable: false },
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
            id: { name: 'id', nativeType: 'int4', nullable: false },
            alpha_id: {
              name: 'alpha_id',
              nativeType: 'int4',
              nullable: false,
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
    };

    const result = printPslFromSql(schemaIR);
    const betaIndex = result.indexOf('model Beta');
    const alphaIndex = result.indexOf('model Alpha');

    expect(betaIndex).toBeGreaterThanOrEqual(0);
    expect(alphaIndex).toBeGreaterThanOrEqual(0);
    expect(betaIndex).toBeLessThan(alphaIndex);
  });
});

describe('printer retires @relation(name:)', () => {
  it('emits no @relation(name:) and points the back side with inverse:', () => {
    const result = printPslFromSql(MULTI_FK_BETWEEN_SAME_MODELS);

    expect(result).not.toContain('@relation(name:');
    expect(result).toContain('inverse:');
  });

  it('points each back-relation at the FK-side field it pairs with', () => {
    const result = printPslFromSql(MULTI_FK_BETWEEN_SAME_MODELS);

    expect(result).toContain('@relation(inverse: sender)');
    expect(result).toContain('@relation(inverse: recipient)');
  });
});

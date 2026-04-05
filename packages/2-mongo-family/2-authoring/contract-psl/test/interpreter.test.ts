import type { ContractField, ContractReferenceRelation } from '@prisma-next/contract/types';
import { parsePslDocument } from '@prisma-next/psl-parser';
import { describe, expect, it } from 'vitest';
import {
  type InterpretPslDocumentToMongoContractInput,
  interpretPslDocumentToMongoContract,
} from '../src/interpreter';
import { createMongoScalarTypeDescriptors } from '../src/scalar-type-descriptors';

interface MongoModel {
  readonly fields: Record<string, ContractField>;
  readonly relations: Record<string, ContractReferenceRelation>;
  readonly storage: Record<string, unknown>;
}

function model(ir: { models: Record<string, unknown> }, name: string): MongoModel {
  return ir.models[name] as MongoModel;
}

function interpret(
  schema: string,
  overrides?: Partial<Omit<InterpretPslDocumentToMongoContractInput, 'document'>>,
) {
  const document = parsePslDocument({ schema, sourceId: 'test.prisma' });
  return interpretPslDocumentToMongoContract({
    document,
    scalarTypeDescriptors: createMongoScalarTypeDescriptors(),
    ...overrides,
  });
}

function interpretOk(
  schema: string,
  overrides?: Partial<Omit<InterpretPslDocumentToMongoContractInput, 'document'>>,
) {
  const result = interpret(schema, overrides);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('Expected ok result');
  return result.value;
}

describe('interpretPslDocumentToMongoContract', () => {
  describe('scalar type mapping', () => {
    it('maps standard PSL types to Mongo codec IDs', () => {
      const ir = interpretOk(`
        model Item {
          id     ObjectId @id @map("_id")
          name   String
          count  Int
          active Boolean
          at     DateTime
        }
      `);

      expect(ir.models['Item']).toMatchObject({
        fields: {
          _id: { codecId: 'mongo/objectId@1', nullable: false },
          name: { codecId: 'mongo/string@1', nullable: false },
          count: { codecId: 'mongo/int32@1', nullable: false },
          active: { codecId: 'mongo/bool@1', nullable: false },
          at: { codecId: 'mongo/date@1', nullable: false },
        },
      });
    });

    it('produces diagnostics for PSL types without runtime codec support', () => {
      const result = interpret(`
        model Item {
          id    ObjectId @id @map("_id")
          big   BigInt
          score Float
          data  Bytes
        }
      `);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toHaveLength(3);
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_UNSUPPORTED_FIELD_TYPE',
            message: expect.stringContaining('BigInt'),
          }),
          expect.objectContaining({
            code: 'PSL_UNSUPPORTED_FIELD_TYPE',
            message: expect.stringContaining('Float'),
          }),
          expect.objectContaining({
            code: 'PSL_UNSUPPORTED_FIELD_TYPE',
            message: expect.stringContaining('Bytes'),
          }),
        ]),
      );
    });

    it('uses custom scalar type descriptors when provided', () => {
      const ir = interpretOk(
        `
        model Item {
          id   ObjectId @id @map("_id")
          name String
        }
      `,
        {
          scalarTypeDescriptors: new Map([
            ['ObjectId', 'custom/oid@2'],
            ['String', 'custom/text@2'],
          ]),
        },
      );

      expect(ir.models['Item']).toMatchObject({
        fields: {
          _id: { codecId: 'custom/oid@2' },
          name: { codecId: 'custom/text@2' },
        },
      });
    });

    it('produces a diagnostic for scalar list fields', () => {
      const result = interpret(`
        model Item {
          id   ObjectId @id @map("_id")
          tags String[]
        }
      `);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_UNSUPPORTED_LIST_FIELD',
            message: expect.stringContaining('tags'),
          }),
        ]),
      );
    });

    it('produces a diagnostic for unsupported field types', () => {
      const result = interpret(`
        model Item {
          id   ObjectId @id @map("_id")
          data Unsupported
        }
      `);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_UNSUPPORTED_FIELD_TYPE',
            message: expect.stringContaining('Unsupported'),
          }),
        ]),
      );
    });
  });

  describe('collection naming', () => {
    it('uses lowerFirst(modelName) as default collection name', () => {
      const ir = interpretOk(`
        model UserProfile {
          id ObjectId @id @map("_id")
        }
      `);

      expect(ir.models['UserProfile']).toMatchObject({
        storage: { collection: 'userProfile' },
      });
      expect(ir.storage).toMatchObject({
        collections: { userProfile: {} },
      });
    });

    it('uses @@map() to override collection name', () => {
      const ir = interpretOk(`
        model User {
          id ObjectId @id @map("_id")
          @@map("users")
        }
      `);

      expect(ir.models['User']).toMatchObject({
        storage: { collection: 'users' },
      });
      expect(ir.storage).toMatchObject({
        collections: { users: {} },
      });
    });
  });

  describe('field naming', () => {
    it('uses PSL field name as default', () => {
      const ir = interpretOk(`
        model Item {
          id   ObjectId @id @map("_id")
          name String
        }
      `);

      expect(model(ir, 'Item').fields).toHaveProperty('name');
    });

    it('uses @map() to override field name', () => {
      const ir = interpretOk(`
        model Item {
          id        ObjectId @id @map("_id")
          firstName String @map("first_name")
        }
      `);

      expect(model(ir, 'Item').fields).toHaveProperty('first_name');
      expect(model(ir, 'Item').fields).not.toHaveProperty('firstName');
    });
  });

  describe('nullable fields', () => {
    it('marks optional fields as nullable', () => {
      const ir = interpretOk(`
        model Item {
          id  ObjectId @id @map("_id")
          bio String?
        }
      `);

      expect(ir.models['Item']).toMatchObject({
        fields: {
          bio: { nullable: true },
        },
      });
    });

    it('marks required fields as non-nullable', () => {
      const ir = interpretOk(`
        model Item {
          id   ObjectId @id @map("_id")
          name String
        }
      `);

      expect(ir.models['Item']).toMatchObject({
        fields: {
          name: { nullable: false },
        },
      });
    });
  });

  describe('relations', () => {
    const blogSchema = `
      model User {
        id    ObjectId @id @map("_id")
        name  String
        posts Post[]
      }

      model Post {
        id       ObjectId @id @map("_id")
        title    String
        authorId ObjectId
        author   User @relation(fields: [authorId], references: [id])
      }
    `;

    it('creates N:1 reference relation from @relation with fields/references', () => {
      const ir = interpretOk(blogSchema);

      expect(model(ir, 'Post').relations).toMatchObject({
        author: {
          to: 'User',
          cardinality: 'N:1',
          on: {
            localFields: ['authorId'],
            targetFields: ['_id'],
          },
        },
      });
    });

    it('creates 1:N backrelation for list fields referencing other models', () => {
      const ir = interpretOk(blogSchema);

      expect(model(ir, 'User').relations).toMatchObject({
        posts: {
          to: 'Post',
          cardinality: '1:N',
          on: {
            localFields: ['_id'],
            targetFields: ['authorId'],
          },
        },
      });
    });

    it('uses mapped field names in relation on-clauses', () => {
      const ir = interpretOk(`
        model Parent {
          id       ObjectId @id @map("_id")
          children Child[]
        }

        model Child {
          id       ObjectId @id @map("_id")
          parentId ObjectId @map("parent_id")
          parent   Parent @relation(fields: [parentId], references: [id])
        }
      `);

      expect(model(ir, 'Child').relations).toMatchObject({
        parent: {
          to: 'Parent',
          on: {
            localFields: ['parent_id'],
            targetFields: ['_id'],
          },
        },
      });
    });

    it('excludes FK-side relation fields from the fields record', () => {
      const ir = interpretOk(blogSchema);

      expect(model(ir, 'Post').fields).not.toHaveProperty('author');
    });

    it('excludes backrelation list fields from the fields record', () => {
      const ir = interpretOk(blogSchema);

      expect(model(ir, 'User').fields).not.toHaveProperty('posts');
    });

    it('disambiguates multiple FK relations to the same target using relation name', () => {
      const ir = interpretOk(`
        model User {
          id             ObjectId @id @map("_id")
          createdTasks   Task[] @relation("created")
          assignedTasks  Task[] @relation("assigned")
        }

        model Task {
          id           ObjectId @id @map("_id")
          title        String
          creatorId    ObjectId
          assigneeId   ObjectId
          creator      User @relation("created", fields: [creatorId], references: [id])
          assignee     User @relation("assigned", fields: [assigneeId], references: [id])
        }
      `);

      expect(model(ir, 'User').relations).toMatchObject({
        createdTasks: {
          to: 'Task',
          cardinality: '1:N',
          on: { localFields: ['_id'], targetFields: ['creatorId'] },
        },
        assignedTasks: {
          to: 'Task',
          cardinality: '1:N',
          on: { localFields: ['_id'], targetFields: ['assigneeId'] },
        },
      });
    });

    it('emits diagnostic for ambiguous backrelation with multiple FKs and no relation name', () => {
      const result = interpret(`
        model User {
          id    ObjectId @id @map("_id")
          tasks Task[]
        }

        model Task {
          id          ObjectId @id @map("_id")
          creatorId   ObjectId
          assigneeId  ObjectId
          creator     User @relation("created", fields: [creatorId], references: [id])
          assignee    User @relation("assigned", fields: [assigneeId], references: [id])
        }
      `);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_AMBIGUOUS_BACKRELATION',
          }),
        ]),
      );
    });

    it('creates 1:1 inverse relation for singular non-FK relation field', () => {
      const ir = interpretOk(`
        model User {
          id      ObjectId @id @map("_id")
          profile Profile?
        }

        model Profile {
          id     ObjectId @id @map("_id")
          userId ObjectId
          user   User @relation(fields: [userId], references: [id])
        }
      `);

      expect(model(ir, 'User').relations).toMatchObject({
        profile: {
          to: 'Profile',
          cardinality: '1:1',
          on: {
            localFields: ['_id'],
            targetFields: ['userId'],
          },
        },
      });
      expect(model(ir, 'Profile').relations).toMatchObject({
        user: {
          to: 'User',
          cardinality: 'N:1',
          on: {
            localFields: ['userId'],
            targetFields: ['_id'],
          },
        },
      });
    });

    it('emits diagnostic for orphaned backrelation with no matching FK', () => {
      const result = interpret(`
        model User {
          id       ObjectId @id @map("_id")
          comments Comment[]
        }

        model Comment {
          id ObjectId @id @map("_id")
        }
      `);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_ORPHANED_BACKRELATION',
          }),
        ]),
      );
    });
  });

  describe('@id validation', () => {
    it('emits diagnostic when model has no @id field', () => {
      const result = interpret(`
        model Item {
          name String
        }
      `);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_MISSING_ID_FIELD',
            message: expect.stringContaining('Item'),
          }),
        ]),
      );
    });

    it('accepts model with @id field', () => {
      const ir = interpretOk(`
        model Item {
          id ObjectId @id @map("_id")
          name String
        }
      `);

      expect(ir.models['Item']).toBeDefined();
    });
  });

  describe('contract structure', () => {
    it('generates roots mapping collection names to model names', () => {
      const ir = interpretOk(`
        model User {
          id ObjectId @id @map("_id")
        }

        model Post {
          id ObjectId @id @map("_id")
          @@map("blog_posts")
        }
      `);

      expect(ir.roots).toEqual({
        user: 'User',
        blog_posts: 'Post',
      });
    });

    it('sets correct targetFamily and target', () => {
      const ir = interpretOk(`
        model Item {
          id ObjectId @id @map("_id")
        }
      `);

      expect(ir.targetFamily).toBe('mongo');
      expect(ir.target).toBe('mongo');
    });

    it('generates storage.collections with empty objects', () => {
      const ir = interpretOk(`
        model User {
          id ObjectId @id @map("_id")
        }

        model Post {
          id ObjectId @id @map("_id")
        }
      `);

      expect(ir.storage).toMatchObject({
        collections: {
          user: {},
          post: {},
        },
      });
      expect(ir.storage.storageHash).toMatch(/^sha256:/);
    });

    it('includes empty extensionPacks, capabilities, and meta', () => {
      const ir = interpretOk(`
        model Item {
          id ObjectId @id @map("_id")
        }
      `);

      expect(ir.extensionPacks).toEqual({});
      expect(ir.capabilities).toEqual({});
      expect(ir.meta).toEqual({});
    });
  });

  describe('full blog schema', () => {
    it('produces the expected contract matching the demo contract', () => {
      const ir = interpretOk(`
        model User {
          id    ObjectId @id @map("_id")
          name  String
          email String
          bio   String?
          posts Post[]
          @@map("users")
        }

        model Post {
          id        ObjectId @id @map("_id")
          title     String
          content   String
          authorId  ObjectId
          createdAt DateTime
          author    User @relation(fields: [authorId], references: [id])
          @@map("posts")
        }
      `);

      expect(ir).toEqual({
        profileHash: expect.stringMatching(/^sha256:/),
        targetFamily: 'mongo',
        target: 'mongo',
        roots: {
          users: 'User',
          posts: 'Post',
        },
        models: {
          User: {
            fields: {
              _id: { codecId: 'mongo/objectId@1', nullable: false },
              name: { codecId: 'mongo/string@1', nullable: false },
              email: { codecId: 'mongo/string@1', nullable: false },
              bio: { codecId: 'mongo/string@1', nullable: true },
            },
            relations: {
              posts: {
                to: 'Post',
                cardinality: '1:N',
                on: { localFields: ['_id'], targetFields: ['authorId'] },
              },
            },
            storage: { collection: 'users' },
          },
          Post: {
            fields: {
              _id: { codecId: 'mongo/objectId@1', nullable: false },
              title: { codecId: 'mongo/string@1', nullable: false },
              content: { codecId: 'mongo/string@1', nullable: false },
              authorId: { codecId: 'mongo/objectId@1', nullable: false },
              createdAt: { codecId: 'mongo/date@1', nullable: false },
            },
            relations: {
              author: {
                to: 'User',
                cardinality: 'N:1',
                on: { localFields: ['authorId'], targetFields: ['_id'] },
              },
            },
            storage: { collection: 'posts' },
          },
        },
        storage: {
          storageHash: expect.stringMatching(/^sha256:/),
          collections: {
            users: {},
            posts: {},
          },
        },
        extensionPacks: {},
        capabilities: {},
        meta: {},
      });
    });
  });
});

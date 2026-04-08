import { generateContractDts } from '@prisma-next/emitter';
import type { TypesImportSpec } from '@prisma-next/framework-components/emission';
import { describe, expect, it } from 'vitest';
import { mongoEmission } from '../src/index';
import { createMongoContract } from './fixtures/create-mongo-contract';

const testHashes = { storageHash: 'test-storage-hash', profileHash: 'test-profile-hash' };

describe('mongoEmission.generateContractTypes', () => {
  it('generates Contract and TypeMaps exports', () => {
    const contract = createMongoContract();
    const types = generateContractDts(contract, mongoEmission, [], [], testHashes);
    expect(types).toContain(
      'export type Contract = MongoContractWithTypeMaps<ContractBase, TypeMaps>',
    );
    expect(types).toContain(
      'export type TypeMaps = MongoTypeMaps<CodecTypes, OperationTypes, FieldOutputTypes>',
    );
  });

  it('generates hash type aliases', () => {
    const contract = createMongoContract();
    const types = generateContractDts(contract, mongoEmission, [], [], testHashes);
    expect(types).toContain("StorageHashBase<'test-storage-hash'>");
    expect(types).toContain("ProfileHashBase<'test-profile-hash'>");
  });

  it('generates concrete execution hash when provided', () => {
    const contract = createMongoContract();
    const types = generateContractDts(contract, mongoEmission, [], [], {
      ...testHashes,
      executionHash: 'test-exec-hash',
    });
    expect(types).toContain("ExecutionHashBase<'test-exec-hash'>");
  });

  it('generates generic execution hash when not provided', () => {
    const contract = createMongoContract();
    const types = generateContractDts(contract, mongoEmission, [], [], testHashes);
    expect(types).toContain('ExecutionHashBase<string>');
  });

  it('includes framework imports', () => {
    const contract = createMongoContract();
    const types = generateContractDts(contract, mongoEmission, [], [], testHashes);
    expect(types).toContain("from '@prisma-next/mongo-contract'");
    expect(types).toContain("from '@prisma-next/contract/types'");
    expect(types).toContain('MongoContractWithTypeMaps');
    expect(types).toContain('MongoTypeMaps');
    expect(types).toContain('StorageHashBase');
    expect(types).toContain('ProfileHashBase');
    expect(types).toContain('ExecutionHashBase');
  });

  it('generates codec type imports and intersection', () => {
    const contract = createMongoContract();
    const codecImports: TypesImportSpec[] = [
      {
        package: '@prisma-next/adapter-mongo/codec-types',
        named: 'CodecTypes',
        alias: 'MongoCodecTypes',
      },
    ];
    const types = generateContractDts(contract, mongoEmission, codecImports, [], testHashes);
    expect(types).toContain(
      "import type { CodecTypes as MongoCodecTypes } from '@prisma-next/adapter-mongo/codec-types'",
    );
    expect(types).toContain('export type CodecTypes = MongoCodecTypes');
  });

  it('generates empty CodecTypes when no codec imports', () => {
    const contract = createMongoContract();
    const types = generateContractDts(contract, mongoEmission, [], [], testHashes);
    expect(types).toContain('export type CodecTypes = Record<string, never>');
  });

  it('generates contract header fields', () => {
    const contract = createMongoContract();
    const types = generateContractDts(contract, mongoEmission, [], [], testHashes);
    expect(types).toContain("readonly target: 'mongo'");
    expect(types).not.toContain('schemaVersion');
    expect(types).toContain('readonly profileHash: ProfileHash');
  });

  it('generates roots type', () => {
    const contract = createMongoContract({
      roots: { users: 'User', posts: 'Post' },
    });
    const types = generateContractDts(contract, mongoEmission, [], [], testHashes);
    expect(types).toContain("readonly users: 'User'");
    expect(types).toContain("readonly posts: 'Post'");
  });

  describe('model generation', () => {
    it('generates model domain fields with scalar type and nullable', () => {
      const contract = createMongoContract({
        models: {
          User: {
            fields: {
              _id: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
              name: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
              bio: { nullable: true, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
            },
            relations: {},
            storage: { collection: 'users' },
          },
        },
        storage: { collections: { users: {} } },
      });
      const types = generateContractDts(contract, mongoEmission, [], [], testHashes);
      expect(types).toContain(
        "readonly _id: { readonly nullable: false; readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/objectId@1' } }",
      );
      expect(types).toContain(
        "readonly name: { readonly nullable: false; readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' } }",
      );
      expect(types).toContain(
        "readonly bio: { readonly nullable: true; readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' } }",
      );
    });

    it('generates model relations without strategy', () => {
      const contract = createMongoContract({
        models: {
          User: {
            fields: {
              _id: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
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
              _id: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
              authorId: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
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
        storage: { collections: { users: {}, posts: {} } },
      });
      const types = generateContractDts(contract, mongoEmission, [], [], testHashes);
      expect(types).toContain("readonly to: 'Post'");
      expect(types).toContain("readonly cardinality: '1:N'");
      expect(types).toContain("readonly localFields: readonly ['_id']");
      expect(types).toContain("readonly targetFields: readonly ['authorId']");
      expect(types).not.toContain('strategy');
    });

    it('generates root model storage with collection', () => {
      const contract = createMongoContract({
        models: {
          User: {
            fields: {
              _id: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
            },
            relations: {},
            storage: { collection: 'users' },
          },
        },
        storage: { collections: { users: {} } },
      });
      const types = generateContractDts(contract, mongoEmission, [], [], testHashes);
      expect(types).toContain("readonly collection: 'users'");
    });

    it('generates embedded model storage as empty record', () => {
      const contract = createMongoContract({
        models: {
          User: {
            fields: {
              _id: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
            },
            relations: { addresses: { to: 'Address', cardinality: '1:N' } },
            storage: {
              collection: 'users',
              relations: { addresses: { field: 'addresses' } },
            },
          },
          Address: {
            fields: {
              street: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
            },
            relations: {},
            storage: {},
            owner: 'User',
          },
        },
        storage: { collections: { users: {} } },
      });
      const types = generateContractDts(contract, mongoEmission, [], [], testHashes);
      expect(types).toContain('readonly Address: { readonly fields:');
      expect(types).toContain("readonly owner: 'User'");
    });

    it('generates model with owner field', () => {
      const contract = createMongoContract({
        models: {
          Post: {
            fields: {
              _id: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
            },
            relations: { comments: { to: 'Comment', cardinality: '1:N' } },
            storage: { collection: 'posts' },
          },
          Comment: {
            fields: {
              text: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
            },
            relations: {},
            storage: {},
            owner: 'Post',
          },
        },
        storage: { collections: { posts: {} } },
      });
      const types = generateContractDts(contract, mongoEmission, [], [], testHashes);
      expect(types).toContain("readonly owner: 'Post'");
    });

    it('generates polymorphic model with discriminator and variants', () => {
      const contract = createMongoContract({
        models: {
          Task: {
            fields: {
              _id: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
              type: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
            },
            relations: {},
            storage: { collection: 'tasks' },
            discriminator: { field: 'type' },
            variants: { Bug: { value: 'bug' }, Feature: { value: 'feature' } },
          },
          Bug: {
            fields: {
              severity: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
            },
            relations: {},
            storage: { collection: 'tasks' },
            base: 'Task',
          },
          Feature: {
            fields: {
              priority: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
            },
            relations: {},
            storage: { collection: 'tasks' },
            base: 'Task',
          },
        },
        storage: { collections: { tasks: {} } },
      });
      const types = generateContractDts(contract, mongoEmission, [], [], testHashes);
      expect(types).toContain("discriminator: { readonly field: 'type' }");
      expect(types).toContain("readonly Bug: { readonly value: 'bug' }");
      expect(types).toContain("readonly Feature: { readonly value: 'feature' }");
      expect(types).toContain("base: 'Task'");
    });

    it('generates storage.relations on parent model', () => {
      const contract = createMongoContract({
        models: {
          User: {
            fields: {
              _id: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
            },
            relations: { addresses: { to: 'Address', cardinality: '1:N' } },
            storage: {
              collection: 'users',
              relations: { addresses: { field: 'addresses' } },
            },
          },
          Address: {
            fields: {
              street: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
            },
            relations: {},
            storage: {},
            owner: 'User',
          },
        },
        storage: { collections: { users: {} } },
      });
      const types = generateContractDts(contract, mongoEmission, [], [], testHashes);
      expect(types).toContain(
        "readonly relations: { readonly addresses: { readonly field: 'addresses' } }",
      );
    });
  });

  describe('storage generation', () => {
    it('generates storage with collections', () => {
      const contract = createMongoContract({
        storage: { collections: { users: {}, posts: {} } },
      });
      const types = generateContractDts(contract, mongoEmission, [], [], testHashes);
      expect(types).toContain('readonly collections:');
      expect(types).toContain('readonly users: Record<string, never>');
      expect(types).toContain('readonly posts: Record<string, never>');
    });

    it('generates empty collections', () => {
      const contract = createMongoContract({ storage: { collections: {} } });
      const types = generateContractDts(contract, mongoEmission, [], [], testHashes);
      expect(types).toContain('readonly collections: Record<string, never>');
    });
  });

  describe('value object type generation', () => {
    it('emits named value object type aliases', () => {
      const contract = createMongoContract({
        models: {
          User: {
            fields: {
              _id: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
            },
            relations: {},
            storage: { collection: 'users' },
          },
        },
        valueObjects: {
          Address: {
            fields: {
              street: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
              city: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
            },
          },
        },
        storage: { collections: { users: {} } },
      });
      const types = generateContractDts(contract, mongoEmission, [], [], testHashes);
      expect(types).toContain('export type Address =');
      expect(types).toContain("readonly street: CodecTypes['mongo/string@1']['output']");
      expect(types).toContain("readonly city: CodecTypes['mongo/string@1']['output']");
    });

    it('emits valueObjects descriptor on ContractBase', () => {
      const contract = createMongoContract({
        valueObjects: {
          Address: {
            fields: {
              street: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
            },
          },
        },
      });
      const types = generateContractDts(contract, mongoEmission, [], [], testHashes);
      expect(types).toContain('readonly valueObjects:');
      expect(types).toContain('readonly Address: { readonly fields:');
    });

    it('emits model field with valueObject kind', () => {
      const contract = createMongoContract({
        models: {
          User: {
            fields: {
              _id: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
              homeAddress: {
                nullable: true,
                type: { kind: 'valueObject', name: 'Address' },
              },
            },
            relations: {},
            storage: { collection: 'users' },
          },
        },
        valueObjects: {
          Address: {
            fields: {
              street: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
            },
          },
        },
        storage: { collections: { users: {} } },
      });
      const types = generateContractDts(contract, mongoEmission, [], [], testHashes);
      expect(types).toContain(
        "readonly homeAddress: { readonly nullable: true; readonly type: { readonly kind: 'valueObject'; readonly name: 'Address' } }",
      );
    });

    it('handles many: true on value object model fields', () => {
      const contract = createMongoContract({
        models: {
          User: {
            fields: {
              _id: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
              previousAddresses: {
                nullable: false,
                type: { kind: 'valueObject', name: 'Address' },
                many: true,
              },
            },
            relations: {},
            storage: { collection: 'users' },
          },
        },
        valueObjects: {
          Address: {
            fields: {
              street: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
            },
          },
        },
        storage: { collections: { users: {} } },
      });
      const types = generateContractDts(contract, mongoEmission, [], [], testHashes);
      expect(types).toContain(
        "readonly previousAddresses: { readonly nullable: false; readonly type: { readonly kind: 'valueObject'; readonly name: 'Address' }; readonly many: true }",
      );
    });

    it('handles self-referencing value object type alias', () => {
      const contract = createMongoContract({
        valueObjects: {
          NavItem: {
            fields: {
              label: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
              children: {
                nullable: false,
                type: { kind: 'valueObject', name: 'NavItem' },
                many: true,
              },
            },
          },
        },
      });
      const types = generateContractDts(contract, mongoEmission, [], [], testHashes);
      expect(types).toContain('export type NavItem =');
      expect(types).toContain('readonly children: ReadonlyArray<NavItem>');
    });

    it('omits valueObjects when none exist', () => {
      const contract = createMongoContract();
      const types = generateContractDts(contract, mongoEmission, [], [], testHashes);
      expect(types).not.toContain('valueObjects');
    });

    it('emits nullable value object type alias field', () => {
      const contract = createMongoContract({
        valueObjects: {
          Address: {
            fields: {
              zip: { nullable: true, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
            },
          },
        },
      });
      const types = generateContractDts(contract, mongoEmission, [], [], testHashes);
      expect(types).toContain("readonly zip: CodecTypes['mongo/string@1']['output'] | null");
    });
  });
});

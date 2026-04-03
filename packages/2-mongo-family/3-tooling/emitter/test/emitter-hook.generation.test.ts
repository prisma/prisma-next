import type { TypesImportSpec } from '@prisma-next/framework-components/emission';
import { describe, expect, it } from 'vitest';
import { mongoTargetFamilyHook } from '../src/index';
import { createMongoContract } from './fixtures/create-mongo-contract';

const testHashes = { storageHash: 'test-storage-hash', profileHash: 'test-profile-hash' };

describe('mongoTargetFamilyHook.generateContractTypes', () => {
  it('generates Contract and TypeMaps exports', () => {
    const contract = createMongoContract();
    const types = mongoTargetFamilyHook.generateContractTypes(contract, [], [], testHashes);
    expect(types).toContain(
      'export type Contract = MongoContractWithTypeMaps<ContractBase, TypeMaps>',
    );
    expect(types).toContain('export type TypeMaps = MongoTypeMaps<CodecTypes, OperationTypes>');
  });

  it('generates hash type aliases', () => {
    const contract = createMongoContract();
    const types = mongoTargetFamilyHook.generateContractTypes(contract, [], [], testHashes);
    expect(types).toContain("StorageHashBase<'test-storage-hash'>");
    expect(types).toContain("ProfileHashBase<'test-profile-hash'>");
  });

  it('generates concrete execution hash when provided', () => {
    const contract = createMongoContract();
    const types = mongoTargetFamilyHook.generateContractTypes(contract, [], [], {
      ...testHashes,
      executionHash: 'test-exec-hash',
    });
    expect(types).toContain("ExecutionHashBase<'test-exec-hash'>");
  });

  it('generates generic execution hash when not provided', () => {
    const contract = createMongoContract();
    const types = mongoTargetFamilyHook.generateContractTypes(contract, [], [], testHashes);
    expect(types).toContain('ExecutionHashBase<string>');
  });

  it('includes framework imports', () => {
    const contract = createMongoContract();
    const types = mongoTargetFamilyHook.generateContractTypes(contract, [], [], testHashes);
    expect(types).toContain("from '@prisma-next/mongo-core'");
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
        package: '@prisma-next/mongo-core/codec-types',
        named: 'CodecTypes',
        alias: 'MongoCodecTypes',
      },
    ];
    const types = mongoTargetFamilyHook.generateContractTypes(
      contract,
      codecImports,
      [],
      testHashes,
    );
    expect(types).toContain(
      "import type { CodecTypes as MongoCodecTypes } from '@prisma-next/mongo-core/codec-types'",
    );
    expect(types).toContain('export type CodecTypes = MongoCodecTypes');
  });

  it('generates empty CodecTypes when no codec imports', () => {
    const contract = createMongoContract();
    const types = mongoTargetFamilyHook.generateContractTypes(contract, [], [], testHashes);
    expect(types).toContain('export type CodecTypes = Record<string, never>');
  });

  it('generates contract header fields', () => {
    const contract = createMongoContract();
    const types = mongoTargetFamilyHook.generateContractTypes(contract, [], [], testHashes);
    expect(types).toContain("readonly target: 'mongo'");
    expect(types).toContain("readonly targetFamily: 'mongo'");
    expect(types).not.toContain('schemaVersion');
    expect(types).toContain('readonly profileHash: ProfileHash');
  });

  it('generates roots type', () => {
    const contract = createMongoContract({
      roots: { users: 'User', posts: 'Post' },
    });
    const types = mongoTargetFamilyHook.generateContractTypes(contract, [], [], testHashes);
    expect(types).toContain("readonly users: 'User'");
    expect(types).toContain("readonly posts: 'Post'");
  });

  describe('model generation', () => {
    it('generates model domain fields with codecId and nullable', () => {
      const contract = createMongoContract({
        models: {
          User: {
            fields: {
              _id: { codecId: 'mongo/objectId@1', nullable: false },
              name: { codecId: 'mongo/string@1', nullable: false },
              bio: { codecId: 'mongo/string@1', nullable: true },
            },
            relations: {},
            storage: { collection: 'users' },
          },
        },
        storage: { collections: { users: {} } },
      });
      const types = mongoTargetFamilyHook.generateContractTypes(contract, [], [], testHashes);
      expect(types).toContain(
        "readonly _id: { readonly codecId: 'mongo/objectId@1'; readonly nullable: false }",
      );
      expect(types).toContain(
        "readonly name: { readonly codecId: 'mongo/string@1'; readonly nullable: false }",
      );
      expect(types).toContain(
        "readonly bio: { readonly codecId: 'mongo/string@1'; readonly nullable: true }",
      );
    });

    it('generates model relations without strategy', () => {
      const contract = createMongoContract({
        models: {
          User: {
            fields: { _id: { codecId: 'mongo/objectId@1', nullable: false } },
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
              authorId: { codecId: 'mongo/objectId@1', nullable: false },
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
      const types = mongoTargetFamilyHook.generateContractTypes(contract, [], [], testHashes);
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
            fields: { _id: { codecId: 'mongo/objectId@1', nullable: false } },
            relations: {},
            storage: { collection: 'users' },
          },
        },
        storage: { collections: { users: {} } },
      });
      const types = mongoTargetFamilyHook.generateContractTypes(contract, [], [], testHashes);
      expect(types).toContain("readonly collection: 'users'");
    });

    it('generates embedded model storage as empty record', () => {
      const contract = createMongoContract({
        models: {
          User: {
            fields: { _id: { codecId: 'mongo/objectId@1', nullable: false } },
            relations: { addresses: { to: 'Address', cardinality: '1:N' } },
            storage: {
              collection: 'users',
              relations: { addresses: { field: 'addresses' } },
            },
          },
          Address: {
            fields: { street: { codecId: 'mongo/string@1', nullable: false } },
            relations: {},
            storage: {},
            owner: 'User',
          },
        },
        storage: { collections: { users: {} } },
      });
      const types = mongoTargetFamilyHook.generateContractTypes(contract, [], [], testHashes);
      expect(types).toContain('readonly Address: { readonly fields:');
      expect(types).toContain("readonly owner: 'User'");
    });

    it('generates model with owner field', () => {
      const contract = createMongoContract({
        models: {
          Post: {
            fields: { _id: { codecId: 'mongo/objectId@1', nullable: false } },
            relations: { comments: { to: 'Comment', cardinality: '1:N' } },
            storage: { collection: 'posts' },
          },
          Comment: {
            fields: { text: { codecId: 'mongo/string@1', nullable: false } },
            relations: {},
            storage: {},
            owner: 'Post',
          },
        },
        storage: { collections: { posts: {} } },
      });
      const types = mongoTargetFamilyHook.generateContractTypes(contract, [], [], testHashes);
      expect(types).toContain("readonly owner: 'Post'");
    });

    it('generates polymorphic model with discriminator and variants', () => {
      const contract = createMongoContract({
        models: {
          Task: {
            fields: {
              _id: { codecId: 'mongo/objectId@1', nullable: false },
              type: { codecId: 'mongo/string@1', nullable: false },
            },
            relations: {},
            storage: { collection: 'tasks' },
            discriminator: { field: 'type' },
            variants: { Bug: { value: 'bug' }, Feature: { value: 'feature' } },
          },
          Bug: {
            fields: { severity: { codecId: 'mongo/string@1', nullable: false } },
            relations: {},
            storage: { collection: 'tasks' },
            base: 'Task',
          },
          Feature: {
            fields: { priority: { codecId: 'mongo/string@1', nullable: false } },
            relations: {},
            storage: { collection: 'tasks' },
            base: 'Task',
          },
        },
        storage: { collections: { tasks: {} } },
      });
      const types = mongoTargetFamilyHook.generateContractTypes(contract, [], [], testHashes);
      expect(types).toContain("discriminator: { readonly field: 'type' }");
      expect(types).toContain("readonly Bug: { readonly value: 'bug' }");
      expect(types).toContain("readonly Feature: { readonly value: 'feature' }");
      expect(types).toContain("base: 'Task'");
    });

    it('generates storage.relations on parent model', () => {
      const contract = createMongoContract({
        models: {
          User: {
            fields: { _id: { codecId: 'mongo/objectId@1', nullable: false } },
            relations: { addresses: { to: 'Address', cardinality: '1:N' } },
            storage: {
              collection: 'users',
              relations: { addresses: { field: 'addresses' } },
            },
          },
          Address: {
            fields: { street: { codecId: 'mongo/string@1', nullable: false } },
            relations: {},
            storage: {},
            owner: 'User',
          },
        },
        storage: { collections: { users: {} } },
      });
      const types = mongoTargetFamilyHook.generateContractTypes(contract, [], [], testHashes);
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
      const types = mongoTargetFamilyHook.generateContractTypes(contract, [], [], testHashes);
      expect(types).toContain('readonly collections:');
      expect(types).toContain('readonly users: Record<string, never>');
      expect(types).toContain('readonly posts: Record<string, never>');
    });

    it('generates empty collections', () => {
      const contract = createMongoContract({ storage: { collections: {} } });
      const types = mongoTargetFamilyHook.generateContractTypes(contract, [], [], testHashes);
      expect(types).toContain('readonly collections: Record<string, never>');
    });
  });
});

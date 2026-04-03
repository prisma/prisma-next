import { describe, expect, it } from 'vitest';
import type { Contract } from '../src/contract-types';
import type {
  ContractDiscriminator,
  ContractEmbedRelation,
  ContractField,
  ContractModel,
  ContractReferenceRelation,
  ContractRelation,
  ContractRelationOn,
  ContractVariantEntry,
  DomainDiscriminator,
  DomainEmbedRelation,
  DomainField,
  DomainModel,
  DomainReferenceRelation,
  DomainRelation,
  DomainRelationOn,
  DomainVariantEntry,
  ModelStorageBase,
} from '../src/domain-types';
import type {
  ExecutionHashBase,
  ProfileHashBase,
  StorageBase,
  StorageHashBase,
} from '../src/types';

type AssertExtends<T, U> = T extends U ? true : never;
type AssertExact<T, U> = [T] extends [U] ? ([U] extends [T] ? true : never) : never;

// ── Example literal types for proofs ─────────────────────────────────────────

type ExampleModelStorage = {
  readonly table: 'user';
  readonly fields: {
    readonly id: { readonly column: 'id' };
    readonly email: { readonly column: 'email' };
  };
};

type ExampleModels = {
  readonly User: ContractModel<ExampleModelStorage> & {
    readonly fields: {
      readonly id: { readonly nullable: false; readonly codecId: 'pg/int4@1' };
      readonly email: { readonly nullable: false; readonly codecId: 'pg/text@1' };
    };
    readonly relations: {
      readonly posts: {
        readonly to: 'Post';
        readonly cardinality: '1:N';
        readonly on: {
          readonly localFields: readonly ['id'];
          readonly targetFields: readonly ['userId'];
        };
      };
    };
    readonly storage: ExampleModelStorage;
  };
};

type ExampleStorage = StorageBase<'sha256:abc123'> & {
  readonly tables: {
    readonly user: {
      readonly columns: {
        readonly id: { readonly nativeType: 'int4' };
        readonly email: { readonly nativeType: 'text' };
      };
    };
  };
};

type ExampleContract = Contract<ExampleStorage, ExampleModels>;

// ── Tests ────────────────────────────────────────────────────────────────────

describe('unified contract types', () => {
  describe('Contract* and Domain* alias equivalence', () => {
    it('ContractField equals DomainField', () => {
      const _: AssertExact<ContractField, DomainField> = true;
      expect(_).toBe(true);
    });

    it('ContractRelationOn equals DomainRelationOn', () => {
      const _: AssertExact<ContractRelationOn, DomainRelationOn> = true;
      expect(_).toBe(true);
    });

    it('ContractReferenceRelation equals DomainReferenceRelation', () => {
      const _: AssertExact<ContractReferenceRelation, DomainReferenceRelation> = true;
      expect(_).toBe(true);
    });

    it('ContractEmbedRelation equals DomainEmbedRelation', () => {
      const _: AssertExact<ContractEmbedRelation, DomainEmbedRelation> = true;
      expect(_).toBe(true);
    });

    it('ContractRelation equals DomainRelation', () => {
      const _: AssertExact<ContractRelation, DomainRelation> = true;
      expect(_).toBe(true);
    });

    it('ContractDiscriminator equals DomainDiscriminator', () => {
      const _: AssertExact<ContractDiscriminator, DomainDiscriminator> = true;
      expect(_).toBe(true);
    });

    it('ContractVariantEntry equals DomainVariantEntry', () => {
      const _: AssertExact<ContractVariantEntry, DomainVariantEntry> = true;
      expect(_).toBe(true);
    });

    it('ContractModel equals DomainModel', () => {
      const _: AssertExact<ContractModel, DomainModel> = true;
      expect(_).toBe(true);
    });
  });

  describe('ContractModel generic storage', () => {
    it('ContractModel with specific storage extends base ContractModel', () => {
      const _: AssertExtends<ContractModel<ExampleModelStorage>, ContractModel> = true;
      expect(_).toBe(true);
    });

    it('ContractModel defaults to ModelStorageBase', () => {
      const _: AssertExtends<ContractModel, ContractModel<ModelStorageBase>> = true;
      expect(_).toBe(true);
    });

    it('preserves polymorphism fields (discriminator, variants, base, owner)', () => {
      const model: ContractModel = {
        fields: { type: { nullable: false, codecId: 'pg/text@1' } },
        relations: {},
        storage: {},
        discriminator: { field: 'type' },
        variants: { Special: { value: 'special' } },
        owner: 'Parent',
      };
      expect(model.discriminator?.field).toBe('type');
      expect(model.owner).toBe('Parent');
    });
  });

  describe('StorageBase', () => {
    it('carries branded storageHash', () => {
      const hash = 'sha256:abc123' as StorageHashBase<'sha256:abc123'>;
      const storage: StorageBase<'sha256:abc123'> = { storageHash: hash };
      expect(storage.storageHash).toBe('sha256:abc123');
    });

    it('defaults to string hash', () => {
      const _: AssertExtends<StorageBase<'sha256:abc123'>, StorageBase> = true;
      expect(_).toBe(true);
    });
  });

  describe('Contract<TStorage, TModels>', () => {
    it('accepts a full contract value', () => {
      const hash = 'sha256:abc123' as StorageHashBase<'sha256:abc123'>;
      const contract: Contract = {
        target: 'postgres',
        targetFamily: 'sql',
        roots: { users: 'User' },
        models: {
          User: {
            fields: { id: { nullable: false, codecId: 'pg/int4@1' } },
            relations: {},
            storage: {},
          },
        },
        storage: { storageHash: hash },
        capabilities: {},
        extensionPacks: {},
        meta: {},
      };
      expect(contract.target).toBe('postgres');
      expect(contract.roots['users']).toBe('User');
    });

    it('accepts optional execution and profileHash', () => {
      const hash = 'sha256:abc123' as StorageHashBase<'sha256:abc123'>;
      const execHash = 'sha256:exec456' as ExecutionHashBase<'sha256:exec456'>;
      const profHash = 'sha256:prof789' as ProfileHashBase<'sha256:prof789'>;
      const contract: Contract = {
        target: 'postgres',
        targetFamily: 'sql',
        roots: {},
        models: {},
        storage: { storageHash: hash },
        capabilities: {},
        extensionPacks: {},
        meta: {},
        execution: {
          executionHash: execHash,
          mutations: { defaults: [] },
        },
        profileHash: profHash,
      };
      expect(contract.execution?.executionHash).toBe('sha256:exec456');
      expect(contract.profileHash).toBe('sha256:prof789');
    });
  });

  describe('literal type preservation', () => {
    it('preserves model field literal types through TModels', () => {
      type UserCodecId = ExampleContract['models']['User']['fields']['id']['codecId'];
      const _: UserCodecId = 'pg/int4@1';
      expect(_).toBe('pg/int4@1');
    });

    it('preserves relation literal types through TModels', () => {
      type PostsTo = ExampleContract['models']['User']['relations']['posts']['to'];
      const _: PostsTo = 'Post';
      expect(_).toBe('Post');
    });

    it('preserves model storage bridge literals through TModels', () => {
      type UserTable = ExampleContract['models']['User']['storage']['table'];
      const _: UserTable = 'user';
      expect(_).toBe('user');
    });

    it('preserves storage hash literal through TStorage', () => {
      type Hash = ExampleContract['storage']['storageHash'];
      const _: Hash = 'sha256:abc123' as StorageHashBase<'sha256:abc123'>;
      expect(_ as string).toBe('sha256:abc123');
    });

    it('preserves storage table literal types through TStorage', () => {
      type UserIdNativeType =
        ExampleContract['storage']['tables']['user']['columns']['id']['nativeType'];
      const _: UserIdNativeType = 'int4';
      expect(_).toBe('int4');
    });
  });

  describe('framework consumer compatibility', () => {
    it('framework code reads domain fields from Contract (opaque storage)', () => {
      function frameworkConsumer(contract: Contract): string[] {
        return Object.entries(contract.models).map(([name, model]) => {
          const fieldCount = Object.keys(model.fields).length;
          return `${name}: ${fieldCount} fields`;
        });
      }

      const hash = 'sha256:abc123' as StorageHashBase<'sha256:abc123'>;
      const contract: ExampleContract = {
        target: 'postgres',
        targetFamily: 'sql',
        roots: { users: 'User' },
        models: {
          User: {
            fields: {
              id: { nullable: false, codecId: 'pg/int4@1' },
              email: { nullable: false, codecId: 'pg/text@1' },
            },
            relations: {
              posts: {
                to: 'Post',
                cardinality: '1:N',
                on: { localFields: ['id'], targetFields: ['userId'] },
              },
            },
            storage: {
              table: 'user',
              fields: {
                id: { column: 'id' },
                email: { column: 'email' },
              },
            },
          },
        },
        storage: {
          storageHash: hash,
          tables: {
            user: {
              columns: {
                id: { nativeType: 'int4' },
                email: { nativeType: 'text' },
              },
            },
          },
        },
        capabilities: {},
        extensionPacks: {},
        meta: {},
      };

      const result = frameworkConsumer(contract);
      expect(result).toEqual(['User: 2 fields']);
    });

    it('emitted contract satisfies Contract', () => {
      const _: AssertExtends<ExampleContract, Contract> = true;
      expect(_).toBe(true);
    });
  });
});

import { expectTypeOf, test } from 'vitest';
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
import type { StorageBase, StorageHashBase } from '../src/types';

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

// ── Contract* and Domain* alias equivalence ──────────────────────────────────

test('ContractField equals DomainField', () => {
  expectTypeOf<ContractField>().toEqualTypeOf<DomainField>();
});

test('ContractRelationOn equals DomainRelationOn', () => {
  expectTypeOf<ContractRelationOn>().toEqualTypeOf<DomainRelationOn>();
});

test('ContractReferenceRelation equals DomainReferenceRelation', () => {
  expectTypeOf<ContractReferenceRelation>().toEqualTypeOf<DomainReferenceRelation>();
});

test('ContractEmbedRelation equals DomainEmbedRelation', () => {
  expectTypeOf<ContractEmbedRelation>().toEqualTypeOf<DomainEmbedRelation>();
});

test('ContractRelation equals DomainRelation', () => {
  expectTypeOf<ContractRelation>().toEqualTypeOf<DomainRelation>();
});

test('ContractDiscriminator equals DomainDiscriminator', () => {
  expectTypeOf<ContractDiscriminator>().toEqualTypeOf<DomainDiscriminator>();
});

test('ContractVariantEntry equals DomainVariantEntry', () => {
  expectTypeOf<ContractVariantEntry>().toEqualTypeOf<DomainVariantEntry>();
});

test('ContractModel equals DomainModel', () => {
  expectTypeOf<ContractModel>().toEqualTypeOf<DomainModel>();
});

// ── ContractModel generic storage ────────────────────────────────────────────

test('ContractModel with specific storage extends base ContractModel', () => {
  expectTypeOf<ContractModel<ExampleModelStorage>>().toExtend<ContractModel>();
});

test('ContractModel defaults to ModelStorageBase', () => {
  expectTypeOf<ContractModel>().toExtend<ContractModel<ModelStorageBase>>();
});

// ── StorageBase ──────────────────────────────────────────────────────────────

test('StorageBase with specific hash extends default StorageBase', () => {
  expectTypeOf<StorageBase<'sha256:abc123'>>().toExtend<StorageBase>();
});

// ── Literal type preservation ────────────────────────────────────────────────

test('preserves model field literal types through TModels', () => {
  expectTypeOf<
    ExampleContract['models']['User']['fields']['id']['codecId']
  >().toEqualTypeOf<'pg/int4@1'>();
});

test('preserves relation literal types through TModels', () => {
  expectTypeOf<
    ExampleContract['models']['User']['relations']['posts']['to']
  >().toEqualTypeOf<'Post'>();
});

test('preserves model storage bridge literals through TModels', () => {
  expectTypeOf<ExampleContract['models']['User']['storage']['table']>().toEqualTypeOf<'user'>();
});

test('preserves storage hash literal through TStorage', () => {
  expectTypeOf<ExampleContract['storage']['storageHash']>().toEqualTypeOf<
    StorageHashBase<'sha256:abc123'>
  >();
});

test('preserves storage table literal types through TStorage', () => {
  expectTypeOf<
    ExampleContract['storage']['tables']['user']['columns']['id']['nativeType']
  >().toEqualTypeOf<'int4'>();
});

// ── Framework consumer compatibility ─────────────────────────────────────────

test('emitted contract satisfies Contract', () => {
  expectTypeOf<ExampleContract>().toExtend<Contract>();
});

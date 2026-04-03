/**
 * Unified Contract Representation — Type Design (ADR 182 / M5)
 *
 * This file defines the target type system for the unified contract
 * representation. It imports existing types where needed for compatibility
 * proofs, defines the new types, and asserts structural properties.
 *
 * Run: node_modules/.bin/tsc --project projects/contract-domain-extraction/tsconfig.json
 *
 * Structure:
 *   §1  Contract primitives (renamed from Domain*)
 *   §2  StorageBase and ContractModel
 *   §3  Contract<TStorage, TModels>
 *   §4  SQL family instantiation
 *   §5  Mongo family instantiation
 *   §6  Emitted contract.d.ts example (literal type preservation)
 *   §7  Compatibility proofs (existing types)
 *   §8  Framework consumer proof
 *   §9  Validation design
 */

// --- Imports from existing codebase (for compatibility proofs) ---

import type {
  ExecutionHashBase,
  ExecutionSection as ExistingExecutionSection,
  ContractBase as ExistingContractBase,
  ProfileHashBase,
  StorageHashBase,
} from '@prisma-next/contract/types';
import type {
  MongoContract as ExistingMongoContract,
  MongoModelDefinition,
  MongoStorage as ExistingMongoStorage,
  MongoModelStorage,
  MongoStorageCollection,
} from '@prisma-next/mongo-core';
import type {
  SqlContract as ExistingSqlContract,
  SqlStorage as ExistingSqlStorage,
  SqlModelStorage,
  StorageTable,
  StorageTypeInstance,
} from '@prisma-next/sql-contract/types';

// ============================================================================
// §1  Contract primitives (renamed from Domain*)
// ============================================================================

export type ContractField = {
  readonly nullable: boolean;
  readonly codecId: string;
};

export type ContractRelationOn = {
  readonly localFields: readonly string[];
  readonly targetFields: readonly string[];
};

export type ContractReferenceRelation = {
  readonly to: string;
  readonly cardinality: '1:1' | '1:N' | 'N:1';
  readonly on: ContractRelationOn;
};

export type ContractEmbedRelation = {
  readonly to: string;
  readonly cardinality: '1:1' | '1:N';
};

export type ContractRelation = ContractReferenceRelation | ContractEmbedRelation;

export type ContractDiscriminator = {
  readonly field: string;
};

export type ContractVariantEntry = {
  readonly value: string;
};

// ============================================================================
// §2  StorageBase, ExecutionSection, and ContractModel
// ============================================================================

export interface StorageBase<THash extends string = string> {
  readonly storageHash: StorageHashBase<THash>;
}

export type ExecutionMutationDefaultValue = {
  readonly kind: 'generator';
  readonly id: string;
  readonly params?: Record<string, unknown>;
};

export type ExecutionMutationDefault = {
  readonly ref: { readonly table: string; readonly column: string };
  readonly onCreate?: ExecutionMutationDefaultValue;
  readonly onUpdate?: ExecutionMutationDefaultValue;
};

export type ExecutionSection<THash extends string = string> = {
  readonly executionHash: ExecutionHashBase<THash>;
  readonly mutations: {
    readonly defaults: ReadonlyArray<ExecutionMutationDefault>;
  };
};

export interface ContractModel<ModelStorage = Record<string, unknown>> {
  readonly fields: Record<string, ContractField>;
  readonly relations: Record<string, ContractRelation>;
  readonly storage: ModelStorage;
  readonly discriminator?: ContractDiscriminator;
  readonly variants?: Record<string, ContractVariantEntry>;
  readonly base?: string;
  readonly owner?: string;
}

// Backward-compatible alias
export type DomainModel = ContractModel;

// ============================================================================
// §3  Contract<TStorage, TModels>
// ============================================================================

export interface Contract<
  TStorage extends StorageBase = StorageBase,
  TModels extends Record<string, ContractModel> = Record<string, ContractModel>,
> {
  readonly target: string;
  readonly targetFamily: string;
  readonly roots: Record<string, string>;
  readonly models: TModels;
  readonly storage: TStorage;
  readonly capabilities: Record<string, Record<string, boolean>>;
  readonly extensionPacks: Record<string, unknown>;
  readonly execution?: ExecutionSection;
  readonly profileHash?: ProfileHashBase<string>;
  readonly meta: Record<string, unknown>;
}

// ============================================================================
// §4  SQL family instantiation
// ============================================================================

export interface SqlStorage<THash extends string = string> extends StorageBase<THash> {
  readonly tables: Record<string, StorageTable>;
  readonly types?: Record<string, StorageTypeInstance>;
}

// SqlModelStorage is re-used from the existing package (already correct shape)

export type SqlContract<
  S extends SqlStorage = SqlStorage,
  M extends Record<string, ContractModel<SqlModelStorage>>
    = Record<string, ContractModel<SqlModelStorage>>,
> = Contract<S, M>;

// ============================================================================
// §5  Mongo family instantiation
// ============================================================================

export interface MongoStorage<THash extends string = string> extends StorageBase<THash> {
  readonly collections: Record<string, MongoStorageCollection>;
}

export type MongoContract<
  S extends MongoStorage = MongoStorage,
  M extends Record<string, ContractModel<MongoModelStorage>>
    = Record<string, ContractModel<MongoModelStorage>>,
> = Contract<S, M>;

// ============================================================================
// §6  Emitted contract.d.ts example (literal type preservation)
// ============================================================================
//
// This simulates what the emitter would produce. All literal types must
// survive through the TModels and TStorage generic parameters.

type ExampleModels = {
  readonly User: {
    readonly fields: {
      readonly id: { readonly nullable: false; readonly codecId: 'pg/int4@1' };
      readonly email: { readonly nullable: false; readonly codecId: 'pg/text@1' };
      readonly name: { readonly nullable: true; readonly codecId: 'pg/text@1' };
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
    readonly storage: {
      readonly table: 'user';
      readonly fields: {
        readonly id: { readonly column: 'id' };
        readonly email: { readonly column: 'email' };
        readonly name: { readonly column: 'display_name' };
      };
    };
  };
  readonly Post: {
    readonly fields: {
      readonly id: { readonly nullable: false; readonly codecId: 'pg/int4@1' };
      readonly title: { readonly nullable: false; readonly codecId: 'pg/text@1' };
      readonly userId: { readonly nullable: false; readonly codecId: 'pg/int4@1' };
    };
    readonly relations: {
      readonly user: {
        readonly to: 'User';
        readonly cardinality: 'N:1';
        readonly on: {
          readonly localFields: readonly ['userId'];
          readonly targetFields: readonly ['id'];
        };
      };
    };
    readonly storage: {
      readonly table: 'post';
      readonly fields: {
        readonly id: { readonly column: 'id' };
        readonly title: { readonly column: 'title' };
        readonly userId: { readonly column: 'user_id' };
      };
    };
  };
};

type EmittedContract = SqlContract<
  {
    readonly storageHash: StorageHashBase<'sha256:abc123'>;
    readonly tables: {
      readonly user: {
        readonly columns: {
          readonly id: {
            readonly nativeType: 'int4';
            readonly codecId: 'pg/int4@1';
            readonly nullable: false;
          };
          readonly email: {
            readonly nativeType: 'text';
            readonly codecId: 'pg/text@1';
            readonly nullable: false;
          };
          readonly display_name: {
            readonly nativeType: 'text';
            readonly codecId: 'pg/text@1';
            readonly nullable: true;
          };
        };
        readonly primaryKey: { readonly columns: readonly ['id'] };
        readonly uniques: readonly [];
        readonly indexes: readonly [];
        readonly foreignKeys: readonly [];
      };
      readonly post: {
        readonly columns: {
          readonly id: {
            readonly nativeType: 'int4';
            readonly codecId: 'pg/int4@1';
            readonly nullable: false;
          };
          readonly title: {
            readonly nativeType: 'text';
            readonly codecId: 'pg/text@1';
            readonly nullable: false;
          };
          readonly user_id: {
            readonly nativeType: 'int4';
            readonly codecId: 'pg/int4@1';
            readonly nullable: false;
          };
        };
        readonly primaryKey: { readonly columns: readonly ['id'] };
        readonly uniques: readonly [];
        readonly indexes: readonly [];
        readonly foreignKeys: readonly [
          {
            readonly columns: readonly ['user_id'];
            readonly references: { readonly table: 'user'; readonly columns: readonly ['id'] };
            readonly constraint: true;
            readonly index: true;
          },
        ];
      };
    };
  },
  ExampleModels
>;

// --- Literal type preservation proofs ---

// Known model keys are accessible (not lost to index signature)
type _UserModel = EmittedContract['models']['User'];
type _PostModel = EmittedContract['models']['Post'];

// Field literal types preserved
type _UserNameCodec = _UserModel['fields']['name']['codecId'];
const _userNameCodec: _UserNameCodec = 'pg/text@1';

type _UserNameNullable = _UserModel['fields']['name']['nullable'];
const _userNameNullable: _UserNameNullable = true;

// Relation literal types preserved
type _UserPostsRelTo = _UserModel['relations']['posts']['to'];
const _userPostsRelTo: _UserPostsRelTo = 'Post';

// Storage bridge literal types preserved
type _UserTable = _UserModel['storage']['table'];
const _userTable: _UserTable = 'user';

type _UserNameColumn = _UserModel['storage']['fields']['name']['column'];
const _userNameColumn: _UserNameColumn = 'display_name';

// Storage hash literal preserved (carried by TStorage, not a Contract generic)
type _StorageHash = EmittedContract['storage']['storageHash'];
const _storageHash: _StorageHash = 'sha256:abc123' as StorageHashBase<'sha256:abc123'>;

// Storage table literal types preserved
type _UserIdNativeType = EmittedContract['storage']['tables']['user']['columns']['id']['nativeType'];
const _userIdNativeType: _UserIdNativeType = 'int4';

type _PostFK = EmittedContract['storage']['tables']['post']['foreignKeys'][0]['references']['table'];
const _postFK: _PostFK = 'user';

// Roots accessible
type _Roots = EmittedContract['roots'];

// ============================================================================
// §7  Compatibility proofs (existing types)
// ============================================================================

// --- SqlStorage extends StorageBase ---
type _AssertSqlStorageExtendsBase = SqlStorage extends StorageBase ? true : never;
const _assertSqlStorageExtendsBase: _AssertSqlStorageExtendsBase = true;

// --- MongoStorage extends StorageBase ---
type _AssertMongoStorageExtendsBase = MongoStorage extends StorageBase ? true : never;
const _assertMongoStorageExtendsBase: _AssertMongoStorageExtendsBase = true;

// --- ContractModel<SqlModelStorage> extends ContractModel ---
type _AssertSqlModelExtendsBase =
  ContractModel<SqlModelStorage> extends ContractModel ? true : never;
const _assertSqlModelExtendsBase: _AssertSqlModelExtendsBase = true;

// --- ContractModel<MongoModelStorage> extends ContractModel ---
type _AssertMongoModelExtendsBase =
  ContractModel<MongoModelStorage> extends ContractModel ? true : never;
const _assertMongoModelExtendsBase: _AssertMongoModelExtendsBase = true;

// --- SqlContract extends Contract ---
type _AssertSqlContractExtendsContract = SqlContract extends Contract ? true : never;
const _assertSqlContractExtendsContract: _AssertSqlContractExtendsContract = true;

// --- MongoContract extends Contract ---
type _AssertMongoContractExtendsContract = MongoContract extends Contract ? true : never;
const _assertMongoContractExtendsContract: _AssertMongoContractExtendsContract = true;

// --- EmittedContract extends SqlContract ---
type _AssertEmittedExtendsSql = EmittedContract extends SqlContract ? true : never;
const _assertEmittedExtendsSql: _AssertEmittedExtendsSql = true;

// --- EmittedContract extends Contract ---
type _AssertEmittedExtendsContract = EmittedContract extends Contract ? true : never;
const _assertEmittedExtendsContract: _AssertEmittedExtendsContract = true;

// --- DomainModel alias is ContractModel ---
type _AssertDomainModelIsContractModel = DomainModel extends ContractModel ? true : never;
const _assertDomainModelIsContractModel: _AssertDomainModelIsContractModel = true;
type _AssertContractModelIsDomainModel = ContractModel extends DomainModel ? true : never;
const _assertContractModelIsDomainModel: _AssertContractModelIsDomainModel = true;

// ============================================================================
// §8  Framework consumer proof
// ============================================================================
//
// Framework code operates on Contract (opaque storage). SQL code operates
// on SqlContract (typed storage). The emitted type satisfies both.

function _frameworkConsumer(contract: Contract): string[] {
  return Object.entries(contract.models).map(([name, model]) => {
    const fieldCount = Object.keys(model.fields).length;
    const relationCount = Object.keys(model.relations).length;
    return `${name}: ${fieldCount} fields, ${relationCount} relations`;
  });
}

function _sqlConsumer(contract: SqlContract): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [modelName, model] of Object.entries(contract.models)) {
    result[modelName] = model.storage.table;
  }
  return result;
}

function _sqlFieldColumnConsumer(contract: SqlContract): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  for (const [modelName, model] of Object.entries(contract.models)) {
    result[modelName] = {};
    for (const [fieldName, fieldStorage] of Object.entries(model.storage.fields)) {
      result[modelName][fieldName] = fieldStorage.column;
    }
  }
  return result;
}

// Emitted contract passes to both framework and SQL consumers
function _emittedContractConsumer(contract: EmittedContract): void {
  _frameworkConsumer(contract);
  _sqlConsumer(contract);
  _sqlFieldColumnConsumer(contract);
}

// With known keys, TypeScript preserves literal access
function _literalAccessConsumer(contract: EmittedContract): void {
  const userTable: 'user' = contract.models.User.storage.table;
  const userEmail: 'email' = contract.models.User.storage.fields.email.column;
  const postCodecId: 'pg/int4@1' = contract.models.Post.fields.id.codecId;
  const userIdNativeType: 'int4' = contract.storage.tables.user.columns.id.nativeType;
  const postFKRef: 'user' = contract.storage.tables.post.foreignKeys[0].references.table;
  void userTable;
  void userEmail;
  void postCodecId;
  void userIdNativeType;
  void postFKRef;
}

// ============================================================================
// §9  Validation design
// ============================================================================

type StorageValidator = (contract: Contract) => void;

declare function validateContract<TContract extends Contract>(
  value: unknown,
  storageValidator: StorageValidator,
): TContract;

// SQL family provides its storage validator
const _sqlStorageValidator: StorageValidator = (_contract) => {
  // validates tables, columns, FK consistency, PK validation, etc.
};

// Mongo family provides its storage validator
const _mongoStorageValidator: StorageValidator = (_contract) => {
  // validates collections, embedding constraints, owner consistency, etc.
};

// Usage: SQL
const _sqlResult = validateContract<EmittedContract>(
  {} as unknown,
  _sqlStorageValidator,
);
// Result has full literal types
const _validatedUserTable: 'user' = _sqlResult.models.User.storage.table;
void _validatedUserTable;

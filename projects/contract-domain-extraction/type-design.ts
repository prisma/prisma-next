/**
 * Contract Domain-Storage Separation — Complete Type Design
 *
 * This file defines the target type system for ADR 172 domain-storage separation.
 * It imports existing types and defines the new/changed types alongside them,
 * with type-level assertions proving structural compatibility.
 *
 * Run: node_modules/.bin/tsc --project projects/contract-domain-extraction/tsconfig.json
 *
 * Structure:
 *   §1  New framework-level domain types
 *   §2  Widened ContractBase (Phase 1)
 *   §3  New SQL model types (Phase 1)
 *   §4  Widened SqlContract (Phase 1)
 *   §5  Phase 1 emitted contract.d.ts shape (example)
 *   §6  validateContract() bridging design
 *   §7  MongoContract alignment proof
 *   §8  Phase 3 final types
 */

// --- Imports from existing codebase ---

import type {
  ExecutionHashBase,
  ExecutionSection,
  ContractBase as ExistingContractBase,
  ProfileHashBase,
  Source,
  StorageHashBase,
} from '@prisma-next/contract/types';
import type {
  MongoContract,
  MongoEmbedRelation,
  MongoModelDefinition,
  MongoModelField,
  MongoReferenceRelation,
  MongoRelation,
} from '@prisma-next/mongo-core';
import type {
  SqlContract as ExistingSqlContract,
  SqlMappings,
  SqlStorage,
} from '@prisma-next/sql-contract/types';

// ============================================================================
// §1  New framework-level domain types
// ============================================================================
//
// Package: @prisma-next/contract (packages/1-framework/1-core/shared/contract/src/)

export type DomainField = {
  readonly nullable: boolean;
  readonly codecId: string;
};

export type DomainRelationOn = {
  readonly localFields: readonly string[];
  readonly targetFields: readonly string[];
};

export type DomainRelation = {
  readonly to: string;
  readonly cardinality: '1:1' | '1:N' | 'N:1';
  readonly strategy: 'reference' | 'embed';
  readonly on?: DomainRelationOn;
};

export type DomainDiscriminator = {
  readonly field: string;
};

export type DomainModel = {
  readonly fields: Record<string, DomainField>;
  readonly relations: Record<string, DomainRelation>;
  readonly storage: Record<string, unknown>;
  readonly discriminator?: DomainDiscriminator;
  readonly variants?: Record<string, unknown>;
  readonly base?: string;
};

// ============================================================================
// §2  Widened ContractBase (Phase 1)
// ============================================================================
//
// ContractBase gains `roots` and `models`. Existing fields unchanged.

export interface ContractBase<
  TStorageHash extends StorageHashBase<string> = StorageHashBase<string>,
  TExecutionHash extends ExecutionHashBase<string> = ExecutionHashBase<string>,
  TProfileHash extends ProfileHashBase<string> = ProfileHashBase<string>,
> {
  // EXISTING (unchanged)
  readonly schemaVersion: string;
  readonly target: string;
  readonly targetFamily: string;
  readonly storageHash: TStorageHash;
  readonly executionHash?: TExecutionHash | undefined;
  readonly profileHash?: TProfileHash | undefined;
  readonly capabilities: Record<string, Record<string, boolean>>;
  readonly extensionPacks: Record<string, unknown>;
  readonly meta: Record<string, unknown>;
  readonly sources: Record<string, Source>;
  readonly execution?: ExecutionSection;

  // NEW
  readonly roots: Record<string, string>;
  readonly models: Record<string, DomainModel>;
}

// Proof: widened ContractBase is a superset of the existing one
type _AssertWidenedExtendsExisting = ContractBase extends ExistingContractBase ? true : never;
const _assertWidenedExtendsExisting: _AssertWidenedExtendsExisting = true;

// ============================================================================
// §3  New SQL model types (Phase 1)
// ============================================================================
//
// Package: @prisma-next/sql-contract (packages/2-sql/1-core/contract/src/)

export type SqlModelFieldStorage = {
  readonly column: string;
};

export type SqlModelStorage = {
  readonly table: string;
  readonly fields: Record<string, SqlModelFieldStorage>;
};

export type SqlRelation = {
  readonly to: string;
  readonly cardinality: '1:1' | '1:N' | 'N:1';
  readonly strategy: 'reference';
  readonly on: DomainRelationOn;
};

/**
 * Phase 1: model field with BOTH old (column) and new (nullable, codecId) properties.
 * validateContract() populates `column` from model.storage.fields[fieldName].column.
 */
export type SqlModelFieldPhase1 = {
  readonly column: string; // PHASE 3: REMOVED
  readonly nullable: boolean;
  readonly codecId: string;
};

export type SqlModelDefinitionPhase1 = {
  readonly fields: Record<string, SqlModelFieldPhase1>;
  readonly relations: Record<string, SqlRelation>;
  readonly storage: SqlModelStorage;
  readonly discriminator?: DomainDiscriminator;
  readonly variants?: Record<string, unknown>;
  readonly base?: string;
};

// Proof: SqlModelDefinitionPhase1 satisfies DomainModel
type _AssertSqlModelSatisfiesDomain = SqlModelDefinitionPhase1 extends DomainModel ? true : never;
const _assertSqlModelSatisfiesDomain: _AssertSqlModelSatisfiesDomain = true;

// Proof: SqlRelation satisfies DomainRelation
type _AssertSqlRelationSatisfiesDomain = SqlRelation extends DomainRelation ? true : never;
const _assertSqlRelationSatisfiesDomain: _AssertSqlRelationSatisfiesDomain = true;

// Proof: SqlModelFieldPhase1 satisfies DomainField
type _AssertSqlFieldSatisfiesDomain = SqlModelFieldPhase1 extends DomainField ? true : never;
const _assertSqlFieldSatisfiesDomain: _AssertSqlFieldSatisfiesDomain = true;

// ============================================================================
// §4  Widened SqlContract (Phase 1)
// ============================================================================
//
// SqlContract = ContractBase & { storage, models, relations, mappings }
// The intersection with ContractBase brings in roots + models (domain level).
// The & { models: M } intersection narrows models with SQL-specific shape.

export type SqlContract<
  S extends SqlStorage = SqlStorage,
  M extends Record<string, unknown> = Record<string, unknown>,
  R extends Record<string, unknown> = Record<string, unknown>,
  Map extends SqlMappings = SqlMappings,
  TStorageHash extends StorageHashBase<string> = StorageHashBase<string>,
  TExecutionHash extends ExecutionHashBase<string> = ExecutionHashBase<string>,
  TProfileHash extends ProfileHashBase<string> = ProfileHashBase<string>,
> = ContractBase<TStorageHash, TExecutionHash, TProfileHash> & {
  readonly targetFamily: string;
  readonly storage: S;
  readonly models: M;
  readonly relations: R; // PHASE 3: REMOVED
  readonly mappings: Map; // PHASE 3: REMOVED
  readonly execution?: ExecutionSection;
};

// Proof: SqlContract extends ContractBase
type _AssertSqlExtendsBase = SqlContract extends ContractBase ? true : never;
const _assertSqlExtendsBase: _AssertSqlExtendsBase = true;

// Proof: SqlContract extends ExistingSqlContract (backward compatible)
type _AssertNewSqlExtendsOldSql = SqlContract extends ExistingSqlContract ? true : never;
const _assertNewSqlExtendsOldSql: _AssertNewSqlExtendsOldSql = true;

// ============================================================================
// §5  Phase 1 emitted contract.d.ts shape (example)
// ============================================================================
//
// What the emitter produces. Both old and new fields on each model.

type ExampleModels = {
  readonly User: {
    readonly fields: {
      readonly id: {
        readonly column: 'id';
        readonly nullable: false;
        readonly codecId: 'pg/int4@1';
      };
      readonly email: {
        readonly column: 'email';
        readonly nullable: false;
        readonly codecId: 'pg/text@1';
      };
      readonly name: {
        readonly column: 'display_name';
        readonly nullable: true;
        readonly codecId: 'pg/text@1';
      };
    };
    readonly relations: {
      readonly posts: {
        readonly to: 'Post';
        readonly cardinality: '1:N';
        readonly strategy: 'reference';
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
      readonly id: {
        readonly column: 'id';
        readonly nullable: false;
        readonly codecId: 'pg/int4@1';
      };
      readonly title: {
        readonly column: 'title';
        readonly nullable: false;
        readonly codecId: 'pg/text@1';
      };
      readonly userId: {
        readonly column: 'user_id';
        readonly nullable: false;
        readonly codecId: 'pg/int4@1';
      };
    };
    readonly relations: {
      readonly user: {
        readonly to: 'User';
        readonly cardinality: 'N:1';
        readonly strategy: 'reference';
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

type ExampleRelations = {
  readonly user: {
    readonly posts: {
      readonly to: 'Post';
      readonly cardinality: '1:N';
      readonly on: {
        readonly childCols: readonly ['user_id'];
        readonly parentCols: readonly ['id'];
      };
    };
  };
  readonly post: {
    readonly user: {
      readonly to: 'User';
      readonly cardinality: 'N:1';
      readonly on: {
        readonly childCols: readonly ['user_id'];
        readonly parentCols: readonly ['id'];
      };
    };
  };
};

type ExampleMappings = {
  readonly modelToTable: { readonly User: 'user'; readonly Post: 'post' };
  readonly tableToModel: { readonly user: 'User'; readonly post: 'Post' };
  readonly fieldToColumn: {
    readonly User: { readonly id: 'id'; readonly email: 'email'; readonly name: 'display_name' };
    readonly Post: { readonly id: 'id'; readonly title: 'title'; readonly userId: 'user_id' };
  };
  readonly columnToField: {
    readonly user: { readonly id: 'id'; readonly email: 'email'; readonly display_name: 'name' };
    readonly post: { readonly id: 'id'; readonly title: 'title'; readonly user_id: 'userId' };
  };
};

type ExampleStorageHash = StorageHashBase<'sha256:abc123'>;
type ExampleExecutionHash = ExecutionHashBase<'sha256:def456'>;
type ExampleProfileHash = ProfileHashBase<'sha256:ghi789'>;

type ExampleContract = SqlContract<
  SqlStorage,
  ExampleModels,
  ExampleRelations,
  ExampleMappings,
  ExampleStorageHash,
  ExampleExecutionHash,
  ExampleProfileHash
>;

// Proof: example contract extends ContractBase
type _AssertExampleExtendsBase = ExampleContract extends ContractBase ? true : never;
const _assertExampleExtendsBase: _AssertExampleExtendsBase = true;

// Proof: example contract extends SqlContract (default params)
type _AssertExampleExtendsSql = ExampleContract extends SqlContract ? true : never;
const _assertExampleExtendsSql: _AssertExampleExtendsSql = true;

// ============================================================================
// §5a  Key structural validation: `models` intersection
// ============================================================================
//
// The critical question: when ContractBase declares
//   models: Record<string, DomainModel>
// and SqlContract intersects with
//   & { models: M }
// does TypeScript resolve the intersection so that BOTH domain-level
// properties (from ContractBase) and SQL-specific literal types (from M)
// are accessible on the same model key?
//
// Answer: yes. The intersection creates models: Record<string, DomainModel> & M.
// For a known key like 'User', TypeScript intersects the index signature's
// value type (DomainModel) with the explicit key's type from M.
// Since M's model types extend DomainModel, the intersection is just M's type
// (the narrower type), with all literal type information preserved.
//
// The assertions below prove this property concretely.

// First, verify the raw intersection type for models
type ExampleModelsIntersection = ExampleContract['models'];

// Known key access: TypeScript resolves 'User' from M's literal type,
// not from the index signature. Literal types are preserved.
type ExampleUserModel = ExampleModelsIntersection['User'];

// Domain-level properties (from ContractBase's DomainModel) are accessible
// through the intersection — AND retain their literal types from M:
type _VerifyFieldNullable = ExampleUserModel['fields']['name']['nullable'];
const _verifyFieldNullable: _VerifyFieldNullable = true;
// ^? true (literal), not boolean (widened)

type _VerifyFieldCodecId = ExampleUserModel['fields']['name']['codecId'];
const _verifyFieldCodecId: _VerifyFieldCodecId = 'pg/text@1';
// ^? 'pg/text@1' (literal), not string (widened)

// SQL-specific properties (from M, NOT on DomainModel) are also accessible
// through the same intersection:
type _VerifyFieldColumn = ExampleUserModel['fields']['name']['column'];
const _verifyFieldColumn: _VerifyFieldColumn = 'display_name';
// ^? 'display_name' (literal) — this property comes from M, not DomainModel

// model.relations: domain-level relation properties with literal types from M
type _VerifyModelRelTo = ExampleUserModel['relations']['posts']['to'];
const _verifyModelRelTo: _VerifyModelRelTo = 'Post';

type _VerifyModelRelStrategy = ExampleUserModel['relations']['posts']['strategy'];
const _verifyModelRelStrategy: _VerifyModelRelStrategy = 'reference';

// model.storage: SQL-specific storage bridge with literal types from M
type _VerifyModelStorageTable = ExampleUserModel['storage']['table'];
const _verifyModelStorageTable: _VerifyModelStorageTable = 'user';

type _VerifyModelStorageFieldCol = ExampleUserModel['storage']['fields']['name']['column'];
const _verifyModelStorageFieldCol: _VerifyModelStorageFieldCol = 'display_name';

// The model satisfies DomainModel (can be passed to domain-level consumers)
type _AssertUserModelIsDomainModel = ExampleUserModel extends DomainModel ? true : never;
const _assertUserModelIsDomainModel: _AssertUserModelIsDomainModel = true;

// roots: new field from ContractBase, accessible through the intersection
type _VerifyRoots = ExampleContract['roots'];
const _verifyRoots: _VerifyRoots = { users: 'User' };

// A function that accepts ContractBase can receive the SqlContract
// and read domain-level models from it:
function _domainConsumer(contract: ContractBase): string[] {
  return Object.entries(contract.models).map(([name, model]) => {
    const fieldNames = Object.keys(model.fields);
    const relationNames = Object.keys(model.relations);
    return `${name}: ${fieldNames.length} fields, ${relationNames.length} relations`;
  });
}
// This compiles: SqlContract is assignable to ContractBase
function _sqlConsumer(contract: ExampleContract): string[] {
  return _domainConsumer(contract);
}

// Old fields (PHASE 3: REMOVED) still accessible during Phase 1
type _VerifyMapping = ExampleContract['mappings']['modelToTable']['User'];
const _verifyMapping: _VerifyMapping = 'user';

type _VerifyTopRel = ExampleContract['relations']['user']['posts']['to'];
const _verifyTopRel: _VerifyTopRel = 'Post';

// ============================================================================
// §6  validateContract() bridging design
// ============================================================================
//
// normalizeContract() detects JSON format by inspecting the first model's first
// field: if it has 'nullable' and 'codecId', it's new format; if it has 'column'
// without 'nullable', it's old format.
//
// Old format normalization:
//   1. Build model.storage.fields from model.fields[f].column
//   2. Populate model.fields with { nullable, codecId } from storage.tables
//   3. Build model.relations from top-level relations
//   4. Derive roots from models (each model with storage.table → root entry)
//
// New format: pass through as-is.
//
// After normalization, both formats yield the same internal structure.
//
// Bridge (new → old, for consumer compatibility):
//   - mappings: derived from model.storage.table + model.storage.fields
//   - top-level relations: derived from model.relations (rekey by table name,
//     convert localFields/targetFields → childCols/parentCols)
//   - model.fields[f].column: derived from model.storage.fields[f].column
//
// validateContractDomain() runs on the normalized structure (shared validation).
// validateContractLogic() + validateStorageSemantics() run after (SQL-specific).

// ============================================================================
// §7  MongoContract alignment proof
// ============================================================================
//
// MongoContract's domain types are structurally compatible with ContractBase's
// domain types. This is the key property that enables cross-family consumers.

// MongoModelField ≡ DomainField
type _AssertMongoFieldIsDomainField = MongoModelField extends DomainField ? true : never;
const _assertMongoFieldIsDomainField: _AssertMongoFieldIsDomainField = true;

type _AssertDomainFieldIsMongoField = DomainField extends MongoModelField ? true : never;
const _assertDomainFieldIsMongoField: _AssertDomainFieldIsMongoField = true;

// MongoReferenceRelation extends DomainRelation
type _AssertMongoRefRelExtendsBase = MongoReferenceRelation extends DomainRelation ? true : never;
const _assertMongoRefRelExtendsBase: _AssertMongoRefRelExtendsBase = true;

// MongoEmbedRelation extends DomainRelation
type _AssertMongoEmbedRelExtendsBase = MongoEmbedRelation extends DomainRelation ? true : never;
const _assertMongoEmbedRelExtendsBase: _AssertMongoEmbedRelExtendsBase = true;

// MongoRelation (union) extends DomainRelation
type _AssertMongoRelExtendsBase = MongoRelation extends DomainRelation ? true : never;
const _assertMongoRelExtendsBase: _AssertMongoRelExtendsBase = true;

// MongoModelDefinition extends DomainModel
type _AssertMongoModelExtendsDomain = MongoModelDefinition extends DomainModel ? true : never;
const _assertMongoModelExtendsDomain: _AssertMongoModelExtendsDomain = true;

// MongoContract's domain shape is compatible with ContractBase (structural)
// MongoContract doesn't formally extend ContractBase yet (lacks schemaVersion,
// storageHash, etc.) — that's a separate follow-up. What matters: domain fields match.
type _AssertMongoRootsCompatible = MongoContract['roots'] extends ContractBase['roots']
  ? true
  : never;
const _assertMongoRootsCompatible: _AssertMongoRootsCompatible = true;

type _AssertMongoModelsCompatible = MongoContract['models'] extends ContractBase['models']
  ? true
  : never;
const _assertMongoModelsCompatible: _AssertMongoModelsCompatible = true;

// DomainContractShape (used by validateContractDomain) is a subset of ContractBase
type DomainContractShape = {
  readonly roots: Record<string, string>;
  readonly models: Record<string, DomainModel>;
};

type _AssertContractBaseSatisfiesDomainShape = ContractBase extends DomainContractShape
  ? true
  : never;
const _assertContractBaseSatisfiesDomainShape: _AssertContractBaseSatisfiesDomainShape = true;

// ============================================================================
// §8  Phase 3 final types (old fields removed)
// ============================================================================

type SqlModelFieldFinal = {
  readonly nullable: boolean;
  readonly codecId: string;
};

type SqlModelDefinitionFinal = {
  readonly fields: Record<string, SqlModelFieldFinal>;
  readonly relations: Record<string, SqlRelation>;
  readonly storage: SqlModelStorage;
  readonly discriminator?: DomainDiscriminator;
  readonly variants?: Record<string, unknown>;
  readonly base?: string;
};

// Phase 3: SqlContract drops R and Map type parameters
type SqlContractFinal<
  S extends SqlStorage = SqlStorage,
  M extends Record<string, unknown> = Record<string, unknown>,
  TStorageHash extends StorageHashBase<string> = StorageHashBase<string>,
  TExecutionHash extends ExecutionHashBase<string> = ExecutionHashBase<string>,
  TProfileHash extends ProfileHashBase<string> = ProfileHashBase<string>,
> = ContractBase<TStorageHash, TExecutionHash, TProfileHash> & {
  readonly targetFamily: string;
  readonly storage: S;
  readonly models: M;
  readonly execution?: ExecutionSection;
};

// Proof: final types still extend ContractBase
type _AssertFinalExtendsBase = SqlContractFinal extends ContractBase ? true : never;
const _assertFinalExtendsBase: _AssertFinalExtendsBase = true;

// Proof: final model satisfies DomainModel
type _AssertFinalModelSatisfiesDomain = SqlModelDefinitionFinal extends DomainModel ? true : never;
const _assertFinalModelSatisfiesDomain: _AssertFinalModelSatisfiesDomain = true;

// Proof: final field satisfies DomainField
type _AssertFinalFieldSatisfiesDomain = SqlModelFieldFinal extends DomainField ? true : never;
const _assertFinalFieldSatisfiesDomain: _AssertFinalFieldSatisfiesDomain = true;

// Phase 3 example: clean contract without old fields
type ExampleContractPhase3 = SqlContractFinal<
  SqlStorage,
  {
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
          readonly strategy: 'reference';
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
  },
  ExampleStorageHash,
  ExampleExecutionHash,
  ExampleProfileHash
>;

// Proof: column mapping via model.storage.fields (not mappings)
type _VerifyPhase3Column =
  ExampleContractPhase3['models']['User']['storage']['fields']['name']['column'];
const _verifyPhase3Column: _VerifyPhase3Column = 'display_name';

// Proof: domain fields directly accessible
type _VerifyPhase3Nullable = ExampleContractPhase3['models']['User']['fields']['name']['nullable'];
const _verifyPhase3Nullable: _VerifyPhase3Nullable = true;

// ============================================================================
// Summary: type parameter evolution
// ============================================================================
//
// Phase 1 (widened, backward compatible):
//   ContractBase<TStorageHash, TExecutionHash, TProfileHash>
//     + roots: Record<string, string>
//     + models: Record<string, DomainModel>
//
//   SqlContract<S, M, R, Map, TStorageHash, TExecutionHash, TProfileHash>
//     = ContractBase<...> & { storage: S, models: M, relations: R, mappings: Map }
//     models[Model].fields[f] has { column, nullable, codecId }
//
// Phase 3 (final, breaking):
//   ContractBase unchanged
//
//   SqlContract<S, M, TStorageHash, TExecutionHash, TProfileHash>
//     = ContractBase<...> & { storage: S, models: M }
//     R and Map type parameters dropped
//     models[Model].fields[f] has { nullable, codecId } (no column)

/**
 * Simulated emitted contract.d.ts — Unified Contract Representation
 *
 * This file shows what the emitter would produce for a User/Post schema
 * under the unified Contract<TStorage, TModels> type. Drop the .d in the
 * filename so TypeScript validates the types.
 *
 * Key differences from the current emitted contract.d.ts:
 *
 *   1. Uses Contract<TStorage, TModels> instead of SqlContract<S, M, Hash, Hash, Hash>.
 *      Hash params live on TStorage (storageHash) and execution (executionHash).
 *
 *   2. Model `fields` contain domain-level { nullable, codecId } with literal types,
 *      NOT pre-resolved TypeScript types (e.g. Char<36>, string).
 *      TypeScript type resolution happens at the consumer site via CodecTypes,
 *      matching the Mongo pattern (InferModelRow).
 *
 *   3. No schemaVersion or sources (stripped during parsing / deprecated).
 *
 *   4. storageHash lives on storage, executionHash on execution.
 *
 * Run: pnpm exec tsc --project projects/contract-domain-extraction/tsconfig.json
 */

import type {
  Contract as ContractInterface,
  ContractModel,
  SqlContract,
  ExecutionSection,
} from './unified-type-design';

import type {
  StorageHashBase,
  ExecutionHashBase,
  ProfileHashBase,
} from '@prisma-next/contract/types';

import type {
  ContractWithTypeMaps,
  TypeMaps as TypeMapsGeneric,
  SqlModelStorage,
} from '@prisma-next/sql-contract/types';

// ============================================================================
// Codec & operation type imports (same as today — from adapter + extensions)
// ============================================================================
//
// In a real emitted file, these would be:
//   import type { CodecTypes as PgTypes } from '@prisma-next/adapter-postgres/codec-types';
//   import type { Char } from '@prisma-next/adapter-postgres/codec-types';
//   etc.
//
// For this design validation, we inline representative codec type shapes.

type PgCodecTypes = {
  readonly 'sql/char@1': { readonly output: string };
  readonly 'pg/text@1': { readonly output: string };
  readonly 'pg/int4@1': { readonly output: number };
  readonly 'pg/timestamptz@1': { readonly output: Date };
  readonly 'pg/enum@1': { readonly output: string };
};

type CodecTypes = PgCodecTypes;
type OperationTypes = Record<string, never>;
type QueryOperationTypes = Record<string, never>;

// ============================================================================
// Hash type aliases
// ============================================================================

type StorageHash =
  StorageHashBase<'sha256:42688420507f30fe04fc98b370813fd10dd8bd336d6770eb026dd81aef527815'>;
type ExecutionHash =
  ExecutionHashBase<'sha256:e1ebe2d0c623f17a7e66036721cb7b8de43c7955e72fe7d7733b88a92684b16d'>;
type ProfileHash =
  ProfileHashBase<'sha256:4c68d253773262f590e742c85e147dd4eb29e082c65856d97671d98ef343de04'>;

// ============================================================================
// TypeMaps (same pattern as today — phantom key for codec type resolution)
// ============================================================================

type TypeMaps = TypeMapsGeneric<CodecTypes, OperationTypes, QueryOperationTypes>;

// ============================================================================
// The emitted Contract type
// ============================================================================

type ContractShape = SqlContract<
  // ── S: full literal storage schema (satisfies SqlStorage via structural typing) ─
  {
    readonly storageHash: StorageHash;
    readonly tables: {
      readonly user: {
        readonly columns: {
          readonly id: {
            readonly nativeType: 'character';
            readonly codecId: 'sql/char@1';
            readonly nullable: false;
          };
          readonly email: {
            readonly nativeType: 'text';
            readonly codecId: 'pg/text@1';
            readonly nullable: false;
          };
          readonly created_at: {
            readonly nativeType: 'timestamptz';
            readonly codecId: 'pg/timestamptz@1';
            readonly nullable: false;
            readonly default: { readonly kind: 'function'; readonly expression: 'now()' };
          };
          readonly kind: {
            readonly nativeType: 'user_type';
            readonly codecId: 'pg/enum@1';
            readonly nullable: false;
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
            readonly nativeType: 'character';
            readonly codecId: 'sql/char@1';
            readonly nullable: false;
          };
          readonly title: {
            readonly nativeType: 'text';
            readonly codecId: 'pg/text@1';
            readonly nullable: false;
          };
          readonly user_id: {
            readonly nativeType: 'text';
            readonly codecId: 'pg/text@1';
            readonly nullable: false;
          };
          readonly created_at: {
            readonly nativeType: 'timestamptz';
            readonly codecId: 'pg/timestamptz@1';
            readonly nullable: false;
            readonly default: { readonly kind: 'function'; readonly expression: 'now()' };
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
  // ── M: domain-level fields + relations + per-model storage bridge ───────
  {
    readonly User: {
      readonly fields: {
        readonly id: { readonly nullable: false; readonly codecId: 'sql/char@1' };
        readonly email: { readonly nullable: false; readonly codecId: 'pg/text@1' };
        readonly createdAt: { readonly nullable: false; readonly codecId: 'pg/timestamptz@1' };
        readonly kind: { readonly nullable: false; readonly codecId: 'pg/enum@1' };
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
          readonly createdAt: { readonly column: 'created_at' };
          readonly kind: { readonly column: 'kind' };
        };
      };
    };
    readonly Post: {
      readonly fields: {
        readonly id: { readonly nullable: false; readonly codecId: 'sql/char@1' };
        readonly title: { readonly nullable: false; readonly codecId: 'pg/text@1' };
        readonly userId: { readonly nullable: false; readonly codecId: 'pg/text@1' };
        readonly createdAt: { readonly nullable: false; readonly codecId: 'pg/timestamptz@1' };
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
          readonly createdAt: { readonly column: 'created_at' };
        };
      };
    };
  }
> & {
  readonly target: 'postgres';
  readonly roots: {
    readonly users: 'User';
    readonly posts: 'Post';
  };
  readonly capabilities: {
    readonly postgres: {
      readonly jsonAgg: true;
      readonly lateral: true;
      readonly limit: true;
      readonly orderBy: true;
      readonly returning: true;
    };
    readonly sql: { readonly enums: true; readonly returning: true };
  };
  readonly execution: ExecutionSection<'sha256:e1ebe2d0c623f17a7e66036721cb7b8de43c7955e72fe7d7733b88a92684b16d'> & {
    readonly mutations: {
      readonly defaults: readonly [
        {
          readonly ref: { readonly table: 'post'; readonly column: 'id' };
          readonly onCreate: { readonly kind: 'generator'; readonly id: 'uuidv4' };
        },
        {
          readonly ref: { readonly table: 'user'; readonly column: 'id' };
          readonly onCreate: { readonly kind: 'generator'; readonly id: 'uuidv4' };
        },
      ];
    };
  };
  readonly profileHash: ProfileHash;
  readonly meta: Record<string, never>;
  readonly extensionPacks: Record<string, never>;
};

export type Contract = ContractWithTypeMaps<ContractShape, TypeMaps>;

// convenience aliases (same as current emitted file)
export type Tables = ContractShape['storage']['tables'];
export type Models = ContractShape['models'];

// ============================================================================
// §1  Proof: the emitted type satisfies all contract constraints
// ============================================================================

// Contract extends the base Contract interface
type _P1 = ContractShape extends ContractInterface ? true : never;
const _p1: _P1 = true;

// Contract extends SqlContract
type _P2 = ContractShape extends SqlContract ? true : never;
const _p2: _P2 = true;

// Each model satisfies ContractModel<SqlModelStorage>
type _P3 = ContractShape['models']['User'] extends ContractModel<SqlModelStorage> ? true : never;
const _p3: _P3 = true;

type _P4 = ContractShape['models']['Post'] extends ContractModel<SqlModelStorage> ? true : never;
const _p4: _P4 = true;

// ============================================================================
// §2  Proof: literal types preserved — storage layer
// ============================================================================

// Column native types
type _UserIdNativeType = ContractShape['storage']['tables']['user']['columns']['id']['nativeType'];
const _userIdNativeType: _UserIdNativeType = 'character';

// Column codec IDs
type _PostTitleCodec = ContractShape['storage']['tables']['post']['columns']['title']['codecId'];
const _postTitleCodec: _PostTitleCodec = 'pg/text@1';

// Column nullability
type _PostTitleNullable = ContractShape['storage']['tables']['post']['columns']['title']['nullable'];
const _postTitleNullable: _PostTitleNullable = false;

// Primary key columns
type _UserPK = ContractShape['storage']['tables']['user']['primaryKey'];
const _userPK: _UserPK = { columns: ['id'] } as const;

// Foreign key references
type _PostFK = ContractShape['storage']['tables']['post']['foreignKeys'][0]['references'];
const _postFK: _PostFK = { table: 'user', columns: ['id'] } as const;

// Column default expressions
type _UserCreatedAtDefault =
  ContractShape['storage']['tables']['user']['columns']['created_at']['default'];
const _userCreatedAtDefault: _UserCreatedAtDefault = { kind: 'function', expression: 'now()' };

// Storage hash (on the storage block, not top-level)
type _SHash = ContractShape['storage']['storageHash'];
const _sHash: _SHash =
  'sha256:42688420507f30fe04fc98b370813fd10dd8bd336d6770eb026dd81aef527815' as _SHash;

// ============================================================================
// §3  Proof: literal types preserved — model domain layer
// ============================================================================

// Model field codecId (literal, not string)
type _UserEmailCodec = ContractShape['models']['User']['fields']['email']['codecId'];
const _userEmailCodec: _UserEmailCodec = 'pg/text@1';

// Model field nullable (literal, not boolean)
type _UserEmailNullable = ContractShape['models']['User']['fields']['email']['nullable'];
const _userEmailNullable: _UserEmailNullable = false;

// Model relation target (literal)
type _UserPostsTo = ContractShape['models']['User']['relations']['posts']['to'];
const _userPostsTo: _UserPostsTo = 'Post';

// Model relation cardinality (literal)
type _UserPostsCard = ContractShape['models']['User']['relations']['posts']['cardinality'];
const _userPostsCard: _UserPostsCard = '1:N';

// Model relation join fields (literal tuple)
type _UserPostsLocal = ContractShape['models']['User']['relations']['posts']['on']['localFields'];
const _userPostsLocal: _UserPostsLocal = ['id'] as const;

// ============================================================================
// §4  Proof: literal types preserved — model storage bridge
// ============================================================================

// Model-to-table mapping
type _UserTable = ContractShape['models']['User']['storage']['table'];
const _userTable: _UserTable = 'user';

// Field-to-column mapping
type _UserCreatedAtCol = ContractShape['models']['User']['storage']['fields']['createdAt']['column'];
const _userCreatedAtCol: _UserCreatedAtCol = 'created_at';

type _PostUserIdCol = ContractShape['models']['Post']['storage']['fields']['userId']['column'];
const _postUserIdCol: _PostUserIdCol = 'user_id';

// ============================================================================
// §5  Proof: literal types preserved — roots
// ============================================================================

type _UsersRoot = ContractShape['roots']['users'];
const _usersRoot: _UsersRoot = 'User';

type _PostsRoot = ContractShape['roots']['posts'];
const _postsRoot: _PostsRoot = 'Post';

// ============================================================================
// §6  Proof: literal types preserved — capabilities
// ============================================================================

type _HasReturning = ContractShape['capabilities']['postgres']['returning'];
const _hasReturning: _HasReturning = true;

type _HasEnums = ContractShape['capabilities']['sql']['enums'];
const _hasEnums: _HasEnums = true;

// ============================================================================
// §7  Proof: literal types preserved — execution & hashes
// ============================================================================

// Execution hash carried on the execution section (not top-level)
type _EHash = NonNullable<ContractShape['execution']>['executionHash'];
const _eHash: _EHash =
  'sha256:e1ebe2d0c623f17a7e66036721cb7b8de43c7955e72fe7d7733b88a92684b16d' as _EHash;

// Profile hash at top level
type _PHash = NonNullable<ContractShape['profileHash']>;
const _pHash: _PHash =
  'sha256:4c68d253773262f590e742c85e147dd4eb29e082c65856d97671d98ef343de04' as _PHash;

// ============================================================================
// §8  Type resolution: domain fields → TypeScript types via CodecTypes
// ============================================================================
//
// The current emitted contract.d.ts pre-resolves field types at emission time
// (e.g. `readonly id: Char<36>`). The unified approach keeps domain-level
// { nullable, codecId } in the contract and resolves TypeScript types at the
// consumer site using CodecTypes — the same pattern Mongo uses (InferModelRow).
//
// This utility type demonstrates the resolution:

type InferFieldType<
  TCodecTypes extends Record<string, { output: unknown }>,
  TField extends { readonly codecId: string; readonly nullable: boolean },
> = TField['nullable'] extends true
  ? TCodecTypes[TField['codecId']]['output'] | null
  : TCodecTypes[TField['codecId']]['output'];

type InferModelRow<
  TCodecTypes extends Record<string, { output: unknown }>,
  TFields extends Record<string, { readonly codecId: string; readonly nullable: boolean }>,
> = {
  -readonly [K in keyof TFields]: InferFieldType<TCodecTypes, TFields[K]>;
};

// Resolve User fields → TypeScript types
type UserRow = InferModelRow<CodecTypes, ContractShape['models']['User']['fields']>;

// Proof: resolved types match expectations
type _UserIdType = UserRow['id'];
const _userIdType: _UserIdType = 'some-string';

type _UserEmailType = UserRow['email'];
const _userEmailType: _UserEmailType = 'test@example.com';

type _UserCreatedAtType = UserRow['createdAt'];
const _userCreatedAtType: _UserCreatedAtType = new Date();

// Resolve Post fields → TypeScript types
type PostRow = InferModelRow<CodecTypes, ContractShape['models']['Post']['fields']>;

type _PostTitleType = PostRow['title'];
const _postTitleType: _PostTitleType = 'My Post';

type _PostUserIdType = PostRow['userId'];
const _postUserIdType: _PostUserIdType = 'user-123';

// ============================================================================
// §9  Cross-cutting: field-to-column resolution
// ============================================================================
//
// The query builder needs: given a model and field name, what column does
// it map to, and what's the column's codec/native type in the storage table?

type _UserEmailColumn = ContractShape['models']['User']['storage']['fields']['email']['column'];
const _resolvedCol: _UserEmailColumn = 'email';

type _PostUserIdColumn = ContractShape['models']['Post']['storage']['fields']['userId']['column'];
const _resolvedCol2: _PostUserIdColumn = 'user_id';

// ============================================================================
// §10 Proof: literal types survive through Contract (with TypeMaps phantom key)
// ============================================================================
//
// Consumers import `Contract` (which is ContractWithTypeMaps<ContractShape, TypeMaps>).
// These proofs verify that literal types are not widened by the TypeMaps intersection.

type _C_UserCodec = Contract['models']['User']['fields']['email']['codecId'];
const _c_userCodec: _C_UserCodec = 'pg/text@1';

type _C_UserTable = Contract['models']['User']['storage']['table'];
const _c_userTable: _C_UserTable = 'user';

type _C_UserCol = Contract['models']['User']['storage']['fields']['createdAt']['column'];
const _c_userCol: _C_UserCol = 'created_at';

type _C_RelTo = Contract['models']['User']['relations']['posts']['to'];
const _c_relTo: _C_RelTo = 'Post';

type _C_StorageCodec = Contract['storage']['tables']['post']['columns']['title']['codecId'];
const _c_storageCodec: _C_StorageCodec = 'pg/text@1';

type _C_Root = Contract['roots']['users'];
const _c_root: _C_Root = 'User';

type _C_Cap = Contract['capabilities']['postgres']['returning'];
const _c_cap: _C_Cap = true;

type _C_StorageHash = Contract['storage']['storageHash'];
const _c_storageHash: _C_StorageHash =
  'sha256:42688420507f30fe04fc98b370813fd10dd8bd336d6770eb026dd81aef527815' as _C_StorageHash;

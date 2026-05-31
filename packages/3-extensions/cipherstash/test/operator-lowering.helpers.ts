/**
 * Shared scaffolding for the `operator-lowering*.test.ts` files.
 *
 * The cipherstash operator-lowering tests all use the same:
 *   - Postgres runtime adapter composed with the cipherstash runtime
 *     descriptor (so `cipherstash/*@1` codecs are resolvable at
 *     lower-time and `renderTypedParam` can emit
 *     `$N::eql_v2_encrypted`).
 *   - Contract scaffold with one row of per-codec columns on a `user`
 *     table so trait-dispatched operators can be exercised against
 *     each codec.
 *   - Operator-invocation glue (`getOperator`, `callOperator`,
 *     `columnAccessor`, `selectWithWhere`).
 *
 * The lowering shape is verified against the stack-composed Postgres
 * runtime adapter (the helper at `packages/3-targets/6-adapters/
 * postgres/test/helpers/composed-adapter.ts` reproduced inline so
 * cipherstash does not pick up a postgres-package test export
 * dependency) loaded with the cipherstash runtime descriptor. The
 * adapter's `lower` is what the runtime's encode pipeline calls before
 * driver execution; pinning its output is the strongest unit-level
 * assurance available without standing up a real Postgres + EQL
 * bundle.
 */

import postgresRuntimeAdapter from '@prisma-next/adapter-postgres/runtime';
import type { PostgresContract } from '@prisma-next/adapter-postgres/types';
import { SqlContractSerializer } from '@prisma-next/family-sql/ir';
import type {
  RuntimeExtensionDescriptor,
  RuntimeTargetDescriptor,
} from '@prisma-next/framework-components/execution';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type { SqlOperationDescriptor } from '@prisma-next/sql-operations';
import {
  type AnyExpression,
  ColumnRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@prisma-next/sql-relational-core/ast';
import { vi } from 'vitest';
import { cipherstashQueryOperations } from '../src/execution/operators';
import type { CipherstashSdk } from '../src/execution/sdk';
import { createCipherstashRuntimeDescriptor } from '../src/exports/runtime';
import {
  CIPHERSTASH_BIGINT_CODEC_ID,
  CIPHERSTASH_BOOLEAN_CODEC_ID,
  CIPHERSTASH_DATE_CODEC_ID,
  CIPHERSTASH_DOUBLE_CODEC_ID,
  CIPHERSTASH_JSON_CODEC_ID,
  CIPHERSTASH_STRING_CODEC_ID,
  EQL_V2_ENCRYPTED_TYPE,
} from '../src/extension-metadata/constants';

// Minimal SDK stub. Operator lowering doesn't talk to the SDK — the codec
// captures it lazily for the read-side decrypt path — but
// `createCipherstashRuntimeDescriptor({ sdk })` requires one.
export function emptySdk(): CipherstashSdk {
  return {
    decrypt: vi.fn(),
    bulkEncrypt: vi.fn(),
    bulkDecrypt: vi.fn(),
  };
}

export const TABLE = 'user';
export const COLUMN = 'email';

export const contract = new SqlContractSerializer().deserializeContract({
  target: 'postgres',
  targetFamily: 'sql',
  profileHash: 'sha256:cipherstash-operator-lowering-test',
  roots: {},
  capabilities: {},
  extensionPacks: {},
  meta: {},
  storage: {
    storageHash: 'sha256:cipherstash-operator-lowering-test-storage',
    [UNBOUND_NAMESPACE_ID]: {
      id: UNBOUND_NAMESPACE_ID,
      tables: {
        [TABLE]: {
          columns: {
            id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            [COLUMN]: {
              codecId: CIPHERSTASH_STRING_CODEC_ID,
              nativeType: EQL_V2_ENCRYPTED_TYPE,
              nullable: true,
            },
            // Per-codec columns so the trait-dispatched operators
            // can be exercised against each column type (the
            // postgres renderer reads `nativeType` from the codec
            // descriptor at lower time; the column is what gives
            // the renderer the codec id to look up).
            score: {
              codecId: CIPHERSTASH_DOUBLE_CODEC_ID,
              nativeType: EQL_V2_ENCRYPTED_TYPE,
              nullable: true,
            },
            amount: {
              codecId: CIPHERSTASH_BIGINT_CODEC_ID,
              nativeType: EQL_V2_ENCRYPTED_TYPE,
              nullable: true,
            },
            birthday: {
              codecId: CIPHERSTASH_DATE_CODEC_ID,
              nativeType: EQL_V2_ENCRYPTED_TYPE,
              nullable: true,
            },
            enabled: {
              codecId: CIPHERSTASH_BOOLEAN_CODEC_ID,
              nativeType: EQL_V2_ENCRYPTED_TYPE,
              nullable: true,
            },
            payload: {
              codecId: CIPHERSTASH_JSON_CODEC_ID,
              nativeType: EQL_V2_ENCRYPTED_TYPE,
              nullable: true,
            },
          },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    },
  },
  models: {},
}) as PostgresContract;

// Stub runtime target — the Postgres adapter only consults `familyId` /
// `targetId` on the target during `create`. Replicates the helper at
// `packages/3-targets/6-adapters/postgres/test/helpers/composed-adapter.ts`
// inline so cipherstash does not depend on a postgres-package test export.
const stubRuntimeTarget: RuntimeTargetDescriptor<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  version: '0.0.1',
  familyId: 'sql',
  targetId: 'postgres',
  create() {
    return { familyId: 'sql', targetId: 'postgres' };
  },
};

export function makeAdapter() {
  // Compose the Postgres runtime adapter with the cipherstash runtime
  // descriptor so the `cipherstash/string@1` codec is resolvable at
  // lower-time. `renderTypedParam` reads
  // `meta.db.sql.postgres.nativeType` off the registered codec to emit
  // `$N::eql_v2_encrypted`; without the cipherstash pack in the stack
  // the codec lookup would throw with a "missing extension pack" hint.
  const cipherstash: RuntimeExtensionDescriptor<'sql', 'postgres'> =
    createCipherstashRuntimeDescriptor({ sdk: emptySdk() });
  return postgresRuntimeAdapter.create({
    target: stubRuntimeTarget,
    adapter: postgresRuntimeAdapter,
    driver: undefined,
    extensionPacks: [cipherstash],
  });
}

const cipherstashOperatorsByMethod = cipherstashQueryOperations();

export function getOperator(method: string): SqlOperationDescriptor {
  const op = cipherstashOperatorsByMethod[method];
  if (!op) {
    throw new Error(`cipherstash operator descriptor for method "${method}" not found`);
  }
  return op;
}

/**
 * Invoke an operator's `impl` and return the produced AST node. The
 * impl's declared return type is the framework's `QueryOperationReturn`
 * (intentionally narrow — `sql-contract` does not depend on
 * `relational-core`); the practical shape every `buildOperation`-built
 * impl returns is `Expression<...>` whose `buildAst()` yields an
 * `AnyExpression`. Mirrors the cast in
 * `packages/3-extensions/sql-orm-client/src/model-accessor.ts:170`.
 */
export function callOperator(op: SqlOperationDescriptor, ...args: unknown[]): AnyExpression {
  // `op.impl` is typed `(...args: never[]) => QueryOperationReturn` to
  // block accidental direct invocation; the practical shape is
  // `(self, ...args) => Expression<...>`. Cast through `unknown` to
  // bridge the framework's intentionally-narrow declared type.
  const impl = op.impl as unknown as (...args: unknown[]) => { buildAst(): AnyExpression };
  return impl(...args).buildAst();
}

/**
 * Build the same `Expression`-like shape the ORM model accessor
 * synthesises for a column field (see
 * `packages/3-extensions/sql-orm-client/src/model-accessor.ts:139-150`):
 * an object with `buildAst()` returning the underlying `ColumnRef` plus
 * the column's return type metadata. The operator impls call
 * `toExpr(self)` which destructures `buildAst()` to get the AST node.
 */
export function columnAccessor(
  table: string,
  column: string,
  codecId: string = CIPHERSTASH_STRING_CODEC_ID,
) {
  const ref = ColumnRef.of(table, column);
  return {
    returnType: { codecId, nullable: true },
    buildAst: () => ref,
  };
}

export function selectWithWhere(whereExpr: AnyExpression) {
  return SelectAst.from(TableSource.named(TABLE))
    .withProjection([ProjectionItem.of('id', ColumnRef.of(TABLE, 'id'))])
    .withWhere(whereExpr);
}

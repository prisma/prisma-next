// Migration / DDL coverage for the synthesised implicit-many-to-many junction.
//
// `mn-psl-implicit` authors `Post.tags Tag[]` / `Tag.posts Post[]` as two bare
// navigable list ends with NO junction model, so the interpreter synthesises a
// model-less junction `_PostToTag` (composite PK `(A, B)`, FK `A` → `posts.id`,
// FK `B` → `tags.id`). The junction is a normal contract storage table, so the
// migration system creates it like any other table — no special-casing. These
// tests drive the real migration planner over the real emitted contracts (one
// per target) against an empty schema and assert the synthesised junction's
// `CREATE TABLE` (with its composite primary key and the two foreign keys) is
// planned for both postgres and sqlite.
//
// Deserializing the emitted JSON runs the full sql contract validation pipeline,
// so a contract that failed to round-trip validation would throw at module load.

import {
  createPostgresBuiltinCodecLookup,
  PostgresControlAdapter,
} from '@prisma-next/adapter-postgres/control';
import {
  createSqliteBuiltinCodecLookup,
  SqliteControlAdapter,
} from '@prisma-next/adapter-sqlite/control';
import {
  INIT_ADDITIVE_POLICY,
  type SqlMigrationPlanOperation,
} from '@prisma-next/family-sql/control';
import { APP_SPACE_ID } from '@prisma-next/framework-components/control';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { createPostgresMigrationPlanner } from '@prisma-next/target-postgres/planner';
import { PostgresContractSerializer } from '@prisma-next/target-postgres/runtime';
import {
  PostgresDatabaseSchemaNode,
  PostgresNamespaceSchemaNode,
} from '@prisma-next/target-postgres/types';
import { createSqliteMigrationPlanner } from '@prisma-next/target-sqlite/planner';
import { SqliteContractSerializer } from '@prisma-next/target-sqlite/runtime';
import { describe, expect, it } from 'vitest';
import type { Contract as ImplicitPgContract } from './fixtures/mn-psl-implicit/generated/contract';
import implicitPgContractJson from './fixtures/mn-psl-implicit/generated/contract.json' with {
  type: 'json',
};
import type { Contract as ImplicitSqliteContract } from './fixtures/mn-psl-implicit/generated-sqlite/contract';
import implicitSqliteContractJson from './fixtures/mn-psl-implicit/generated-sqlite/contract.json' with {
  type: 'json',
};

const implicitPgContract = new PostgresContractSerializer().deserializeContract(
  implicitPgContractJson,
) as ImplicitPgContract;

const implicitSqliteContract = new SqliteContractSerializer().deserializeContract(
  implicitSqliteContractJson,
) as ImplicitSqliteContract;

const emptySchema: SqlSchemaIR = { tables: {} };

const emptyPostgresSchema = new PostgresDatabaseSchemaNode({
  namespaces: {
    public: new PostgresNamespaceSchemaNode({
      schemaName: 'public',
      tables: {},
      nativeEnumTypeNames: [],
    }),
  },
  roles: [],
  existingSchemas: [],
  pgVersion: '',
});

describe('integration/mn-psl-implicit-migration', () => {
  it('postgres migration plans CREATE TABLE for the synthesised _PostToTag junction with composite PK', async () => {
    const planner = createPostgresMigrationPlanner(
      new PostgresControlAdapter(createPostgresBuiltinCodecLookup()),
    );

    const result = planner.plan({
      contract: implicitPgContract,
      schema: emptyPostgresSchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
    });
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') throw new Error('expected planner success');
    const ops = (await Promise.all(result.plan.operations)) as SqlMigrationPlanOperation<unknown>[];

    const createJunction = ops.find((op) => op.id === 'table._PostToTag');
    expect(createJunction).toBeDefined();
    expect(createJunction!.execute[0]!.sql).toBe(
      'CREATE TABLE "public"."_PostToTag" (\n' +
        '  "A" int4 NOT NULL,\n' +
        '  "B" text NOT NULL,\n' +
        '  PRIMARY KEY ("A", "B")\n' +
        ')',
    );

    const fkA = ops.find((op) => op.id === 'foreignKey._PostToTag._PostToTag_A_fkey');
    const fkB = ops.find((op) => op.id === 'foreignKey._PostToTag._PostToTag_B_fkey');
    expect(fkA).toBeDefined();
    expect(fkB).toBeDefined();
    expect(fkA!.execute.map((step) => step.sql).join('\n')).toContain(
      'FOREIGN KEY ("A")\nREFERENCES "public"."posts" ("id")',
    );
    expect(fkB!.execute.map((step) => step.sql).join('\n')).toContain(
      'FOREIGN KEY ("B")\nREFERENCES "public"."tags" ("id")',
    );
  });

  it('sqlite migration plans CREATE TABLE for the synthesised _PostToTag junction with composite PK and inline foreign keys', async () => {
    const planner = createSqliteMigrationPlanner(
      new SqliteControlAdapter(createSqliteBuiltinCodecLookup()),
    );

    const result = planner.plan({
      contract: implicitSqliteContract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
    });
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') throw new Error('expected planner success');
    const ops = (await Promise.all(result.plan.operations)) as SqlMigrationPlanOperation<unknown>[];

    const createJunction = ops.find((op) => op.id === 'table._PostToTag');
    expect(createJunction).toBeDefined();
    expect(createJunction!.execute[0]!.sql).toBe(
      'CREATE TABLE "_PostToTag" (\n' +
        '  "A" INTEGER NOT NULL,\n' +
        '  "B" TEXT NOT NULL,\n' +
        '  PRIMARY KEY ("A", "B"),\n' +
        '  FOREIGN KEY ("A") REFERENCES "posts" ("id"),\n' +
        '  FOREIGN KEY ("B") REFERENCES "tags" ("id")\n' +
        ')',
    );
  });
});

import type { Contract } from '@prisma-next/contract/types';
import { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import { collectScalarTypeConstructors } from '@prisma-next/framework-components/authoring';
import {
  APP_SPACE_ID,
  assembleAuthoringContributions,
} from '@prisma-next/framework-components/control';
import { buildSymbolTable } from '@prisma-next/psl-parser';
import { parse } from '@prisma-next/psl-parser/syntax';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { interpretPslDocumentToSqlContract } from '@prisma-next/sql-contract-psl';
import type { SqlSchemaIRNode } from '@prisma-next/sql-schema-ir/types';
import {
  PostgresDatabaseSchemaNode,
  postgresCreateNamespace,
} from '@prisma-next/target-postgres/types';
import { describe, expect, it } from 'vitest';
import { postgresScalarAuthoringTypes } from '../../src/core/control-mutation-defaults';
import {
  controlAdapter,
  frameworkComponents,
  postgresTargetDescriptor,
} from './fixtures/runner-fixtures';

// `migration plan` runs offline (no live database): it derives the schema from
// the contract via the target's `contractToSchema` hook and plans against it.
// That derivation carries the contract's RLS policies, so the plan emits
// ENABLE ROW LEVEL SECURITY + CREATE POLICY.

const PSL = `
namespace public {
  model profile {
    id       Int @id
    owner_id Int

    @@rls
  }

  policy_select p_read {
    target = profile
    roles  = [app_user]
    using  = "owner_id = current_setting('app.uid')::int"
  }
}
`;

// A `policy_update` with both predicates — proves the contract → plan → render
// path threads `withCheck` through for a non-select operation.
const PSL_UPDATE = `
namespace public {
  model profile {
    id       Int @id
    owner_id Int

    @@rls
  }

  policy_update p_write {
    target    = profile
    roles     = [app_user]
    using     = "owner_id = current_setting('app.uid')::int"
    withCheck = "owner_id = current_setting('app.uid')::int"
  }
}
`;

function buildScalarTypeDescriptors(): ReadonlyMap<
  string,
  { codecId: string; nativeType: string }
> {
  return collectScalarTypeConstructors(postgresScalarAuthoringTypes);
}

function buildPslContract(psl: string = PSL) {
  const assembled = assembleAuthoringContributions([postgresTargetDescriptor]);
  const scalarColumnDescriptors = buildScalarTypeDescriptors();

  const { document, sourceFile } = parse(psl);
  const { table: symbolTable } = buildSymbolTable({
    document,
    sourceFile,
    scalarTypes: [...scalarColumnDescriptors.keys()],
    pslBlockDescriptors: assembled.pslBlockDescriptors,
  });

  return interpretPslDocumentToSqlContract({
    symbolTable,
    sourceFile,
    sourceId: 'schema.prisma',
    target: {
      kind: 'target' as const,
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
      id: 'postgres',
      version: postgresTargetDescriptor.version,
      capabilities: {},
      defaultNamespaceId: 'public',
    },
    scalarColumnDescriptors,
    authoringContributions: assembled,
    composedExtensionContracts: new Map(),
    createNamespace: postgresCreateNamespace,
    capabilities: { sql: { scalarList: true } },
  });
}

describe('migration plan emits RLS (offline, no live database)', () => {
  it('derives a PostgresDatabaseSchemaNode from the contract and plans CREATE POLICY + ENABLE RLS', async () => {
    const result = buildPslContract();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const contract = result.value as Contract<SqlStorage>;

    // The initial `migration plan` derives the "from" schema from a null
    // contract (no prior state) — an empty PostgresDatabaseSchemaNode. The differ
    // then reports the contract's policy as missing → CREATE POLICY.
    const fromSchema = postgresTargetDescriptor.migrations.contractToSchema(
      null,
      frameworkComponents,
    ) as SqlSchemaIRNode;
    PostgresDatabaseSchemaNode.assert(fromSchema);
    expect(fromSchema).toBeInstanceOf(PostgresDatabaseSchemaNode);
    const allPolicies = Object.values(fromSchema.namespaces).flatMap((ns) =>
      Object.values(ns.tables).flatMap((t) => t.policies),
    );
    expect(allPolicies).toEqual([]);

    const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
    const planResult = planner.plan({
      contract,
      schema: fromSchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
    });

    expect(planResult.kind).toBe('success');
    if (planResult.kind !== 'success') return;

    const ops = await Promise.all(planResult.plan.operations);
    const allSql = ops
      .flatMap((op) => [...op.precheck, ...op.execute, ...op.postcheck])
      .map((step) => step.sql);

    expect(allSql.some((s) => s.includes('ENABLE ROW LEVEL SECURITY'))).toBe(true);
    expect(allSql.some((s) => s.includes('CREATE POLICY'))).toBe(true);
  });

  it('plans FOR UPDATE with both USING and WITH CHECK for a policy_update contract', async () => {
    const result = buildPslContract(PSL_UPDATE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const contract = result.value as Contract<SqlStorage>;
    const fromSchema = postgresTargetDescriptor.migrations.contractToSchema(
      null,
      frameworkComponents,
    ) as SqlSchemaIRNode;
    PostgresDatabaseSchemaNode.assert(fromSchema);

    const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
    const planResult = planner.plan({
      contract,
      schema: fromSchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
    });

    expect(planResult.kind).toBe('success');
    if (planResult.kind !== 'success') return;

    const ops = await Promise.all(planResult.plan.operations);
    const createPolicySql = ops
      .flatMap((op) => op.execute)
      .map((step) => step.sql)
      .find((s) => s.includes('CREATE POLICY'));

    expect(createPolicySql).toBeDefined();
    expect(createPolicySql).toContain('FOR UPDATE');
    expect(createPolicySql).toContain("USING (owner_id = current_setting('app.uid')::int)");
    expect(createPolicySql).toContain("WITH CHECK (owner_id = current_setting('app.uid')::int)");
    // USING must precede WITH CHECK.
    expect(createPolicySql!.indexOf('USING')).toBeLessThan(createPolicySql!.indexOf('WITH CHECK'));
  });
});

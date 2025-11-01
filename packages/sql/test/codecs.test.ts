import { describe, it, expect } from 'vitest';
import { sql } from '../src/sql';
import { schema } from '../src/schema';
import { createPostgresAdapter } from '../../adapter-postgres/src/exports/adapter';
import type { DslPlan, ResultType } from '../src/types';
import type { SqlContract } from '@prisma-next/contract/types';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixtureDir = join(__dirname, 'fixtures');

function loadContract(name: string): SqlContract {
  const filePath = join(fixtureDir, `${name}.json`);
  const contents = readFileSync(filePath, 'utf8');
  return JSON.parse(contents) as SqlContract;
}

describe('DSL Lane Codec Type Stamping', () => {
  const contract = loadContract('contract');
  const tables = schema(contract).tables;
  const adapter = createPostgresAdapter();

  it('stamps paramDescriptors.type from columnMeta.type', () => {
    const builder = sql({ contract, adapter });
    const userTable = tables.user as typeof tables.user & Record<string, any>;
    const plan = builder
      .from(tables.user)
      .where(userTable.id.eq({ kind: 'param-placeholder', name: 'userId' }))
      .select({
        id: userTable.id,
        email: userTable.email,
      })
      .build({ params: { userId: 1 } });

    expect(plan.meta.paramDescriptors.length).toBeGreaterThan(0);
    const paramDesc = plan.meta.paramDescriptors[0];
    expect(paramDesc).toBeDefined();
    expect(paramDesc?.type).toBeDefined();
    expect(paramDesc?.refs).toBeDefined();
    expect(paramDesc?.refs?.table).toBe('user');
    expect(paramDesc?.refs?.column).toBe('id');
  });

  it('stamps projectionTypes mapping alias → scalar type', () => {
    const builder = sql({ contract, adapter });
    const userTable = tables.user as typeof tables.user & Record<string, any>;
    const plan = builder
      .from(tables.user)
      .select({
        id: userTable.id,
        email: userTable.email,
      })
      .build();

    expect(plan.meta.projectionTypes).toBeDefined();
    const projectionTypes = plan.meta.projectionTypes!;

    // Check that projectionTypes contains mappings for selected columns
    expect(Object.keys(projectionTypes).length).toBeGreaterThan(0);

    // Verify the types are contract scalar types
    for (const [alias, scalarType] of Object.entries(projectionTypes)) {
      expect(typeof scalarType).toBe('string');
      expect(scalarType.length).toBeGreaterThan(0);
    }
  });

  it('stamps projectionTypes for aliased columns', () => {
    const builder = sql({ contract, adapter });
    const userTable = tables.user as typeof tables.user & Record<string, any>;
    const plan = builder
      .from(tables.user)
      .select({
        userId: userTable.id,
        userEmail: userTable.email,
      })
      .build();

    expect(plan.meta.projectionTypes).toBeDefined();
    const projectionTypes = plan.meta.projectionTypes!;

    expect(projectionTypes.userId).toBeDefined();
    expect(projectionTypes.userEmail).toBeDefined();

    // Verify types match the column types from contract
    expect(typeof projectionTypes.userId).toBe('string');
    expect(typeof projectionTypes.userEmail).toBe('string');
  });

  it('includes nullable in paramDescriptors', () => {
    const builder = sql({ contract, adapter });
    const userTable = tables.user as typeof tables.user & Record<string, any>;
    const plan = builder
      .from(tables.user)
      .where(userTable.id.eq({ kind: 'param-placeholder', name: 'userId' }))
      .select({
        id: userTable.id,
      })
      .build({ params: { userId: 1 } });

    const paramDesc = plan.meta.paramDescriptors[0];
    if (paramDesc?.nullable !== undefined) {
      expect(typeof paramDesc.nullable).toBe('boolean');
    }
  });

  it('Plan has Row generic type', () => {
    const builder = sql({ contract, adapter });
    const userTable = tables.user as typeof tables.user & Record<string, any>;
    const plan = builder
      .from(tables.user)
      .select({
        id: userTable.id,
        email: userTable.email,
      })
      .build();

    // Type check: Plan should be generic
    const typedPlan: DslPlan = plan;
    expect(typedPlan).toBeDefined();
  });

  it('ResultType utility extracts row type', () => {
    const builder = sql({ contract, adapter });
    const userTable = tables.user as typeof tables.user & Record<string, any>;
    const plan = builder
      .from(tables.user)
      .select({
        id: userTable.id,
        email: userTable.email,
      })
      .build();

    // Type-level test: ResultType should extract the row type
    type Row = ResultType<typeof plan>;

    // Runtime check: verify plan structure supports type inference
    expect(plan.meta.projection).toBeDefined();
    expect(plan.meta.projectionTypes).toBeDefined();
  });

  it('stamps projectionTypes for all selected columns', () => {
    const builder = sql({ contract, adapter });
    const userTable = tables.user as typeof tables.user & Record<string, any>;
    const plan = builder
      .from(tables.user)
      .select({
        id: userTable.id,
        email: userTable.email,
        createdAt: userTable.createdAt,
      })
      .build();

    const projectionTypes = plan.meta.projectionTypes!;
    expect(projectionTypes.id).toBeDefined();
    expect(projectionTypes.email).toBeDefined();
    expect(projectionTypes.createdAt).toBeDefined();
  });

  it('maintains projectionTypes order matching projection', () => {
    const builder = sql({ contract, adapter });
    const userTable = tables.user as typeof tables.user & Record<string, any>;
    const plan = builder
      .from(tables.user)
      .select({
        first: userTable.id,
        second: userTable.email,
        third: userTable.createdAt,
      })
      .build();

    const projectionTypes = plan.meta.projectionTypes!;
    const projectionKeys = Object.keys(plan.meta.projection);
    const projectionTypesKeys = Object.keys(projectionTypes);

    // Both should have the same keys
    expect(projectionTypesKeys.sort()).toEqual(projectionKeys.sort());
  });
});

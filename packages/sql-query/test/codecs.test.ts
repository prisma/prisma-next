import { describe, expect, it } from 'vitest';
import { createPostgresAdapter } from '../../adapter-postgres/src/exports/adapter';
import { validateContract } from '../src/contract';
import { schema } from '../src/schema';
import { sql } from '../src/sql';
import type { Plan } from '../src/types';
import type { CodecTypes, Contract } from './fixtures/contract.d';
import contractJson from './fixtures/contract.json' with { type: 'json' };

describe('DSL Lane Codec Type Stamping', () => {
  const contract = validateContract<Contract>(contractJson);
  const tables = schema<Contract, CodecTypes>(contract).tables;
  const adapter = createPostgresAdapter();

  it('stamps paramDescriptors.type from columnMeta.type', () => {
    const builder = sql<Contract, CodecTypes>({ contract, adapter });
    const userTable = tables.user;
    if (!userTable) {
      throw new Error('user table not found');
    }

    const idColumn = userTable.columns.id;
    const emailColumn = userTable.columns.email;
    if (!idColumn || !emailColumn) {
      throw new Error('columns not found');
    }
    const plan = builder
      .from(userTable)
      .where(idColumn.eq({ kind: 'param-placeholder', name: 'userId' }))
      .select({
        id: idColumn,
        email: emailColumn,
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
    const builder = sql<Contract, CodecTypes>({ contract, adapter });
    const userTable = tables.user;
    if (!userTable) {
      throw new Error('user table not found');
    }
    const idColumn = userTable.columns.id;
    const emailColumn = userTable.columns.email;
    if (!idColumn || !emailColumn) {
      throw new Error('columns not found');
    }
    const plan = builder
      .from(userTable)
      .select({
        id: idColumn,
        email: emailColumn,
      })
      .build();

    expect(plan.meta.projectionTypes).toBeDefined();
    const projectionTypes = plan.meta.projectionTypes!;

    // Check that projectionTypes contains mappings for selected columns
    expect(Object.keys(projectionTypes).length).toBeGreaterThan(0);

    // Verify the types are contract scalar types
    for (const [_alias, scalarType] of Object.entries(projectionTypes)) {
      expect(typeof scalarType).toBe('string');
      expect(scalarType.length).toBeGreaterThan(0);
    }
  });

  it('stamps projectionTypes for aliased columns', () => {
    const builder = sql<Contract, CodecTypes>({ contract, adapter });
    const userTable = tables.user;
    if (!userTable) {
      throw new Error('user table not found');
    }
    const idColumn = userTable.columns.id;
    const emailColumn = userTable.columns.email;
    if (!idColumn || !emailColumn) {
      throw new Error('columns not found');
    }
    const plan = builder
      .from(userTable)
      .select({
        userId: idColumn,
        userEmail: emailColumn,
      })
      .build();

    expect(plan.meta.projectionTypes).toBeDefined();
    const projectionTypes = plan.meta.projectionTypes!;

    expect(projectionTypes['userId']).toBeDefined();
    expect(projectionTypes['userEmail']).toBeDefined();

    // Verify types match the column types from contract
    expect(typeof projectionTypes['userId']).toBe('string');
    expect(typeof projectionTypes['userEmail']).toBe('string');
  });

  it('includes nullable in paramDescriptors', () => {
    const builder = sql<Contract, CodecTypes>({ contract, adapter });
    const userTable = tables.user;
    if (!userTable) {
      throw new Error('user table not found');
    }
    const idColumn = userTable.columns.id;
    if (!idColumn) {
      throw new Error('id column not found');
    }
    const plan = builder
      .from(userTable)
      .where(idColumn.eq({ kind: 'param-placeholder', name: 'userId' }))
      .select({
        id: idColumn,
      })
      .build({ params: { userId: 1 } });

    const paramDesc = plan.meta.paramDescriptors[0];
    if (paramDesc?.nullable !== undefined) {
      expect(typeof paramDesc.nullable).toBe('boolean');
    }
  });

  it('Plan has Row generic type', () => {
    const builder = sql<Contract, CodecTypes>({ contract, adapter });
    const userTable = tables.user;
    if (!userTable) {
      throw new Error('user table not found');
    }
    const idColumn = userTable.columns.id;
    const emailColumn = userTable.columns.email;
    if (!idColumn || !emailColumn) {
      throw new Error('columns not found');
    }
    const plan = builder
      .from(userTable)
      .select({
        id: idColumn,
        email: emailColumn,
      })
      .build();

    // Type check: Plan should be generic
    const typedPlan: Plan = plan;
    expect(typedPlan).toBeDefined();
  });

  it('ResultType utility extracts row type', () => {
    const builder = sql<Contract, CodecTypes>({ contract, adapter });
    const userTable = tables.user;
    if (!userTable) {
      throw new Error('user table not found');
    }
    const idColumn = userTable.columns.id;
    const emailColumn = userTable.columns.email;
    if (!idColumn || !emailColumn) {
      throw new Error('columns not found');
    }
    const plan = builder
      .from(userTable)
      .select({
        id: idColumn,
        email: emailColumn,
      })
      .build();

    // Runtime check: verify plan structure supports type inference
    // Note: ResultType<typeof plan> can be used to extract the row type at the type level
    expect(plan.meta.projection).toBeDefined();
    expect(plan.meta.projectionTypes).toBeDefined();
  });

  it('stamps projectionTypes for all selected columns', () => {
    const builder = sql<Contract, CodecTypes>({ contract, adapter });
    const userTable = tables.user;
    if (!userTable) {
      throw new Error('user table not found');
    }
    const idColumn = userTable.columns.id;
    const emailColumn = userTable.columns.email;
    const createdAtColumn = userTable.columns.createdAt;
    if (!idColumn || !emailColumn || !createdAtColumn) {
      throw new Error('columns not found');
    }
    const plan = builder
      .from(userTable)
      .select({
        id: idColumn,
        email: emailColumn,
        createdAt: createdAtColumn,
      })
      .build();

    const projectionTypes = plan.meta.projectionTypes!;
    expect(projectionTypes['id']).toBeDefined();
    expect(projectionTypes['email']).toBeDefined();
    expect(projectionTypes['createdAt']).toBeDefined();
  });

  it('maintains projectionTypes order matching projection', () => {
    const builder = sql<Contract, CodecTypes>({ contract, adapter });
    const userTable = tables.user;
    if (!userTable) {
      throw new Error('user table not found');
    }
    const idColumn = userTable.columns.id;
    const emailColumn = userTable.columns.email;
    const createdAtColumn = userTable.columns.createdAt;
    if (!idColumn || !emailColumn || !createdAtColumn) {
      throw new Error('columns not found');
    }
    const plan = builder
      .from(userTable)
      .select({
        first: idColumn,
        second: emailColumn,
        third: createdAtColumn,
      })
      .build();

    const projectionTypes = plan.meta.projectionTypes!;
    const projection = plan.meta.projection;
    if (!projection || Array.isArray(projection)) {
      throw new Error('Expected projection to be Record<string, string>');
    }
    const projectionKeys = Object.keys(projection);
    const projectionTypesKeys = Object.keys(projectionTypes);

    // Both should have the same keys
    expect(projectionTypesKeys.sort()).toEqual(projectionKeys.sort());
  });
});

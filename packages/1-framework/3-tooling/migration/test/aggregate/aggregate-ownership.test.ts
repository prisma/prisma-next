import type { Contract } from '@prisma-next/contract/types';
import { createSqlContract } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { createContractSpaceAggregate } from '../../src/aggregate/aggregate';
import type { AggregateContractSpace, ContractSpaceAggregate } from '../../src/aggregate/types';
import { makeAggregateContractSpace } from '../fixtures';

function makeSpace(
  spaceId: string,
  namespaces: Record<string, { table?: Record<string, unknown> }>,
): AggregateContractSpace {
  return makeAggregateContractSpace({
    spaceId,
    contract: createSqlContract({
      target: 'postgres',
      storage: {
        namespaces: Object.fromEntries(
          Object.entries(namespaces).map(([id, entries]) => [id, { id, entries }]),
        ),
      },
    }) as Contract,
  });
}

function makeAggregate(
  app: AggregateContractSpace,
  extensions: AggregateContractSpace[],
): ContractSpaceAggregate {
  return createContractSpaceAggregate({
    targetId: 'postgres',
    app,
    extensions,
    checkIntegrity: () => [],
  });
}

// The migration planner consults the aggregate as a `SchemaOwnership` oracle:
// per live extra node it asks `declaresEntity` whether any space owns it, so a
// sibling-owned table is never dropped. These pin the aggregate side of that
// contract directly (the planner side is pinned by the target sibling-scoping
// suites driving `plan()` with the aggregate as the oracle).
describe('ContractSpaceAggregate ownership queries', () => {
  it('declaresEntity is true for a name any space declares, false otherwise', () => {
    const app = makeSpace('app', { public: { table: { app_user: {} } } });
    const cipher = makeSpace('cipherstash', { public: { table: { cipher_state: {} } } });
    const aggregate = makeAggregate(app, [cipher]);

    expect(aggregate.declaresEntity('app_user')).toBe(true);
    expect(aggregate.declaresEntity('cipher_state')).toBe(true);
    expect(aggregate.declaresEntity('orphan_table')).toBe(false);
  });

  it('declaresEntity answers across every space, not just the app', () => {
    const app = makeSpace('app', { public: { table: { app_user: {} } } });
    const cipher = makeSpace('cipherstash', { public: { table: { cipher_state: {} } } });
    const audit = makeSpace('audit', { public: { table: { audit_log: {} } } });
    const aggregate = makeAggregate(app, [cipher, audit]);

    expect(aggregate.declaresEntity('audit_log')).toBe(true);
    expect(aggregate.declaresEntity('nothing')).toBe(false);
  });

  it('a single-space aggregate only owns its own entities (the aggregate-of-one case)', () => {
    const app = makeSpace('app', { public: { table: { app_user: {} } } });
    const aggregate = makeAggregate(app, []);

    expect(aggregate.declaresEntity('app_user')).toBe(true);
    expect(aggregate.declaresEntity('cipher_state')).toBe(false);
  });

  it('declaringSpaces returns every space declaring the name', () => {
    const app = makeSpace('app', { public: { table: { app_user: {} } } });
    const cipher = makeSpace('cipherstash', { public: { table: { cipher_state: {} } } });
    const aggregate = makeAggregate(app, [cipher]);

    expect(aggregate.declaringSpaces('app_user')).toEqual(['app']);
    expect(aggregate.declaringSpaces('cipher_state')).toEqual(['cipherstash']);
    expect(aggregate.declaringSpaces('orphan_table')).toEqual([]);
  });
});

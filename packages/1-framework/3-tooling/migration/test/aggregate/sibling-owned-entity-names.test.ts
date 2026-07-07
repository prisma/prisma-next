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

describe('ContractSpaceAggregate.siblingOwnedEntityNames', () => {
  it('collects entity names declared by every OTHER space, never the queried space', () => {
    const app = makeSpace('app', { public: { table: { app_user: {} } } });
    const cipher = makeSpace('cipherstash', { public: { table: { cipher_state: {} } } });
    const aggregate = makeAggregate(app, [cipher]);

    expect([...aggregate.siblingOwnedEntityNames('app')]).toEqual(['cipher_state']);
    expect([...aggregate.siblingOwnedEntityNames('cipherstash')]).toEqual(['app_user']);
  });

  it('returns an empty set for a single-space aggregate', () => {
    const app = makeSpace('app', { public: { table: { app_user: {} } } });
    const aggregate = makeAggregate(app, []);

    expect(aggregate.siblingOwnedEntityNames('app').size).toBe(0);
  });

  it('unions names across every sibling when more than one other space exists', () => {
    const app = makeSpace('app', { public: { table: { app_user: {} } } });
    const cipher = makeSpace('cipherstash', { public: { table: { cipher_state: {} } } });
    const audit = makeSpace('audit', { public: { table: { audit_log: {} } } });
    const aggregate = makeAggregate(app, [cipher, audit]);

    expect([...aggregate.siblingOwnedEntityNames('app')].sort()).toEqual([
      'audit_log',
      'cipher_state',
    ]);
  });

  it('does not include a name the queried space ALSO declares, even if a sibling shares it', () => {
    // Two spaces declaring the same bare entity name is an integrity
    // violation elsewhere (checkIntegrity), but the ownership query itself
    // must still never call the queried space its own sibling.
    const app = makeSpace('app', { public: { table: { shared_name: {} } } });
    const ext = makeSpace('ext', { public: { table: { shared_name: {} } } });
    const aggregate = makeAggregate(app, [ext]);

    expect([...aggregate.siblingOwnedEntityNames('app')]).toEqual(['shared_name']);
  });
});

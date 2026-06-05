import type { Contract } from '@prisma-next/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { createSqlContract } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { createContractSpaceMember } from '../../src/aggregate/aggregate';
import type { IntegritySpaceState } from '../../src/aggregate/check-integrity';
import { computeIntegrityViolations } from '../../src/aggregate/check-integrity';
import { createAttestedPackage } from '../fixtures';

function contractWithTables(tables: readonly string[]): Contract {
  const tableEntries = Object.fromEntries(tables.map((name) => [name, { columns: { id: {} } }]));
  return createSqlContract({
    target: 'postgres',
    storage: {
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: { id: UNBOUND_NAMESPACE_ID, entries: { table: tableEntries } },
      },
    },
  });
}

function makeSpaceState(spaceId: string, contract: Contract, isApp = false): IntegritySpaceState {
  const member = createContractSpaceMember({
    spaceId,
    packages: [],
    refs: {},
    headRef: isApp ? { hash: contract.storage.storageHash, invariants: [] } : null,
    refsDir: '/tmp/refs',
    resolveContract: () => contract,
    deserializeContract: (raw) => raw as Contract,
  });
  return { member, problems: [], refProblems: [], headRefProblem: null, isApp };
}

describe('computeIntegrityViolations', () => {
  it('surfaces duplicateMigrationHash instead of throwing from graph()', () => {
    const sharedHash = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const first = createAttestedPackage('20260101T0000_first', { from: null, to: 'sha256:t1' });
    const second = createAttestedPackage('20260101T0000_second', {
      from: 'sha256:t1',
      to: 'sha256:t2',
    });
    const packages = [
      { ...first, metadata: { ...first.metadata, migrationHash: sharedHash } },
      { ...second, metadata: { ...second.metadata, migrationHash: sharedHash } },
    ];

    const member = createContractSpaceMember({
      spaceId: 'app',
      packages,
      refs: {},
      headRef: { hash: 'sha256:t2', invariants: [] },
      refsDir: '/tmp/refs',
      resolveContract: () => {
        throw new Error('unused in this test');
      },
      deserializeContract: (raw) => raw as Contract,
    });

    const state: IntegritySpaceState = {
      member,
      problems: [],
      refProblems: [],
      headRefProblem: null,
      isApp: true,
    };

    const violations = computeIntegrityViolations({ targetId: 'postgres', spaces: [state] });
    expect(violations).toContainEqual({
      kind: 'duplicateMigrationHash',
      spaceId: 'app',
      migrationHash: sharedHash,
      dirNames: ['20260101T0000_first', '20260101T0000_second'],
    });
    expect(() => member.graph()).not.toThrow();
  });

  describe('namespaceOwnershipCollision (checkContracts)', () => {
    it('reports a collision when two spaces claim the same (namespace, kind, name) primitive', () => {
      const app = makeSpaceState('app', contractWithTables(['users']), true);
      const ext = makeSpaceState('ext-auth', contractWithTables(['users']));

      const violations = computeIntegrityViolations(
        { targetId: 'postgres', spaces: [app, ext] },
        { checkContracts: true },
      );

      const collisions = violations.filter((v) => v.kind === 'namespaceOwnershipCollision');
      expect(collisions).toHaveLength(1);
      expect(collisions[0]).toMatchObject({
        kind: 'namespaceOwnershipCollision',
        namespace: UNBOUND_NAMESPACE_ID,
        name: 'users',
        contributorSpaceIds: expect.arrayContaining(['app', 'ext-auth']),
      });
    });

    it('does not report a collision when spaces claim different primitives in the same namespace', () => {
      const app = makeSpaceState('app', contractWithTables(['users']), true);
      const ext = makeSpaceState('ext-billing', contractWithTables(['invoices']));

      const violations = computeIntegrityViolations(
        { targetId: 'postgres', spaces: [app, ext] },
        { checkContracts: true },
      );

      expect(violations.filter((v) => v.kind === 'namespaceOwnershipCollision')).toHaveLength(0);
    });

    it('does not run the collision check without checkContracts', () => {
      const app = makeSpaceState('app', contractWithTables(['users']), true);
      const ext = makeSpaceState('ext-auth', contractWithTables(['users']));

      const violations = computeIntegrityViolations({ targetId: 'postgres', spaces: [app, ext] });

      expect(violations.filter((v) => v.kind === 'namespaceOwnershipCollision')).toHaveLength(0);
    });
  });

  it('rethrows when graph() fails for an unexpected reason', () => {
    // Give the member a package so packages.length > 0, which triggers the
    // graph-reachability check and therefore the graph() call.
    const pkg = createAttestedPackage('20260101T0000_init', { from: null, to: 'sha256:head' });
    const member = createContractSpaceMember({
      spaceId: 'ext',
      packages: [pkg],
      refs: {},
      headRef: { hash: 'sha256:head', invariants: [] },
      refsDir: '/tmp/refs',
      resolveContract: () => {
        throw new Error('unused');
      },
      deserializeContract: (raw) => raw as Contract,
    });
    const faultyMember = {
      ...member,
      graph() {
        throw new Error('engine fault');
      },
    };

    const state: IntegritySpaceState = {
      member: faultyMember,
      problems: [],
      refProblems: [],
      headRefProblem: null,
      isApp: false,
    };

    expect(() => computeIntegrityViolations({ targetId: 'postgres', spaces: [state] })).toThrow(
      'engine fault',
    );
  });
});

import type { Contract } from '@prisma-next/contract/types';
import { describe, expect, it } from 'vitest';
import { createContractSpaceMember } from '../../src/aggregate/aggregate';
import type { IntegritySpaceState } from '../../src/aggregate/check-integrity';
import { computeIntegrityViolations } from '../../src/aggregate/check-integrity';
import { createAttestedPackage } from '../fixtures';

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

import { createSqlContract } from '@prisma-next/contract/testing';
import { describe, expect, it } from 'vitest';
import { graphWalkStrategy } from '../../../src/aggregate/strategies/graph-walk';
import type { ContractSpaceMember } from '../../../src/aggregate/types';
import { EMPTY_CONTRACT_HASH } from '../../../src/constants';
import { reconstructGraph } from '../../../src/migration-graph';
import type { OnDiskMigrationPackage } from '../../../src/package';
import { createAttestedPackage } from '../../fixtures';

function makeMember(
  packages: readonly OnDiskMigrationPackage[],
  headHash: string,
): ContractSpaceMember {
  const graph =
    packages.length === 0
      ? {
          nodes: new Set<string>(),
          forwardChain: new Map(),
          reverseChain: new Map(),
          migrationByHash: new Map(),
        }
      : reconstructGraph(packages);
  return {
    spaceId: 'cipherstash',
    contract: createSqlContract({ target: 'postgres' }),
    headRef: { hash: headHash, invariants: [] },
    migrations: {
      graph,
      packagesByMigrationHash: new Map(packages.map((p) => [p.metadata.migrationHash, p])),
    },
  };
}

describe('graphWalkStrategy', () => {
  it('walks the shortest path from the live marker to the pinned head ref', () => {
    const headHash = 'sha256:cipher-head';
    const pkg = createAttestedPackage('20260101T0000_init', { from: null, to: headHash });

    const outcome = graphWalkStrategy({
      aggregateTargetId: 'postgres',
      member: makeMember([pkg], headHash),
      currentMarker: null,
    });

    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.result.plan.targetId).toBe('postgres');
    expect(outcome.result.plan.destination.storageHash).toBe(headHash);
    // origin null because no marker yet — runner skips origin validation.
    expect(outcome.result.plan.origin).toBe(null);
    expect(outcome.result.strategy).toBe('graph-walk');
  });

  it('returns unreachable when the live marker is not connected to the head', () => {
    const headHash = 'sha256:disconnected';
    // Single migration whose graph has only one node (EMPTY_CONTRACT_HASH → other-target).
    const pkg = createAttestedPackage('20260101T0000_init', {
      from: null,
      to: 'sha256:not-the-head',
    });

    const outcome = graphWalkStrategy({
      aggregateTargetId: 'postgres',
      member: makeMember([pkg], headHash),
      currentMarker: null,
    });

    expect(outcome.kind).toBe('unreachable');
  });

  it('returns unsatisfiable when the path does not cover required invariants', () => {
    // A package walking baseline → headHash but providing zero invariants.
    const headHash = 'sha256:cipher-head';
    const pkg = createAttestedPackage('20260101T0000_init', { from: null, to: headHash });
    const graph = reconstructGraph([pkg]);
    const member: ContractSpaceMember = {
      spaceId: 'cipherstash',
      contract: createSqlContract({ target: 'postgres' }),
      headRef: { hash: headHash, invariants: ['cipher:create-v1'] },
      migrations: {
        graph,
        packagesByMigrationHash: new Map([[pkg.metadata.migrationHash, pkg]]),
      },
    };

    const outcome = graphWalkStrategy({
      aggregateTargetId: 'postgres',
      member,
      currentMarker: null,
    });

    expect(outcome.kind).toBe('unsatisfiable');
    if (outcome.kind !== 'unsatisfiable') return;
    expect(outcome.missing).toEqual(['cipher:create-v1']);
  });

  it('returns ok with empty pathOps when the marker is already at the head ref', () => {
    const headHash = 'sha256:cipher-head';
    const pkg = createAttestedPackage('20260101T0000_init', { from: null, to: headHash });

    const outcome = graphWalkStrategy({
      aggregateTargetId: 'postgres',
      member: makeMember([pkg], headHash),
      currentMarker: { storageHash: headHash, invariants: [] },
    });

    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.result.plan.operations).toEqual([]);
    expect(outcome.result.plan.origin).toEqual({ storageHash: headHash });
  });

  it('throws an internal error when the graph references a package not in packagesByMigrationHash', () => {
    const headHash = 'sha256:cipher-head';
    const pkg = createAttestedPackage('20260101T0000_init', { from: null, to: headHash });
    const graph = reconstructGraph([pkg]);
    const member: ContractSpaceMember = {
      spaceId: 'cipherstash',
      contract: createSqlContract({ target: 'postgres' }),
      headRef: { hash: headHash, invariants: [] },
      migrations: {
        graph,
        // Empty map — out of sync with graph.
        packagesByMigrationHash: new Map(),
      },
    };

    expect(() =>
      graphWalkStrategy({
        aggregateTargetId: 'postgres',
        member,
        currentMarker: null,
      }),
    ).toThrow(/out of sync/);
  });

  it('handles the empty-graph + EMPTY_CONTRACT_HASH head ref + no invariants happy path', () => {
    // Graph is empty, head ref points at the empty-contract sentinel,
    // and the marker is also absent. findPathWithDecision returns ok
    // with an empty path because fromHash === toHash.
    const outcome = graphWalkStrategy({
      aggregateTargetId: 'postgres',
      member: makeMember([], EMPTY_CONTRACT_HASH),
      currentMarker: null,
    });

    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.result.plan.operations).toEqual([]);
  });
});

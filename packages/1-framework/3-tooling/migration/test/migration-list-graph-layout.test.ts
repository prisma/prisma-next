import { describe, expect, it } from 'vitest';
import {
  type ConnectorLayoutRow,
  computeMigrationListGraphLayout,
  type LayoutRow,
  type MigrationLayoutRow,
  type NodeLineLayoutRow,
} from '../src/migration-list-graph-layout';
import type { MigrationListEntry } from '../src/migration-list-types';

let hashCounter = 0;

function entry(
  dirName: string,
  from: string | null,
  to: string,
  migrationHash?: string,
): MigrationListEntry {
  return {
    dirName,
    from,
    to,
    migrationHash: migrationHash ?? `sha256:layout-mig-${hashCounter++}`,
    operationCount: 1,
    createdAt: '2026-02-25T14:00:00.000Z',
    refs: [],
    providedInvariants: [],
  };
}

function layout(entries: readonly MigrationListEntry[]) {
  return computeMigrationListGraphLayout(entries);
}

function isMigration(row: LayoutRow): row is MigrationLayoutRow {
  return row.kind === 'migration';
}

function isNodeLine(row: LayoutRow): row is NodeLineLayoutRow {
  return row.kind === 'nodeLine';
}

function isConnector(row: LayoutRow): row is ConnectorLayoutRow {
  return row.kind === 'connector';
}

function migrationRows(rows: readonly LayoutRow[]): readonly MigrationLayoutRow[] {
  return rows.filter(isMigration);
}

function connectorRows(rows: readonly LayoutRow[]): readonly ConnectorLayoutRow[] {
  return rows.filter(isConnector);
}

describe('computeMigrationListGraphLayout', () => {
  it('degrades linear chain to lane-zero migrations without connectors or node-lines', () => {
    const eComments = entry('20250310_add_comments', 'hash_7e1', 'hash_f03');
    const ePosts = entry('20250203_add_posts', 'hash_abc', 'hash_7e1');
    const eUsers = entry('20250115_add_users', null, 'hash_abc');
    const rows = layout([eComments, ePosts, eUsers]).rows;

    expect(rows.filter(isNodeLine)).toHaveLength(0);
    expect(connectorRows(rows)).toHaveLength(0);
    expect(migrationRows(rows)).toHaveLength(3);
    for (const row of migrationRows(rows)) {
      expect(row.laneIndex).toBe(0);
      expect(row.woven).toBe(true);
      expect(row.passThroughLanes).toEqual([]);
    }
  });

  it('lays out diamond with node-line, fan-below, join-below, and branch lanes', () => {
    const eUsers = entry('20250115_add_users', null, 'hash_abc');
    const ePosts = entry('20250203_add_posts', 'hash_abc', 'hash_7e1');
    const eTags = entry('20250210_add_tags', 'hash_abc', 'hash_9c4');
    const eMergePosts = entry('20250301_merge_posts', 'hash_7e1', 'hash_d41');
    const eMergeTags = entry('20250302_merge_tags', 'hash_9c4', 'hash_d41');
    const rows = layout([eMergeTags, eMergePosts, eTags, ePosts, eUsers]).rows;

    const nodeLine = rows[0];
    expect(nodeLine).toBeDefined();
    expect(isNodeLine(nodeLine!)).toBe(true);
    expect(nodeLine).toMatchObject({ kind: 'nodeLine', contractHash: 'hash_d41', laneIndex: 0 });

    const fan = rows[1];
    expect(fan).toBeDefined();
    expect(isConnector(fan!)).toBe(true);
    expect(fan).toMatchObject({
      kind: 'connector',
      connectorKind: 'fanBelow',
      startLane: 0,
      endLane: 1,
      branchCount: 2,
    });

    const mergeTags = migrationRows(rows).find((r) => r.entry.dirName === '20250302_merge_tags');
    const mergePosts = migrationRows(rows).find((r) => r.entry.dirName === '20250301_merge_posts');
    expect(mergeTags?.laneIndex).toBe(0);
    expect(mergeTags?.passThroughLanes).toEqual([1]);
    expect(mergePosts?.laneIndex).toBe(1);
    expect(mergePosts?.passThroughLanes).toEqual([0]);

    const join = connectorRows(rows).find((c) => c.connectorKind === 'joinBelow');
    expect(join).toMatchObject({ startLane: 0, endLane: 1, branchCount: 2 });

    const users = migrationRows(rows).find((r) => r.entry.dirName === '20250115_add_users');
    expect(users?.laneIndex).toBe(0);
  });

  it('lays out N-way convergence with fan-below spanning three producer lanes', () => {
    const eBase = entry('20250115_add_base', null, 'hash_4cb');
    const eBranchC = entry('20250302_branch_c', 'hash_4cb', 'hash_c1d');
    const eBranchB = entry('20250303_branch_b', 'hash_4cb', 'hash_b1c');
    const eBranchA = entry('20250304_branch_a', 'hash_4cb', 'hash_a1b');
    const eMergeC = entry('20250308_merge_c', 'hash_c1d', 'hash_d41');
    const eMergeB = entry('20250309_merge_b', 'hash_b1c', 'hash_d41');
    const eMergeA = entry('20250310_merge_a', 'hash_a1b', 'hash_d41');
    const rows = layout([eMergeA, eMergeB, eMergeC, eBranchA, eBranchB, eBranchC, eBase]).rows;

    const fan = connectorRows(rows).find((c) => c.connectorKind === 'fanBelow');
    expect(fan).toMatchObject({ startLane: 0, endLane: 2, branchCount: 3 });

    const merges = migrationRows(rows).filter((r) => r.entry.to === 'hash_d41');
    expect(merges.map((r) => r.laneIndex)).toEqual([0, 1, 2]);

    const baseJoin = connectorRows(rows)
      .filter((c) => c.connectorKind === 'joinBelow')
      .at(-1);
    expect(baseJoin).toMatchObject({ startLane: 0, endLane: 2, branchCount: 3 });
  });

  it('lays out parallel edges with two-lane fan and join at divergence', () => {
    const eUsers = entry('20250115_add_users', null, 'hash_abc');
    const ePosts = entry('20250203_add_posts', 'hash_abc', 'hash_def');
    const ePostsV2 = entry('20250203_add_posts_v2', 'hash_abc', 'hash_def');
    const rows = layout([ePostsV2, ePosts, eUsers]).rows;

    const nodeLine = rows[0];
    expect(nodeLine).toBeDefined();
    expect(isNodeLine(nodeLine!)).toBe(true);
    expect(nodeLine).toMatchObject({ contractHash: 'hash_def' });

    const fan = connectorRows(rows).find((c) => c.connectorKind === 'fanBelow');
    expect(fan).toMatchObject({ branchCount: 2, endLane: 1 });

    const v2 = migrationRows(rows).find((r) => r.entry.dirName.includes('v2'));
    const posts = migrationRows(rows).find((r) => r.entry.dirName === '20250203_add_posts');
    expect(v2?.laneIndex).toBe(0);
    expect(posts?.laneIndex).toBe(1);
  });

  it('lays out convergence and divergence with join-above, node-line, and fan-below on separate rows', () => {
    const eBase = entry('20250115_add_base', null, 'hash_4cb');
    const eBranchB = entry('20250303_branch_b', 'hash_4cb', 'hash_b1c');
    const eBranchA = entry('20250304_branch_a', 'hash_4cb', 'hash_a1b');
    const eMergeB = entry('20250309_merge_b', 'hash_b1c', 'hash_d41');
    const eMergeA = entry('20250310_merge_a', 'hash_a1b', 'hash_d41');
    const eAddY = entry('20250319_add_y', 'hash_d41', 'hash_c4d');
    const eAddX = entry('20250320_add_x', 'hash_d41', 'hash_e1f');
    const rows = layout([eAddX, eAddY, eMergeA, eMergeB, eBranchA, eBranchB, eBase]).rows;

    const joinAbove = connectorRows(rows).find(
      (c) => c.connectorKind === 'joinBelow' && c.contractHash === 'hash_d41',
    );
    expect(joinAbove).toBeDefined();

    const nodeIndex = rows.findIndex((r) => isNodeLine(r) && r.contractHash === 'hash_d41');
    const joinIndex = rows.findIndex((r) => r === joinAbove);
    const fanIndex = rows.findIndex(
      (r) => isConnector(r) && r.connectorKind === 'fanBelow' && r !== joinAbove,
    );
    expect(joinIndex).toBeLessThan(nodeIndex);
    expect(nodeIndex).toBeLessThan(fanIndex);

    expect(eAddX.dirName).toBe(migrationRows(rows)[0]?.entry.dirName);
    expect(migrationRows(rows)[0]?.laneIndex).toBe(0);
    expect(migrationRows(rows)[1]?.laneIndex).toBe(1);
  });

  it('places multi-hop rollback in lane zero without weaving', () => {
    const eUsers = entry('20250115_add_users', null, 'hash_abc');
    const ePosts = entry('20250203_add_posts', 'hash_abc', 'hash_def');
    const eComments = entry('20250310_add_comments', 'hash_def', 'hash_ghi');
    const eRollback = entry('20250312_full_rollback', 'hash_ghi', 'hash_abc');
    const rows = layout([eRollback, eComments, ePosts, eUsers]).rows;

    expect(connectorRows(rows)).toHaveLength(0);
    expect(rows.filter(isNodeLine)).toHaveLength(0);

    const rollback = migrationRows(rows).find((r) => r.entry.dirName === '20250312_full_rollback');
    expect(rollback).toMatchObject({
      laneIndex: 0,
      woven: false,
      edgeKind: 'rollback',
      passThroughLanes: [],
    });
  });

  it('passes lane zero through rollback row and places rollback kind in lane one', () => {
    const eUsers = entry('20250115_add_users', null, 'hash_abc');
    const ePosts = entry('20250203_add_posts', 'hash_abc', 'hash_def');
    const eComments = entry('20250310_add_comments', 'hash_def', 'hash_ghi');
    const eRollback = entry('20250312_rollback_comments', 'hash_ghi', 'hash_def');
    const eLikes = entry('20250320_add_likes', 'hash_def', 'hash_jkl');
    const rows = layout([eLikes, eRollback, eComments, ePosts, eUsers]).rows;

    const likes = migrationRows(rows).find((r) => r.entry.dirName === '20250320_add_likes');
    const rollback = migrationRows(rows).find(
      (r) => r.entry.dirName === '20250312_rollback_comments',
    );
    expect(likes?.laneIndex).toBe(0);
    expect(rollback).toMatchObject({
      laneIndex: 1,
      woven: false,
      edgeKind: 'rollback',
      passThroughLanes: [0],
    });

    const join = connectorRows(rows).find((c) => c.connectorKind === 'joinBelow');
    expect(join).toMatchObject({ startLane: 0, endLane: 1, branchCount: 2 });
  });

  it('starts separate lanes at multiple forward roots without throwing', () => {
    const eOther = entry('20250301_other', 'hash_root_a', 'hash_root_b');
    const eBranch = entry('20250302_branch', 'hash_mid', 'hash_tip');
    const rows = layout([eBranch, eOther]).rows;

    expect(rows.filter(isNodeLine)).toHaveLength(0);
    expect(connectorRows(rows)).toHaveLength(0);
    const migrations = migrationRows(rows);
    expect(migrations).toHaveLength(2);
    expect(migrations.map((r) => r.laneIndex)).toEqual([0, 1]);
    expect(migrations.every((r) => r.woven)).toBe(true);
  });
});

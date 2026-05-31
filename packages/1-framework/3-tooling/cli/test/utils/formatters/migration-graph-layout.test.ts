import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import type { MigrationEdge, MigrationGraph } from '@prisma-next/migration-tools/graph';
import { describe, expect, it } from 'vitest';
import {
  buildMigrationGraphLayout,
  type EdgeAdjacency,
  type MigrationGraphGridRow,
  type StructuralCell,
} from '../../../src/utils/formatters/migration-graph-layout';
import { buildMigrationGraphRows } from '../../../src/utils/formatters/migration-graph-rows';

let migSeq = 0;

function edge(from: string, to: string, dirName: string): MigrationEdge {
  return {
    from,
    to,
    migrationHash: `sha256:mig-${migSeq++}`,
    dirName,
    createdAt: '2026-01-01T00:00:00.000Z',
    invariants: [],
  };
}

function graph(edges: readonly MigrationEdge[]): MigrationGraph {
  const nodes = new Set<string>();
  const forwardChain = new Map<string, MigrationEdge[]>();
  const reverseChain = new Map<string, MigrationEdge[]>();
  const migrationByHash = new Map<string, MigrationEdge>();

  for (const e of edges) {
    nodes.add(e.from);
    nodes.add(e.to);
    migrationByHash.set(e.migrationHash, e);

    const fwd = forwardChain.get(e.from);
    if (fwd) fwd.push(e);
    else forwardChain.set(e.from, [e]);

    const rev = reverseChain.get(e.to);
    if (rev) rev.push(e);
    else reverseChain.set(e.to, [e]);
  }

  return { nodes, forwardChain, reverseChain, migrationByHash };
}

function layout(edges: readonly MigrationEdge[]) {
  const rowModel = buildMigrationGraphRows(graph(edges));
  return buildMigrationGraphLayout(rowModel);
}

function isNodeRow(row: MigrationGraphGridRow): boolean {
  return row.kind === 'node';
}

function isEdgeRow(row: MigrationGraphGridRow): boolean {
  return row.kind === 'edge';
}

function isBranchConnector(row: MigrationGraphGridRow): boolean {
  return row.kind === 'branch-connector';
}

function isMergeConnector(row: MigrationGraphGridRow): boolean {
  return row.kind === 'merge-connector';
}

function edgeLaneCell(row: MigrationGraphGridRow): Extract<StructuralCell, { kind: 'edge-lane' }> {
  const cell = row.cells.find(
    (c): c is Extract<StructuralCell, { kind: 'edge-lane' }> =>
      c.kind === 'edge-lane' && c.ownsLabel,
  );
  if (!cell) throw new Error(`no owning edge-lane cell on row ${row.kind}`);
  return cell;
}

function edgeRowByDirName(
  rows: readonly MigrationGraphGridRow[],
  dirName: string,
): MigrationGraphGridRow {
  const found = rows.find((r) => r.kind === 'edge' && r.edge?.dirName === dirName);
  if (!found) throw new Error(`no edge row for ${dirName}`);
  return found;
}

function expectEdgeGeometry(
  rows: readonly MigrationGraphGridRow[],
  dirName: string,
  laneIndex: number,
  passThroughLanes: readonly number[],
  adjacency: EdgeAdjacency,
): void {
  const row = edgeRowByDirName(rows, dirName);
  const lane = edgeLaneCell(row);
  expect(lane.adjacency).toBe(adjacency);
  expect(row.laneIndex).toBe(laneIndex);
  expect(row.passThroughLanes).toEqual([...passThroughLanes]);
}

describe('buildMigrationGraphLayout', () => {
  it('lays out a linear chain in lane zero without connectors', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'aaa', 'init');
    const addPosts = edge('aaa', 'bbb', 'add_posts');
    const model = layout([init, addPosts]);

    expect(model.rows.filter(isNodeRow)).toHaveLength(3);
    expect(model.rows.filter(isEdgeRow)).toHaveLength(2);
    expect(model.rows.filter(isBranchConnector)).toHaveLength(0);
    expect(model.rows.filter(isMergeConnector)).toHaveLength(0);

    expectEdgeGeometry(model.rows, 'add_posts', 0, [], 'adjacent');
    expectEdgeGeometry(model.rows, 'init', 0, [], 'adjacent');
    expect(model.nodeColumn.get('bbb')).toBe(0);
    expect(model.nodeColumn.get('aaa')).toBe(0);
    expect(model.nodeColumn.get(EMPTY_CONTRACT_HASH)).toBe(0);
  });

  it('lays out diamond with branch connector, merge connector, and long-edge lane', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'root', 'init');
    const alice = edge('root', 'alice', 'alice_add_phone');
    const bob = edge('root', 'bob', 'bob_add_avatar');
    const mergeAlice = edge('alice', 'tip', 'merge_alice');
    const mergeBob = edge('bob', 'tip', 'merge_bob');
    const model = layout([init, alice, bob, mergeAlice, mergeBob]);

    const branch = model.rows.find(isBranchConnector);
    expect(branch).toMatchObject({
      kind: 'branch-connector',
      branchCount: 2,
      startLane: 0,
      endLane: 1,
    });

    const merge = model.rows.find(isMergeConnector);
    expect(merge).toMatchObject({
      kind: 'merge-connector',
      branchCount: 2,
      startLane: 0,
      endLane: 1,
    });

    expectEdgeGeometry(model.rows, 'merge_alice', 0, [1], 'adjacent');
    expectEdgeGeometry(model.rows, 'merge_bob', 1, [0], 'node-skipping-forward');
    expectEdgeGeometry(model.rows, 'alice_add_phone', 0, [1], 'adjacent');
    expectEdgeGeometry(model.rows, 'bob_add_avatar', 1, [0], 'adjacent');
    expectEdgeGeometry(model.rows, 'init', 0, [], 'adjacent');

    expect(model.nodeColumn.get('tip')).toBe(0);
    expect(model.nodeColumn.get('alice')).toBe(0);
    expect(model.nodeColumn.get('bob')).toBe(1);
    expect(model.nodeColumn.get('root')).toBe(0);
  });

  it('lays out sequential diamonds with two fan/join pairs', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'root', 'init');
    const alice = edge('root', 'alice', 'alice_add_phone');
    const bob = edge('root', 'bob', 'bob_add_avatar');
    const merge1a = edge('alice', 'mid', 'merge_1a');
    const merge1b = edge('bob', 'mid', 'merge_1b');
    const addComments = edge('mid', 'branch_a', 'add_comments');
    const addPostsBranch = edge('mid', 'branch_b', 'add_posts_branch');
    const merge2a = edge('branch_a', 'tip', 'merge_2a');
    const merge2b = edge('branch_b', 'tip', 'merge_2b');
    const model = layout([
      init,
      alice,
      bob,
      merge1a,
      merge1b,
      addComments,
      addPostsBranch,
      merge2a,
      merge2b,
    ]);

    const branchConnectors = model.rows.filter(isBranchConnector);
    expect(branchConnectors).toHaveLength(2);
    expect(
      branchConnectors.every((c) => c.branchCount === 2 && c.startLane === 0 && c.endLane === 1),
    ).toBe(true);

    const mergeConnectors = model.rows.filter(isMergeConnector);
    expect(mergeConnectors).toHaveLength(2);

    expectEdgeGeometry(model.rows, 'merge_2a', 0, [1], 'adjacent');
    expectEdgeGeometry(model.rows, 'merge_2b', 1, [0], 'node-skipping-forward');
    expectEdgeGeometry(model.rows, 'merge_1a', 0, [1], 'adjacent');
    expectEdgeGeometry(model.rows, 'merge_1b', 1, [0], 'node-skipping-forward');
  });

  it('lays out a three-way convergence fan with three lanes', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'root', 'init');
    const addPhone = edge('root', 'phone', 'add_phone');
    const addPosts = edge('root', 'posts', 'add_posts');
    const addAvatar = edge('root', 'avatar', 'add_avatar');
    const mergePhone = edge('phone', 'tip', 'merge_phone');
    const mergePosts = edge('posts', 'tip', 'merge_posts');
    const mergeAvatar = edge('avatar', 'tip', 'merge_avatar');
    const model = layout([
      init,
      addPhone,
      addPosts,
      addAvatar,
      mergePhone,
      mergePosts,
      mergeAvatar,
    ]);

    const branch = model.rows.find(isBranchConnector);
    expect(branch).toMatchObject({ branchCount: 3, startLane: 0, endLane: 2 });

    expectEdgeGeometry(model.rows, 'merge_phone', 0, [1, 2], 'adjacent');
    expectEdgeGeometry(model.rows, 'merge_posts', 1, [0, 2], 'node-skipping-forward');
    expectEdgeGeometry(model.rows, 'merge_avatar', 2, [0, 1], 'node-skipping-forward');

    expect(model.nodeColumn.get('phone')).toBe(0);
    expect(model.nodeColumn.get('posts')).toBe(1);
    expect(model.nodeColumn.get('avatar')).toBe(2);
  });

  // Skipped until the lane allocator reconciles a node that is both a divergence child
  // and a convergence producer (D feeds E yet also diverges from A), and connector rows
  // emit column-absolute cells with pass-throughs for active lanes outside their span.
  // Every value below is derived by hand from `mockups.md` § cross-link, NOT from code output.
  it.skip('lays out cross-link with three lanes per mockup', () => {
    const aToB = edge('A', 'B', 'A_to_B');
    const bToC = edge('B', 'C', 'B_to_C');
    const aToD = edge('A', 'D', 'A_to_D');
    const dToE = edge('D', 'E', 'D_to_E');
    const bToE = edge('B', 'E', 'B_to_E');
    const model = layout([aToB, bToC, aToD, dToE, bToE]);

    // `│ ├─╮` — E fans down to lanes 1 (B→E) and 2 (D→E); lane 0 (the C-spine) passes through.
    const branchAtE = model.rows.find(
      (r) => r.kind === 'branch-connector' && r.contractHash === 'E',
    );
    expect(branchAtE).toMatchObject({ startLane: 1, endLane: 2, branchCount: 2 });
    expect(branchAtE?.cells[0]?.kind).toBe('vertical-pass');
    expect(branchAtE?.cells[1]?.kind).toBe('branch-tee');
    expect(branchAtE?.cells[2]?.kind).toBe('branch-corner');

    // `├─┘ │` — lanes 0 and 1 merge into B; lane 2 (D→E, still wanting D) passes through.
    const mergeAtB = model.rows.find((r) => r.kind === 'merge-connector' && r.contractHash === 'B');
    expect(mergeAtB).toMatchObject({ startLane: 0, endLane: 1, branchCount: 2 });
    expect(mergeAtB?.cells[0]?.kind).toBe('merge-tee');
    expect(mergeAtB?.cells[1]?.kind).toBe('merge-corner');
    expect(mergeAtB?.cells[2]?.kind).toBe('vertical-pass');

    // `├───┘` — lanes 0 (B) and 2 (D) merge into A; lane 1 carries no active lane here,
    // so it is a dormant horizontal fill (the `─` bridging tee and corner) — neither a
    // vertical pass-through nor a join.
    const mergeAtA = model.rows.find((r) => r.kind === 'merge-connector' && r.contractHash === 'A');
    expect(mergeAtA).toMatchObject({ startLane: 0, endLane: 2, branchCount: 2 });
    expect(mergeAtA?.cells[0]?.kind).toBe('merge-tee');
    expect(mergeAtA?.cells[1]?.kind).toBe('horizontal-pass');
    expect(mergeAtA?.cells[2]?.kind).toBe('merge-corner');

    // Convergence-producer adjacency mirrors the diamond's alice/bob reading: 'adjacent'
    // is the producer whose source node is the nearest node row below the fan. B (B→E's
    // source) renders immediately below the fan; D (D→E's source) is further down.
    expectEdgeGeometry(model.rows, 'B_to_C', 0, [], 'adjacent');
    expectEdgeGeometry(model.rows, 'B_to_E', 1, [0, 2], 'adjacent');
    expectEdgeGeometry(model.rows, 'D_to_E', 2, [0, 1], 'node-skipping-forward');
    expectEdgeGeometry(model.rows, 'A_to_B', 0, [2], 'adjacent');
    expectEdgeGeometry(model.rows, 'A_to_D', 2, [0], 'adjacent');

    expect(model.nodeColumn.get('C')).toBe(0);
    expect(model.nodeColumn.get('E')).toBe(1);
    expect(model.nodeColumn.get('B')).toBe(0);
    expect(model.nodeColumn.get('D')).toBe(2);
    expect(model.nodeColumn.get('A')).toBe(0);
  });

  // Skipped until the traversal renders the longer branch contiguously before dipping
  // into the shorter sibling (today it braids them). Every value below is derived by hand
  // from `mockups.md` § kitchen-sink, NOT from code output.
  it.skip('lays out kitchen-sink with unequal branch lengths per mockup', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'root', 'init');
    const addPhone = edge('root', 'n1', 'add_phone');
    const emailDefault = edge('n1', 'n2', 'email_default');
    const changeDefault = edge('n2', 'n3', 'change_default');
    const addPosts = edge('n3', 'n4', 'add_posts');
    const addComments = edge('n4', 'n5', 'add_comments');
    const kitchenSink = edge('n5', 'tip_long', 'kitchen_sink');
    const rollback = edge('tip_long', 'n5', 'rollback');
    const widenEmail = edge('root', 's1', 'widen_email');
    const migration = edge('s1', 'tip_short', 'migration');
    const model = layout([
      init,
      addPhone,
      emailDefault,
      changeDefault,
      addPosts,
      addComments,
      kitchenSink,
      rollback,
      widenEmail,
      migration,
    ]);

    const mergeAtRoot = model.rows.find(
      (r) => r.kind === 'merge-connector' && r.contractHash === 'root',
    );
    expect(mergeAtRoot).toMatchObject({ startLane: 0, endLane: 1, branchCount: 2 });

    // Long branch sits entirely above the short branch, so its edges carry no lane-1
    // pass-through; lane 1 only opens at `tip_short` and closes at the root merge.
    expectEdgeGeometry(model.rows, 'kitchen_sink', 0, [], 'adjacent');
    expectEdgeGeometry(model.rows, 'rollback', 0, [], 'adjacent');
    expectEdgeGeometry(model.rows, 'add_comments', 0, [], 'adjacent');
    expectEdgeGeometry(model.rows, 'add_phone', 0, [], 'adjacent');
    expectEdgeGeometry(model.rows, 'widen_email', 1, [0], 'adjacent');
    expectEdgeGeometry(model.rows, 'migration', 1, [0], 'adjacent');

    expect(model.nodeColumn.get('root')).toBe(0);
    expect(model.nodeColumn.get('tip_short')).toBe(1);
    expect(model.nodeColumn.get('tip_long')).toBe(0);

    // Long branch (tip_long..n1) renders contiguously, then the short branch (tip_short, s1),
    // then the merge into root — no interleaving of the two branches' node rows.
    const nodeIndex = (hash: string) =>
      model.rows.findIndex((r) => r.kind === 'node' && r.contractHash === hash);
    expect(nodeIndex('tip_long')).toBeLessThan(nodeIndex('n5'));
    expect(nodeIndex('n5')).toBeLessThan(nodeIndex('n4'));
    expect(nodeIndex('n4')).toBeLessThan(nodeIndex('n3'));
    expect(nodeIndex('n3')).toBeLessThan(nodeIndex('n2'));
    expect(nodeIndex('n2')).toBeLessThan(nodeIndex('n1'));
    expect(nodeIndex('n1')).toBeLessThan(nodeIndex('tip_short'));
    expect(nodeIndex('tip_short')).toBeLessThan(nodeIndex('s1'));
    expect(nodeIndex('s1')).toBeLessThan(nodeIndex('root'));
  });

  it('places self-edge row immediately above its node', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'aaa', 'init');
    const noop = edge('aaa', 'aaa', 'noop');
    const next = edge('aaa', 'bbb', 'next');
    const model = layout([init, noop, next]);

    const aaaNodeIndex = model.rows.findIndex((r) => r.kind === 'node' && r.contractHash === 'aaa');
    const noopIndex = model.rows.findIndex((r) => r.kind === 'edge' && r.edge?.dirName === 'noop');
    const nextIndex = model.rows.findIndex((r) => r.kind === 'edge' && r.edge?.dirName === 'next');

    expect(noopIndex).toBeGreaterThanOrEqual(0);
    expect(aaaNodeIndex).toBeGreaterThan(noopIndex);
    expect(noopIndex).toBe(aaaNodeIndex - 1);
    expect(nextIndex).toBeLessThan(noopIndex);
    expectEdgeGeometry(model.rows, 'noop', 0, [], 'adjacent');
  });

  it('separates disjoint components with a blank separator row', () => {
    const appInit = edge(EMPTY_CONTRACT_HASH, 'aaa', 'app_init');
    const appNext = edge('aaa', 'bbb', 'app_next');
    const otherRoot = edge('ccc', 'ddd', 'other_root');
    const model = layout([appInit, appNext, otherRoot]);

    expect(model.rows.some((r) => r.kind === 'component-separator')).toBe(true);
    expect(model.rows.filter(isNodeRow)).toHaveLength(5);
  });

  it('marks adjacent rollbacks without routing node-skipping rollbacks', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'aaa', 'init');
    const addPosts = edge('aaa', 'bbb', 'add_posts');
    const rollbackAdjacent = edge('bbb', 'aaa', 'rollback_adjacent');
    const model = layout([init, addPosts, rollbackAdjacent]);

    expectEdgeGeometry(model.rows, 'rollback_adjacent', 0, [], 'adjacent');

    const init2 = edge(EMPTY_CONTRACT_HASH, 'aaa', 'init');
    const addPhone = edge('aaa', 'bbb', 'add_phone');
    const addBio = edge('bbb', 'ccc', 'add_bio');
    const rollbackSkip = edge('ccc', 'aaa', 'rollback_skip');
    const modelSkip = layout([init2, addPhone, addBio, rollbackSkip]);

    expectEdgeGeometry(modelSkip.rows, 'rollback_skip', 0, [], 'node-skipping-rollback');
  });

  it('uses structural cell roles without literal box-drawing characters', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'root', 'init');
    const alice = edge('root', 'alice', 'alice_add_phone');
    const bob = edge('root', 'bob', 'bob_add_avatar');
    const mergeAlice = edge('alice', 'tip', 'merge_alice');
    const mergeBob = edge('bob', 'tip', 'merge_bob');
    const model = layout([init, alice, bob, mergeAlice, mergeBob]);

    const allowedKinds = new Set([
      'empty',
      'node',
      'vertical-pass',
      'horizontal-pass',
      'branch-tee',
      'branch-corner',
      'merge-tee',
      'merge-corner',
      'edge-lane',
    ]);

    for (const row of model.rows) {
      for (const cell of row.cells) {
        expect(allowedKinds.has(cell.kind)).toBe(true);
      }
    }
  });
});

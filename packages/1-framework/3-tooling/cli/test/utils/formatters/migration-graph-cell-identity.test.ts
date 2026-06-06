/**
 * Per-cell edge identity in the layout model (TML-2771, stage 2).
 *
 * These tests assert that every routing StructuralCell in the layout carries
 * the correct `migrationHash` identifying which edge's lane it belongs to. The
 * renderer (stage 3) will use this field to decide per-cell colour. The tests
 * here verify the layout data only — no colour or rendering is involved.
 */

import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import type { MigrationEdge, MigrationGraph } from '@prisma-next/migration-tools/graph';
import { describe, expect, it } from 'vitest';
import {
  buildMigrationGraphLayout,
  type StructuralCell,
} from '../../../src/utils/formatters/migration-graph-layout';
import { buildMigrationGraphRows } from '../../../src/utils/formatters/migration-graph-rows';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let migSeq = 100;

function edge(from: string, to: string, dirName: string): MigrationEdge {
  return {
    from,
    to,
    migrationHash: `sha256:identity-${migSeq++}`,
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
  return buildMigrationGraphLayout(buildMigrationGraphRows(graph(edges)));
}

/** Extract `migrationHash` from a cell (undefined for cells that don't carry one). */
function cellHash(cell: StructuralCell | undefined): string | undefined {
  if (cell === undefined) return undefined;
  if ('migrationHash' in cell) return cell.migrationHash;
  return undefined;
}

// ---------------------------------------------------------------------------
// Fork + merge diamond.
//
// Layout (tips at top):
//   ○  tip
//   ├─╮           branch-connector
//   │↑│  merge_alice / merge_bob
//   ○ │  alice
//   │↑│  alice_add_phone / (merge_bob pass)
//   │ ○  bob
//   │↑   bob_add_avatar
//   ├─╯           merge-connector
//   ○  root
//   │↑  init
//   ○  ∅
// ---------------------------------------------------------------------------

describe('per-cell edge identity — fork+merge diamond', () => {
  const init = edge(EMPTY_CONTRACT_HASH, 'root', 'init');
  const alice = edge('root', 'alice', 'alice_add_phone');
  const bob = edge('root', 'bob', 'bob_add_avatar');
  const mergeAlice = edge('alice', 'tip', 'merge_alice');
  const mergeBob = edge('bob', 'tip', 'merge_bob');

  it('branch-connector corner (fan lane) carries the fan edge hash', () => {
    // The branch-connector is emitted immediately after the `tip` node row.
    // At that point no edge rows have been emitted yet, so lane 0's
    // laneEdgeByIndex entry is empty. However, `fanEdgeHashByLane` is
    // pre-computed from the groups, so the corner at the outermost fan lane
    // correctly carries mergeBob's hash.
    const model = layout([init, alice, bob, mergeAlice, mergeBob]);
    const branchRow = model.rows.find((r) => r.kind === 'branch-connector');
    expect(branchRow).toBeDefined();
    const cornerCell = branchRow?.cells[1];
    expect(cornerCell?.kind).toBe('branch-corner');
    expect(cellHash(cornerCell)).toBe(mergeBob.migrationHash);
  });

  it('branch-connector tee (trunk lane) carries the trunk fanout edge hash', () => {
    // The branch-connector uses fanEdgeHashByLane for the trunk lane so the tee
    // carries the representative edge hash for the downward fanout (mergeAlice),
    // not undefined (which it would be if laneEdgeByIndex were consulted before
    // any edge row was emitted into that lane).
    const model = layout([init, alice, bob, mergeAlice, mergeBob]);
    const branchRow = model.rows.find((r) => r.kind === 'branch-connector');
    expect(branchRow).toBeDefined();
    const teeCell = branchRow?.cells[0];
    expect(teeCell?.kind).toBe('branch-tee');
    expect(cellHash(teeCell)).toBe(mergeAlice.migrationHash);
  });

  it('merge-connector tee carries the incoming alice edge hash', () => {
    // The merge-connector for `root` is emitted after alice_add_phone and
    // bob_add_avatar have both been emitted, so laneEdgeByIndex has their
    // hashes. Lane 0 carried alice_add_phone last.
    const model = layout([init, alice, bob, mergeAlice, mergeBob]);
    const mergeRow = model.rows.find((r) => r.kind === 'merge-connector');
    expect(mergeRow).toBeDefined();
    const teeCell = mergeRow?.cells[0];
    expect(teeCell?.kind).toBe('merge-tee');
    expect(cellHash(teeCell)).toBe(alice.migrationHash);
  });

  it('merge-connector corner carries the incoming bob edge hash', () => {
    const model = layout([init, alice, bob, mergeAlice, mergeBob]);
    const mergeRow = model.rows.find((r) => r.kind === 'merge-connector');
    expect(mergeRow).toBeDefined();
    const cornerCell = mergeRow?.cells[1];
    expect(cornerCell?.kind).toBe('merge-corner');
    expect(cellHash(cornerCell)).toBe(bob.migrationHash);
  });

  it('vertical-pass on the bob node row (lane 0) carries the alice edge hash', () => {
    // At the bob node row, lane 0 is a pass-through for alice_add_phone, which
    // was the most-recently emitted edge in that lane.
    const model = layout([init, alice, bob, mergeAlice, mergeBob]);
    const bobNodeRow = model.rows.find((r) => r.kind === 'node' && r.contractHash === 'bob');
    expect(bobNodeRow).toBeDefined();
    const passCell = bobNodeRow?.cells[0];
    expect(passCell?.kind).toBe('vertical-pass');
    expect(cellHash(passCell)).toBe(alice.migrationHash);
  });

  it('vertical-pass on the alice node row (lane 1) carries the merge_bob edge hash', () => {
    // At the alice node row, lane 1 is a pass-through for merge_bob, which
    // was the most-recently emitted edge in that lane (emitted before alice row).
    const model = layout([init, alice, bob, mergeAlice, mergeBob]);
    const aliceNodeRow = model.rows.find((r) => r.kind === 'node' && r.contractHash === 'alice');
    expect(aliceNodeRow).toBeDefined();
    const passCell = aliceNodeRow?.cells[1];
    expect(passCell?.kind).toBe('vertical-pass');
    expect(cellHash(passCell)).toBe(mergeBob.migrationHash);
  });

  it('vertical-pass on the merge_bob edge row (lane 0) carries the merge_alice hash', () => {
    // When merge_bob is emitted in lane 1, lane 0 carries merge_alice
    // (emitted just before merge_bob).
    const model = layout([init, alice, bob, mergeAlice, mergeBob]);
    const mergeBobRow = model.rows.find(
      (r) => r.kind === 'edge' && r.edge?.migrationHash === mergeBob.migrationHash,
    );
    expect(mergeBobRow).toBeDefined();
    const passCell = mergeBobRow?.cells[0];
    expect(passCell?.kind).toBe('vertical-pass');
    expect(cellHash(passCell)).toBe(mergeAlice.migrationHash);
  });
});

// ---------------------------------------------------------------------------
// Node-skipping rollback.
//
// Layout (tips at top):
//   ○       n3
//   │↑      m3
//   ○─╮     n2    (arcTee)
//   │↓│     rb_skip / (vertical body)
//   │↑│     m2 / (rb body)
//   ○ │     n1 / (rb body)
//   │↑│     m1 / (rb body)
//   ○◂╯     n0    (arcLand)
//   │↑      init
//   ○       ∅
// ---------------------------------------------------------------------------

describe('per-cell edge identity — node-skipping rollback', () => {
  // Linear chain ∅ → n0 → n1 → n2 → n3, plus rollback n2 → n0 (skips n1).
  const init = edge(EMPTY_CONTRACT_HASH, 'n0', 'init');
  const m1 = edge('n0', 'n1', 'm1');
  const m2 = edge('n1', 'n2', 'm2');
  const m3 = edge('n2', 'n3', 'm3');
  const rb = edge('n2', 'n0', 'rb_skip');

  it('arc-branch-corner in source row carries the rollback edge hash', () => {
    const model = layout([init, m1, m2, m3, rb]);
    const sourceRow = model.rows.find((r) => r.kind === 'node' && r.contractHash === 'n2');
    expect(sourceRow).toBeDefined();
    const cornerCell = sourceRow?.cells.find((c) => c.kind === 'arc-branch-corner');
    expect(cornerCell).toBeDefined();
    expect(cellHash(cornerCell)).toBe(rb.migrationHash);
  });

  it('arc-land-corner in target row carries the rollback edge hash', () => {
    const model = layout([init, m1, m2, m3, rb]);
    const targetRow = model.rows.find((r) => r.kind === 'node' && r.contractHash === 'n0');
    expect(targetRow).toBeDefined();
    const cornerCell = targetRow?.cells.find((c) => c.kind === 'arc-land-corner');
    expect(cornerCell).toBeDefined();
    expect(cellHash(cornerCell)).toBe(rb.migrationHash);
  });

  it('vertical-pass cells in the arc body (back-lane) carry the rollback edge hash', () => {
    // All rows strictly between the source (n2) and target (n0), excluding the
    // rollback's own edge row, should have a vertical-pass in the back-lane
    // carrying rb.migrationHash.
    const model = layout([init, m1, m2, m3, rb]);
    const sourceIdx = model.rows.findIndex((r) => r.kind === 'node' && r.contractHash === 'n2');
    const targetIdx = model.rows.findIndex((r) => r.kind === 'node' && r.contractHash === 'n0');
    const edgeIdx = model.rows.findIndex(
      (r) => r.kind === 'edge' && r.edge?.migrationHash === rb.migrationHash,
    );
    expect(sourceIdx).toBeGreaterThan(-1);
    expect(targetIdx).toBeGreaterThan(-1);
    expect(edgeIdx).toBeGreaterThan(-1);

    const backLane = model.edgeColumn.get(rb.migrationHash);
    expect(backLane).toBeDefined();

    for (let i = sourceIdx + 1; i < targetIdx; i++) {
      if (i === edgeIdx) continue;
      const row = model.rows[i];
      if (row === undefined) continue;
      const cell = row.cells[backLane as number];
      if (cell === undefined || cell.kind === 'empty') continue;
      if (cell.kind !== 'vertical-pass') continue;
      expect(
        cellHash(cell),
        `row ${i} (${row.kind} ${(row as { contractHash?: string; edge?: { dirName?: string } }).contractHash ?? (row as { edge?: { dirName?: string } }).edge?.dirName ?? ''}) back-lane cell`,
      ).toBe(rb.migrationHash);
    }
  });

  it('vertical-pass cells on forward edge rows (pass-through lane) carry the rollback hash', () => {
    // On the m2 and m1 edge rows, the rollback's back-lane is a vertical-pass
    // that must carry rb.migrationHash.
    const model = layout([init, m1, m2, m3, rb]);
    const backLane = model.edgeColumn.get(rb.migrationHash) as number;

    for (const edge of [m2, m1]) {
      const edgeRow = model.rows.find(
        (r) => r.kind === 'edge' && r.edge?.migrationHash === edge.migrationHash,
      );
      expect(edgeRow).toBeDefined();
      const cell = edgeRow?.cells[backLane];
      expect(cell?.kind).toBe('vertical-pass');
      expect(cellHash(cell)).toBe(rb.migrationHash);
    }
  });
});

// ---------------------------------------------------------------------------
// Fan-lane pass-through identity.
//
// When a node fans out into multiple groups, the branch-connector is emitted
// before any of the fan's edge rows. Without pre-populating laneEdgeByIndex
// for every fan lane, vertical-pass cells in peer group edge rows carry no
// hash (laneEdgeByIndex has no entry for lanes not yet written). Fix 4
// pre-populates every fan lane so pass-through cells carry the right hash.
//
// Layout (tips at top):
//   ○     tip
//   ├─╮   branch-connector (startLane=0, endLane=1)
//   │↑│   merge_alice / merge_bob (peer edge rows)
//   ○ │   alice
//   │↑│   alice_add_phone / (lane-1 pass-through)
//   │ ○   bob
//   │↑    bob_add_avatar
//   ├─╯   merge-connector
//   ○     root
//   │↑    init
//   ○     ∅
// ---------------------------------------------------------------------------

describe('per-cell edge identity — fan-lane pass-through', () => {
  const init = edge(EMPTY_CONTRACT_HASH, 'root', 'init');
  const alice = edge('root', 'alice', 'alice_add_phone');
  const bob = edge('root', 'bob', 'bob_add_avatar');
  const mergeAlice = edge('alice', 'tip', 'merge_alice');
  const mergeBob = edge('bob', 'tip', 'merge_bob');

  it('vertical-pass at fan lane 1 on merge_alice edge row carries merge_bob hash', () => {
    // merge_alice (lane 0) is emitted first. At that point, lane 1 has been
    // pre-populated with merge_bob.migrationHash via Fix 4, so the vertical-pass
    // at lane 1 on the merge_alice row carries merge_bob.migrationHash.
    const model = layout([init, alice, bob, mergeAlice, mergeBob]);
    const mergeAliceRow = model.rows.find(
      (r) => r.kind === 'edge' && r.edge?.migrationHash === mergeAlice.migrationHash,
    );
    expect(mergeAliceRow).toBeDefined();
    const passCell = mergeAliceRow?.cells[1];
    expect(passCell?.kind).toBe('vertical-pass');
    expect(cellHash(passCell)).toBe(mergeBob.migrationHash);
  });
});

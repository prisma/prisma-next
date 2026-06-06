/**
 * Graph-colouring matrix: topologies × normal-rotation / path-highlight modes.
 *
 * This test matrix PINS the lane-bleed bug (TML-2771).
 *
 * THE BUG: Structural lane cells (vertical-pass, branch-tee, merge-corner, arc bodies)
 * are coloured by COLUMN via `columnHighlights` with "on-path wins". When an on-path
 * edge occupies column N at ANY row, ALL connector/arc rows that use column N get green
 * — even those that belong to an off-path edge routed through the same column. Off-path
 * branch spines, merge corners, and arc bodies that share a column with an on-path edge
 * bleed green instead of rendering dim.
 *
 * Stage-3 fix will thread per-cell edge identity so:
 *   - A connector/arc cell gets the colour of the EDGE it belongs to, not the column.
 *   - A vertical-pass cell retains column-level colour (FIX D, already correct).
 *
 * ============================================================
 * Assertions that CURRENTLY FAIL (the stage-3 done condition):
 * ============================================================
 *
 *   BLEED GUARD — connector corners belong to an off-path edge but sit in a column
 *   shared with on-path edge → corner must be DIM, not green:
 *   - diamond: path-highlight alice → branch connector ╯ (bob, col-1) must be DIM
 *   - diamond: path-highlight alice → merge connector ╯ (bob, col-1) must be DIM
 *
 *   ARC BODY — rollback arc corners/bridges belong to an on-path rollback edge but
 *   the renderer colours them by column (which is a trunk/off-path column) → must be green:
 *   - branchPlusRollback: rollback on-path → arc body (╮/╯) rows contain GREEN_BRIGHT
 *   - rollbackOnPath: rollback on-path → arc corners contain GREEN_BRIGHT
 *
 *   ROTATION IN ARC LANDING — rollback arc landing corner at ∅ emits a rotation code
 *   even in path-highlight mode (column not covered by columnHighlights):
 *   - branchPlusRollback: all-edges-on-path → ∅ ╯ still uses magenta (rotation)
 *   - branchPlusRollback: all-edges-off-path → ∅ ╯ still uses magenta (rotation)
 *
 * ============================================================
 * Assertions that CURRENTLY PASS:
 * ============================================================
 *   - All normal-rotation tests (no edgeAnnotationsByHash)
 *   - Linear path-highlight (straightLine) — no shared columns, no arcs
 *   - twoBranches: off-path branch row carries DIM, on-path trunk row carries GREEN
 *   - Per-cell dirName / 'will run' / 'no rotation in path-highlight mode' checks
 *   - diamond/rollback: edge rows themselves carry the right colour
 *   - No-rotation cross-cutting invariant for all topologies EXCEPT branchPlusRollback
 *
 * ============================================================
 * IMPORTANT BEHAVIOURAL NOTE (FIX D, already correct):
 * ============================================================
 * An off-path edge ROW may contain GREEN_BRIGHT if a different, on-path edge has a
 * vertical-pass through that row in a different column. The vertical-pass colour comes
 * from the COLUMN's dominant annotation, not the row's edge. This is CORRECT. The
 * bug is only in CONNECTOR/ARC-BODY rows — not in vertical-pass cells.
 *
 * So these tests assert colour of SPECIFIC CELLS (connector corners, arc bodies),
 * NOT the colour of the whole line. Helper `lastCodeBefore(line, glyph)` isolates
 * the ANSI code that immediately precedes a glyph to make per-cell assertions.
 *
 * ============================================================
 * ANSI codes emitted by forcedGreen/forcedDim (createColors({useColor:true})):
 *   GREEN_BRIGHT = \x1b[92m   (forcedGreen / on-path)
 *   DIM         = \x1b[2m    (forcedDim / off-path)
 *
 * LANE_COLOR_CYCLE codes (column → 0-indexed cycle):
 *   col 1 → magenta  \x1b[35m
 *   col 2 → cyan     \x1b[36m
 *   col 3 → green    \x1b[32m  (rotation green, NOT forced on-path green)
 *   col 4 → yellow   \x1b[33m
 *   col 5 → blueBright \x1b[94m
 *   col 6 → red      \x1b[31m
 *
 * IMPORTANT: Biome's `noControlCharactersInRegex` rejects regex literals that
 * contain \x1b characters. Assert ANSI codes by string containment / indexOf,
 * NOT by /\x1b.../ patterns.
 */

import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import type { MigrationEdge, MigrationGraph } from '@prisma-next/migration-tools/graph';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { laneColorForColumn } from '../../../src/utils/formatters/migration-graph-lane-colors';
import { buildMigrationGraphLayout } from '../../../src/utils/formatters/migration-graph-layout';
import { buildMigrationGraphRows } from '../../../src/utils/formatters/migration-graph-rows';
import { renderMigrationGraphTree } from '../../../src/utils/formatters/migration-graph-tree-render';

// ---------------------------------------------------------------------------
// ANSI constants for forced-colour functions (bypass NO_COLOR=1)
// ---------------------------------------------------------------------------
const GREEN_BRIGHT = '\x1b[92m';
const DIM = '\x1b[2m';

// LANE_COLOR_CYCLE ANSI codes (column ≥ 1, 0-indexed cycle)
const LANE_CODES: Record<number, string> = {
  1: '\x1b[35m', // magenta
  2: '\x1b[36m', // cyan
  3: '\x1b[32m', // green (rotation, NOT the forced on-path green)
  4: '\x1b[33m', // yellow
  5: '\x1b[94m', // blueBright
  6: '\x1b[31m', // red
};

/** All rotation ANSI codes (any column ≥ 1). */
const ALL_ROTATION_CODES = Object.values(LANE_CODES);

// ---------------------------------------------------------------------------
// Per-cell assertion helpers
// ---------------------------------------------------------------------------

type ColourClass = 'green' | 'dim' | 'rotation' | 'neutral';

/** Classify a raw ANSI escape code (e.g. "\x1b[92m") into a colour class. */
function classifyCode(code: string): ColourClass {
  if (code === GREEN_BRIGHT) return 'green';
  if (code === DIM) return 'dim';
  if (ALL_ROTATION_CODES.includes(code)) return 'rotation';
  return 'neutral';
}

/**
 * Split a line into colour-classified segments at ANSI escape boundaries.
 * Only segments with at least one non-whitespace character are included.
 *
 * Each segment carries the leading ANSI code of that run, classified as:
 *   'green'    → \x1b[92m (forcedGreen / on-path)
 *   'dim'      → \x1b[2m  (forcedDim / off-path)
 *   'rotation' → any LANE_COLOR_CYCLE code
 *   'neutral'  → no ANSI code (plain text)
 *
 * NOTE: Does NOT use a regex with control characters (biome rejects those).
 * Splits on the ESC character (\x1b) directly.
 */
function classifyLineGlyphs(line: string): Array<{
  code: string;
  text: string;
  class: ColourClass;
}> {
  const ESC = '\x1b';
  const segments: Array<{ code: string; text: string; class: ColourClass }> = [];
  const parts = line.split(ESC);

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === undefined) continue;

    if (i === 0) {
      // Plain text before any escape code.
      if (part.replace(/\s+/g, '').length > 0) {
        segments.push({ code: '', text: part, class: 'neutral' });
      }
      continue;
    }

    // Each subsequent part starts with "[...m" continuing an escape sequence.
    const mIdx = part.indexOf('m');
    if (mIdx === -1) continue;

    const fullCode = ESC + part.slice(0, mIdx + 1); // e.g. "\x1b[92m"
    const text = part.slice(mIdx + 1); // text after the code

    if (text.replace(/\s+/g, '').length > 0) {
      segments.push({ code: fullCode, text, class: classifyCode(fullCode) });
    }
  }

  return segments;
}

/**
 * Assert that a rendered line's non-whitespace glyph runs match `expected` colour
 * classes in order.
 *
 * Each entry in `expected` maps to one ANSI-code segment (containing at least one
 * non-whitespace character). Use this for structural/connector rows where the full
 * segment sequence is known and predictable.
 *
 * For edge rows (which also contain hash colouring from the styler), use the
 * per-glyph helpers `lastCodeBefore` and `assertNoRotationCodes` instead.
 */
function assertRowColors(line: string, expected: ColourClass[], message?: string): void {
  const actual = classifyLineGlyphs(line);
  const actualClasses = actual.map((s) => s.class);
  for (let i = 0; i < expected.length; i++) {
    expect(
      actualClasses[i],
      `${message ? `${message}: ` : ''}segment[${i}] of "${stripAnsi(line)}" should be ${expected[i]} but got ${actualClasses[i]} (full: ${JSON.stringify(actualClasses)})`,
    ).toBe(expected[i]);
  }
  expect(
    actualClasses.length,
    `${message ? `${message}: ` : ''}expected ${expected.length} colour segments in "${stripAnsi(line)}" but got ${actualClasses.length}: ${JSON.stringify(actualClasses)}`,
  ).toBe(expected.length);
}

/**
 * Find the most recent ANSI escape code that appears in `line` BEFORE the first
 * occurrence of `glyph`. Returns the raw code string (e.g. "\x1b[92m") or '' if
 * no escape precedes the glyph.
 *
 * This isolates the colour of a SPECIFIC glyph character within a multi-coloured
 * line — essential for connector rows where different columns carry different colours.
 */
function lastCodeBefore(line: string, glyph: string): string {
  const glyphIdx = line.indexOf(glyph);
  if (glyphIdx === -1) return '';
  const before = line.slice(0, glyphIdx);
  const ESC = '\x1b';
  const parts = before.split(ESC);
  // Walk backwards through parts to find the last escape code.
  for (let i = parts.length - 1; i >= 1; i--) {
    const part = parts[i];
    if (part === undefined) continue;
    const mIdx = part.indexOf('m');
    if (mIdx !== -1) {
      return ESC + part.slice(0, mIdx + 1);
    }
  }
  return '';
}

/**
 * Assert that NO rotation codes appear anywhere in a rendered output.
 * Used in path-highlight mode where rotation must be fully suppressed.
 */
function assertNoRotationCodes(rendered: string, context: string): void {
  for (const code of ALL_ROTATION_CODES) {
    expect(
      rendered,
      `${context}: rotation code ${JSON.stringify(code)} must not appear`,
    ).not.toContain(code);
  }
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------
let migSeq = 0;

function edge(from: string, to: string, dirName: string): MigrationEdge {
  return {
    from,
    to,
    migrationHash: `sha256:col-${migSeq++}-${dirName}`,
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

function renderEdges(
  edges: readonly MigrationEdge[],
  opts: Parameters<typeof renderMigrationGraphTree>[1] = { colorize: false },
): string {
  const rowModel = buildMigrationGraphRows(graph(edges), {
    ...(opts.contractHash !== undefined ? { contractHash: opts.contractHash } : {}),
  });
  const layout = buildMigrationGraphLayout(rowModel);
  return renderMigrationGraphTree(layout, opts);
}

// ---------------------------------------------------------------------------
// Named fixture edge-sets (reused across sub-suites)
// ---------------------------------------------------------------------------

/**
 * Straight line: ∅ → a → b → c
 * One column, no branching. The simplest topology.
 */
function straightLineEdges(): readonly MigrationEdge[] {
  const init = edge(EMPTY_CONTRACT_HASH, 'sl_a', 'sl_init');
  const step = edge('sl_a', 'sl_b', 'sl_step');
  const last = edge('sl_b', 'sl_c', 'sl_last');
  return [init, step, last];
}

/**
 * Two branches from ∅: ∅ → a (col 0) and ∅ → b (col 1).
 * Both are "leaves"; neither merges. The bottom connector is `├─╯` (merge into ∅).
 * Tests branch spine coloring.
 */
function twoBranchesEdges(): readonly MigrationEdge[] {
  const trunk = edge(EMPTY_CONTRACT_HASH, 'tb_a', 'tb_trunk');
  const branch = edge(EMPTY_CONTRACT_HASH, 'tb_b', 'tb_branch');
  return [trunk, branch];
}

/**
 * Branch + node-skipping rollback:
 *   ∅ → rb_a → rb_b → rb_c (trunk, col 0)
 *   rb_c → ∅ (node-skipping rollback, back-lane col ≥ 1)
 *
 * The rollback arc body (corner, bridge) and the ∅ landing corner are the test surface.
 * Layout: the rollback arc branches from rb_c with a ╮, then a vertical lane, landing
 * at ∅ with a ╯. Both ╮ and ╯ should be coloured by the rollback edge's path-highlight.
 */
function branchPlusRollbackEdges(): readonly MigrationEdge[] {
  const init = edge(EMPTY_CONTRACT_HASH, 'rb_a', 'rb_init');
  const step = edge('rb_a', 'rb_b', 'rb_step');
  const advance = edge('rb_b', 'rb_c', 'rb_advance');
  // Node-skipping rollback: from rb_c back to ∅ (skips rb_a and rb_b)
  const rollback = edge('rb_c', EMPTY_CONTRACT_HASH, 'rb_rollback');
  return [init, step, advance, rollback];
}

/**
 * Diamond: fork + merge.
 *   ∅ → dm_root → dm_alice (col 0) → dm_merge
 *               → dm_bob   (col 1) → dm_merge
 *
 * Branch connector (╮) is above dm_bob; merge connector (╯) is below it.
 * The ╮ and ╯ corners at col-1 (bob's column) are the bleed-guard test surface.
 */
function diamondEdges(): readonly MigrationEdge[] {
  const init = edge(EMPTY_CONTRACT_HASH, 'dm_root', 'dm_init');
  const alice = edge('dm_root', 'dm_alice', 'dm_alice');
  const bob = edge('dm_root', 'dm_bob', 'dm_bob');
  const mergeAlice = edge('dm_alice', 'dm_merge', 'dm_merge_alice');
  const mergeBob = edge('dm_bob', 'dm_merge', 'dm_merge_bob');
  return [init, alice, bob, mergeAlice, mergeBob];
}

/**
 * Rollback on-path: linear chain with a node-skipping rollback that IS on the
 * chosen path.
 *
 *   ∅ → rp_a → rp_b → rp_c (trunk)
 *   rp_c → rp_a (node-skipping rollback, on-path)
 *
 * Arc corners/bridges of the rollback must be green when the rollback is on-path.
 */
function rollbackOnPathEdges(): readonly MigrationEdge[] {
  const init = edge(EMPTY_CONTRACT_HASH, 'rp_a', 'rp_init');
  const step = edge('rp_a', 'rp_b', 'rp_step');
  const advance = edge('rp_b', 'rp_c', 'rp_advance');
  const rollback = edge('rp_c', 'rp_a', 'rp_rollback');
  return [init, step, advance, rollback];
}

/**
 * Loop via invariant: chain + a self-loop (from === to) on the chosen path.
 *
 *   ∅ → lp_a → lp_b (trunk)
 *   lp_b → lp_b (self-loop, on-path)
 */
function loopViaInvariantEdges(): readonly MigrationEdge[] {
  const init = edge(EMPTY_CONTRACT_HASH, 'lp_a', 'lp_init');
  const step = edge('lp_a', 'lp_b', 'lp_step');
  const selfLoop = edge('lp_b', 'lp_b', 'lp_noop');
  return [init, step, selfLoop];
}

/**
 * Showcase fixture: the complex multi-lane graph used throughout the existing colour
 * tests. Covers rollback arcs, crossing, fast-forward, self-loop, multiple fan-out/in.
 */
function showcaseEdges(): readonly MigrationEdge[] {
  const init = edge(EMPTY_CONTRACT_HASH, '3bfce91', '20260601T0719_init');
  const addName = edge('3bfce91', '419c099', '20260601T0725_add_name');
  const alicePhone = edge('419c099', 'f5aa17d', '20260601T0725_alice_phone');
  const bobAvatar = edge('419c099', '935a023', '20260601T0725_bob_avatar');
  const addBio = edge('83a1ded', '3705eb1', '20260601T0726_add_bio');
  const addLocale = edge('3705eb1', 'bf158ef', '20260601T0726_add_locale');
  const fastForward = edge('3bfce91', '83a1ded', '20260601T0726_fast_forward');
  const mergeAlice = edge('f5aa17d', '83a1ded', '20260601T0726_merge_alice');
  const mergeBob = edge('935a023', '83a1ded', '20260601T0726_merge_bob');
  const rollbackAlice = edge('f5aa17d', '3bfce91', '20260601T0727_rollback_alice');
  const rollbackLocale = edge('bf158ef', '3705eb1', '20260601T0727_rollback_locale');
  const rollbackUsers = edge('bf158ef', '419c099', '20260601T0727_rollback_users');
  const hotfix = edge('bf158ef', 'f660984', '20260601T0727_hotfix');
  const promoteBob = edge('935a023', 'f660984', '20260601T0728_promote_bob');
  const reapplyNoop = edge('f660984', 'f660984', '20260601T0729_reapply_noop');
  return [
    init,
    addName,
    alicePhone,
    bobAvatar,
    addBio,
    addLocale,
    fastForward,
    mergeAlice,
    mergeBob,
    rollbackAlice,
    rollbackLocale,
    rollbackUsers,
    hotfix,
    promoteBob,
    reapplyNoop,
  ];
}

// ---------------------------------------------------------------------------
// Helper: build path-annotation map from (on-path hashes, all hashes)
// ---------------------------------------------------------------------------
function annotations(
  edges: readonly MigrationEdge[],
  onPathHashes: ReadonlySet<string>,
): Map<string, { pathHighlight: 'on-path' | 'off-path' }> {
  return new Map(
    edges.map((e) => [
      e.migrationHash,
      {
        pathHighlight: onPathHashes.has(e.migrationHash)
          ? ('on-path' as const)
          : ('off-path' as const),
      },
    ]),
  );
}

// ---------------------------------------------------------------------------
// The colour matrix
// ---------------------------------------------------------------------------

describe('graph colouring', () => {
  // =========================================================================
  // straight line
  // =========================================================================
  describe('straightLine', () => {
    const edges = straightLineEdges();

    it('normal rotation: col-0 neutral, no green/dim/rotation', () => {
      const rendered = renderEdges(edges, { colorize: true });
      // Single column — no rotation, green, or dim.
      assertNoRotationCodes(rendered, 'straight-line normal');
      expect(rendered, 'no green on straight-line normal').not.toContain(GREEN_BRIGHT);
      expect(rendered, 'no dim on straight-line normal').not.toContain(DIM);
    });

    it('path-highlight trunk: all edges on-path → all green, no rotation, no dim', () => {
      const onPath = new Set(edges.map((e) => e.migrationHash));
      const anno = annotations(edges, onPath);
      const rendered = renderEdges(edges, { colorize: true, edgeAnnotationsByHash: anno });

      assertNoRotationCodes(rendered, 'straight-line all-on-path');
      expect(rendered, 'green present for on-path').toContain(GREEN_BRIGHT);
      expect(rendered, 'no dim when all on-path').not.toContain(DIM);

      // Each on-path edge row has 'will run' suffix and starts with a green lane glyph.
      // assertRowColors verifies that the first segment is green (col-0 on-path = forcedGreen)
      // and the second is neutral (direction arrow with identity styler).
      // Single-lane rows have no hash-colour segments visible before the reset because the
      // edge row is: GREEN(│) NEUTRAL(↑  dirName...) — with hash styling coming after.
      for (const e of edges) {
        const line = rendered.split('\n').find((l) => l.includes(e.dirName));
        expect(line, `${e.dirName} line must exist`).toBeDefined();
        expect(line, `${e.dirName} must carry 'will run'`).toContain('will run');
        if (line !== undefined) {
          // The lane glyph (first glyph) must be GREEN_BRIGHT.
          const codeForFirstGlyph = lastCodeBefore(line, '│');
          expect(
            codeForFirstGlyph,
            `${e.dirName}: lane glyph │ must be preceded by GREEN_BRIGHT`,
          ).toBe(GREEN_BRIGHT);
        }
      }
    });

    it('path-highlight: first two on-path, last off-path → on-path rows green, off-path row dim', () => {
      const onPath = new Set([edges[0]!.migrationHash, edges[1]!.migrationHash]);
      const anno = annotations(edges, onPath);
      const rendered = renderEdges(edges, { colorize: true, edgeAnnotationsByHash: anno });

      assertNoRotationCodes(rendered, 'straight-line partial path-highlight');

      const offEdge = edges[2]!;
      const offLine = rendered.split('\n').find((l) => l.includes(offEdge.dirName));
      expect(offLine, 'off-path edge line exists').toBeDefined();
      expect(offLine, 'off-path edge line carries dim').toContain(DIM);
      // The off-path lane glyph must be dim.
      if (offLine !== undefined) {
        const code = lastCodeBefore(offLine, '│');
        expect(code, 'off-path lane glyph must be preceded by DIM').toBe(DIM);
      }
    });

    it('assertRowColors helper: all-on-path connector rows in straight line have no structural rows', () => {
      // Straight line has no connector rows — only edge rows and node rows.
      // This test verifies assertRowColors itself on a simple case: the ∅ row at the bottom.
      // The ∅ row in path-highlight mode (all on-path) renders as: neutral(∅) with no ANSI.
      const onPath = new Set(edges.map((e) => e.migrationHash));
      const anno = annotations(edges, onPath);
      const rendered = renderEdges(edges, { colorize: true, edgeAnnotationsByHash: anno });
      const emptyRow = rendered.split('\n').find((l) => stripAnsi(l).trim() === '∅');
      expect(emptyRow, '∅ row must exist').toBeDefined();
      if (emptyRow !== undefined) {
        // The ∅ row has no ANSI codes — it's plain.
        assertRowColors(emptyRow, ['neutral'], '∅ row must be neutral');
      }
    });
  });

  // =========================================================================
  // two branches
  // =========================================================================
  describe('twoBranches', () => {
    const edges = twoBranchesEdges();

    it('normal rotation: col-0 neutral, col-1 rotation hue', () => {
      const rendered = renderEdges(edges, { colorize: true });

      // Col-1 branch (tb_branch) must have a rotation colour on its lane glyph.
      const branchLine = rendered.split('\n').find((l) => l.includes('tb_branch'));
      expect(branchLine, 'branch edge line must exist').toBeDefined();
      expect(branchLine, 'branch edge must have rotation').toContain(laneColorForColumn(1)('↑'));

      // Col-0 trunk must NOT have col-1 rotation on the arrow.
      const trunkLine = rendered.split('\n').find((l) => l.includes('tb_trunk'));
      expect(trunkLine, 'trunk edge line must exist').toBeDefined();
      expect(trunkLine, 'trunk edge must NOT have col-1 rotation').not.toContain(
        laneColorForColumn(1)('↑'),
      );

      // No green or dim in normal mode.
      expect(rendered, 'no green in normal rotation').not.toContain(GREEN_BRIGHT);
      expect(rendered, 'no dim in normal rotation').not.toContain(DIM);
    });

    it('path-highlight trunk (tb_trunk on-path, tb_branch off-path): trunk glyph green, branch glyph dim', () => {
      const onPath = new Set([edges[0]!.migrationHash]); // tb_trunk
      const anno = annotations(edges, onPath);
      const rendered = renderEdges(edges, { colorize: true, edgeAnnotationsByHash: anno });

      assertNoRotationCodes(rendered, 'two-branches path-highlight trunk');

      // On-path trunk edge row: lane glyph (col-0, the trunk's own glyph) must be green.
      const trunkLine = rendered.split('\n').find((l) => l.includes('tb_trunk'));
      expect(trunkLine, 'trunk line exists').toBeDefined();
      expect(trunkLine, 'trunk line carries green').toContain(GREEN_BRIGHT);

      // The off-path branch edge row has:
      //   col 0: GREEN pass-through (trunk is on-path, FIX D — CORRECT)
      //   col 1: DIM branch glyph (branch is off-path — must be DIM)
      // We assert that the branch's OWN lane glyph (col-1, ↑) is dim.
      const branchLine = rendered.split('\n').find((l) => l.includes('tb_branch'));
      expect(branchLine, 'branch line exists').toBeDefined();
      if (branchLine !== undefined) {
        // The arrow ↑ belongs to the branch edge (col-1). Its preceding code must be DIM.
        const codeForArrow = lastCodeBefore(branchLine, '↑');
        expect(codeForArrow, 'branch col-1 arrow must be preceded by DIM').toBe(DIM);
      }

      // Off-path branch node (tb_b) must be dim (its ○ glyph is dim).
      const branchNodeLine = rendered
        .split('\n')
        .find((l) => l.includes('tb_b') && !l.includes('tb_branch'));
      expect(branchNodeLine, 'branch node line exists').toBeDefined();
      expect(branchNodeLine, 'branch node carries dim').toContain(DIM);
    });

    it('path-highlight alternate branch (tb_branch on-path, tb_trunk off-path): branch glyph green, trunk glyph dim', () => {
      const onPath = new Set([edges[1]!.migrationHash]); // tb_branch
      const anno = annotations(edges, onPath);
      const rendered = renderEdges(edges, { colorize: true, edgeAnnotationsByHash: anno });

      assertNoRotationCodes(rendered, 'two-branches path-highlight branch');

      // The on-path branch edge row has:
      //   col 0: DIM pass-through (trunk is off-path — CORRECT per FIX D)
      //   col 1: GREEN branch lane glyph (branch is on-path)
      // The lane glyph │ at col-1 is rendered as GREEN(│)RESET(↑...) — the arrow
      // immediately follows the reset code, not the green. We assert the green lane
      // glyph itself is present: GREEN_BRIGHT immediately followed by │.
      const branchLine = rendered.split('\n').find((l) => l.includes('tb_branch'));
      expect(branchLine, 'branch line exists').toBeDefined();
      // The col-1 lane glyph must be green: GREEN_BRIGHT + '│' appears somewhere in the line.
      expect(branchLine, 'branch col-1 lane glyph must be GREEN_BRIGHT').toContain(
        GREEN_BRIGHT + '│',
      );

      // The off-path trunk edge row must carry dim on its own col-0 glyph.
      const trunkLine = rendered.split('\n').find((l) => l.includes('tb_trunk'));
      expect(trunkLine, 'trunk line exists').toBeDefined();
      expect(trunkLine, 'trunk col-0 glyph must be DIM').toContain(DIM);
    });

    it('path-highlight trunk: bottom connector ╯ (col-1, off-path branch) must be DIM', () => {
      // twoBranches topology (both edges from ∅) has a bottom merge connector ├─╯
      // where the ╯ corner belongs to the off-path branch (col-1).
      // The trunk (col-0) is on-path. The ╯ corner MUST be DIM (not green).
      //
      // BUG: The current code maps the column-1 highlight as on-path if the trunk
      // edge (col-0) "wins" via contractHighlights. But this test uses columnHighlights,
      // and the branch column (col-1) is correctly marked off-path in columnHighlights.
      // The bug here is subtler: the connector row iterates `columnHighlights` and
      // the off-path branch's column SHOULD produce DIM on its corner.
      //
      // This test CURRENTLY PASSES if the connector correctly uses columnHighlights per-column.
      // If it fails, the connector coloring logic in renderConnectorRow has a bug.
      const onPath = new Set([edges[0]!.migrationHash]); // tb_trunk
      const anno = annotations(edges, onPath);
      const rendered = renderEdges(edges, { colorize: true, edgeAnnotationsByHash: anno });

      // Find the bottom connector row (├─╯) — no ↑ or ↓ arrows.
      const connectorLine = rendered.split('\n').find((l) => {
        const plain = stripAnsi(l);
        return plain.includes('╯') && !plain.includes('↑') && !plain.includes('↓');
      });
      expect(connectorLine, 'bottom connector ├─╯ must exist').toBeDefined();

      if (connectorLine !== undefined) {
        // The ╯ corner belongs to col-1 (off-path branch).
        // Its preceding ANSI code must be DIM.
        const codeForCorner = lastCodeBefore(connectorLine, '╯');
        expect(
          codeForCorner,
          'connector ╯ (off-path branch col-1) must be preceded by DIM, not green. ' +
            `Line: ${JSON.stringify(connectorLine)}`,
        ).toBe(DIM);
      }
    });
  });

  // =========================================================================
  // branch + rollback
  // =========================================================================
  describe('branchPlusRollback', () => {
    const edges = branchPlusRollbackEdges();

    it('normal rotation: rollback arc body uses back-lane hue, not green/dim', () => {
      const rendered = renderEdges(edges, { colorize: true });
      expect(rendered, 'no green in normal rotation').not.toContain(GREEN_BRIGHT);
      expect(rendered, 'no forced-dim in normal rotation').not.toContain(DIM);
      // The arc body must contain some rotation hue (the back-lane column).
      const hasRotation = ALL_ROTATION_CODES.some((code) => rendered.includes(code));
      expect(hasRotation, 'rollback arc body has back-lane rotation hue').toBe(true);
    });

    it('path-highlight: trunk on-path, rollback off-path → trunk edge rows green, rollback edge row dim', () => {
      const onPath = new Set([
        edges[0]!.migrationHash,
        edges[1]!.migrationHash,
        edges[2]!.migrationHash,
      ]);
      const anno = annotations(edges, onPath);
      const rendered = renderEdges(edges, { colorize: true, edgeAnnotationsByHash: anno });

      // Trunk edge rows must carry green on their lane glyphs.
      for (const e of [edges[0]!, edges[1]!, edges[2]!]) {
        const line = rendered.split('\n').find((l) => l.includes(e.dirName));
        expect(line, `${e.dirName} line must exist`).toBeDefined();
        expect(line, `${e.dirName} carries green`).toContain(GREEN_BRIGHT);
      }

      // Rollback edge row must carry dim.
      const rollbackLine = rendered.split('\n').find((l) => l.includes('rb_rollback'));
      expect(rollbackLine, 'rollback line exists').toBeDefined();
      expect(rollbackLine, 'rollback line carries dim').toContain(DIM);
      if (rollbackLine !== undefined) {
        const codeForArrow = lastCodeBefore(rollbackLine, '↓');
        expect(codeForArrow, 'rollback col-1 ↓ arrow must be DIM').toBe(DIM);
      }
    });

    it('path-highlight: rollback on-path → rollback edge row green, trunk edge rows dim', () => {
      const onPath = new Set([edges[3]!.migrationHash]); // rb_rollback
      const anno = annotations(edges, onPath);
      const rendered = renderEdges(edges, { colorize: true, edgeAnnotationsByHash: anno });

      // Rollback edge row must carry green.
      const rollbackLine = rendered.split('\n').find((l) => l.includes('rb_rollback'));
      expect(rollbackLine, 'rollback line exists').toBeDefined();
      expect(rollbackLine, 'rollback line carries green').toContain(GREEN_BRIGHT);
      expect(rollbackLine, 'rollback has will run').toContain('will run');

      // Trunk lines must carry dim on their OWN glyphs.
      for (const e of [edges[0]!, edges[1]!, edges[2]!]) {
        const line = rendered.split('\n').find((l) => l.includes(e.dirName));
        expect(line, `${e.dirName} line must exist`).toBeDefined();
        expect(line, `${e.dirName} carries dim`).toContain(DIM);
      }

      // CRUCIAL — ARC BODY BUG: The rollback arc corner ╮ (at rb_c, the departure
      // point) and the ╯ corner at ∅ (the landing) are structural rows coloured by
      // column. The rollback's back-lane column SHOULD map to 'on-path' via
      // columnHighlights → the arc body should be GREEN_BRIGHT. But the current code
      // uses the column that the rollback OCCUPIES in the front-lanes, which is the
      // trunk column. The trunk is off-path → the arc body bleeds dim instead of green.
      //
      // Additionally, the ∅ node landing row `∅ ╯` has the ╯ in an ARC lane that the
      // renderer renders with the normal laneColorForColumn (rotation) rather than path-
      // highlight, because the ∅ row is classified by contractHighlights but ∅ is not
      // tracked as a contract hash (EMPTY_CONTRACT_HASH is skipped in the loop).
      //
      // ASSERT: the arc body rows (containing ╮ or ╯, not edge label rows) must contain
      // GREEN_BRIGHT. This assertion CURRENTLY FAILS.
      const arcBodyRows = rendered.split('\n').filter((l) => {
        const plain = stripAnsi(l);
        return (
          (plain.includes('╮') || plain.includes('╯')) &&
          !plain.includes('↑') &&
          !plain.includes('↓')
        );
      });
      const anyArcBodyGreen = arcBodyRows.some((l) => l.includes(GREEN_BRIGHT));
      expect(
        anyArcBodyGreen,
        'On-path rollback arc body rows must contain GREEN_BRIGHT. ' +
          `Arc body rows:\n${arcBodyRows.map((l) => `  ${JSON.stringify(stripAnsi(l))}: ${JSON.stringify(l)}`).join('\n')}` +
          `\nFull output:\n${stripAnsi(rendered)}`,
      ).toBe(true);
    });
  });

  // =========================================================================
  // diamond
  // =========================================================================
  describe('diamond', () => {
    const edges = diamondEdges();

    it('normal rotation: col-0 neutral, col-1 rotation', () => {
      const rendered = renderEdges(edges, { colorize: true });
      expect(rendered, 'col-1 rotation present (│ )').toContain(laneColorForColumn(1)('│ '));
      expect(rendered, 'no green in normal rotation').not.toContain(GREEN_BRIGHT);
      expect(rendered, 'no forced-dim in normal rotation').not.toContain(DIM);
    });

    it('path-highlight along alice branch: alice edge rows green, bob edge rows dim', () => {
      const aliceEdge = edges.find((e) => e.dirName === 'dm_alice')!;
      const mergeAliceEdge = edges.find((e) => e.dirName === 'dm_merge_alice')!;
      const initEdge = edges.find((e) => e.dirName === 'dm_init')!;
      const onPath = new Set([
        initEdge.migrationHash,
        aliceEdge.migrationHash,
        mergeAliceEdge.migrationHash,
      ]);
      const anno = annotations(edges, onPath);
      const rendered = renderEdges(edges, { colorize: true, edgeAnnotationsByHash: anno });

      assertNoRotationCodes(rendered, 'diamond alice path-highlight');

      // On-path alice edge rows must carry green on their OWN glyphs.
      for (const e of [initEdge, aliceEdge, mergeAliceEdge]) {
        const line = rendered.split('\n').find((l) => l.includes(e.dirName));
        expect(line, `${e.dirName} must exist`).toBeDefined();
        expect(line, `${e.dirName} carries green`).toContain(GREEN_BRIGHT);
      }

      // Off-path bob edge: its OWN col-1 arrow (↑) must be DIM.
      const bobEdge = edges.find((e) => e.dirName === 'dm_bob')!;
      const bobLine = rendered.split('\n').find((l) => l.includes(bobEdge.dirName));
      expect(bobLine, 'bob line exists').toBeDefined();
      expect(bobLine, 'bob line carries dim').toContain(DIM);
      if (bobLine !== undefined) {
        const code = lastCodeBefore(bobLine, '↑');
        expect(code, 'bob col-1 ↑ arrow must be preceded by DIM').toBe(DIM);
      }

      // Off-path merge_bob edge: its OWN col-1 arrow must be DIM.
      const mergeBobEdge = edges.find((e) => e.dirName === 'dm_merge_bob')!;
      const mergeBobLine = rendered.split('\n').find((l) => l.includes(mergeBobEdge.dirName));
      expect(mergeBobLine, 'merge_bob line exists').toBeDefined();
      if (mergeBobLine !== undefined) {
        const code = lastCodeBefore(mergeBobLine, '↑');
        expect(code, 'merge_bob col-1 ↑ arrow must be preceded by DIM').toBe(DIM);
      }

      // BLEED GUARD — BRANCH CONNECTOR: The ╮ corner in the branch connector `├─╮`
      // belongs to col-1 (bob, off-path). The col-0 trunk (alice, on-path) is in
      // the same connector row. With "on-path wins", col-0 on-path green bleeds to
      // the connector's col-1 position when columnHighlights is built from the entire
      // edge set. The ╮ corner should be DIM but currently shows GREEN_BRIGHT.
      //
      // This assertion CURRENTLY FAILS.
      const branchConnector = rendered.split('\n').find((l) => {
        const plain = stripAnsi(l);
        return plain.includes('╮') && !plain.includes('↑') && !plain.includes('↓');
      });
      expect(branchConnector, 'branch connector ├─╮ must exist').toBeDefined();
      if (branchConnector !== undefined) {
        const codeForCorner = lastCodeBefore(branchConnector, '╮');
        expect(
          codeForCorner,
          'Branch connector ╮ (bob, off-path col-1) must be preceded by DIM. ' +
            `Line: ${JSON.stringify(branchConnector)}`,
        ).toBe(DIM);
      }

      // BLEED GUARD — MERGE CONNECTOR: The ╯ corner in the merge connector belongs to
      // col-1 (bob, off-path). Same reasoning — must be DIM.
      //
      // This assertion CURRENTLY FAILS.
      const mergeConnector = rendered.split('\n').find((l) => {
        const plain = stripAnsi(l);
        return plain.includes('╯') && !plain.includes('↑') && !plain.includes('↓');
      });
      expect(mergeConnector, 'merge connector ├─╯ must exist').toBeDefined();
      if (mergeConnector !== undefined) {
        const codeForCorner = lastCodeBefore(mergeConnector, '╯');
        expect(
          codeForCorner,
          'Merge connector ╯ (bob, off-path col-1) must be preceded by DIM. ' +
            `Line: ${JSON.stringify(mergeConnector)}`,
        ).toBe(DIM);
      }
    });

    it('path-highlight along bob branch: bob edge rows green, alice edge rows dim', () => {
      const bobEdge = edges.find((e) => e.dirName === 'dm_bob')!;
      const mergeBobEdge = edges.find((e) => e.dirName === 'dm_merge_bob')!;
      const initEdge = edges.find((e) => e.dirName === 'dm_init')!;
      const onPath = new Set([
        initEdge.migrationHash,
        bobEdge.migrationHash,
        mergeBobEdge.migrationHash,
      ]);
      const anno = annotations(edges, onPath);
      const rendered = renderEdges(edges, { colorize: true, edgeAnnotationsByHash: anno });

      assertNoRotationCodes(rendered, 'diamond bob path-highlight');

      // On-path bob edge: col-1 lane glyph must be GREEN.
      // The lane is rendered GREEN(│)RESET(↑...) — assert GREEN_BRIGHT + '│' is present.
      const bobLine = rendered.split('\n').find((l) => l.includes(bobEdge.dirName));
      expect(bobLine, 'bob line exists').toBeDefined();
      expect(bobLine, 'bob col-1 lane glyph must be GREEN_BRIGHT').toContain(GREEN_BRIGHT + '│');

      // Off-path alice edge: col-0 arrow must be DIM.
      const aliceEdge = edges.find((e) => e.dirName === 'dm_alice')!;
      const aliceLine = rendered.split('\n').find((l) => l.includes(aliceEdge.dirName));
      expect(aliceLine, 'alice line exists').toBeDefined();
      expect(aliceLine, 'alice line carries dim').toContain(DIM);
    });
  });

  // =========================================================================
  // rollback on-path
  // =========================================================================
  describe('rollbackOnPath', () => {
    const edges = rollbackOnPathEdges();

    it('normal rotation: rollback arc has back-lane hue', () => {
      const rendered = renderEdges(edges, { colorize: true });
      expect(rendered, 'no forced-green in normal rotation').not.toContain(GREEN_BRIGHT);
      const hasRotation = ALL_ROTATION_CODES.some((code) => rendered.includes(code));
      expect(hasRotation, 'rollback arc body has rotation hue').toBe(true);
    });

    it('path-highlight: rollback on-path → rollback edge row green, arc corners contain green', () => {
      const rollbackEdge = edges.find((e) => e.dirName === 'rp_rollback')!;
      const onPath = new Set([rollbackEdge.migrationHash]);
      const anno = annotations(edges, onPath);
      const rendered = renderEdges(edges, { colorize: true, edgeAnnotationsByHash: anno });

      assertNoRotationCodes(rendered, 'rollbackOnPath rollback on-path');

      // Rollback edge row must carry green.
      const rollbackLine = rendered.split('\n').find((l) => l.includes('rp_rollback'));
      expect(rollbackLine, 'rollback line exists').toBeDefined();
      expect(rollbackLine, 'rollback line carries green').toContain(GREEN_BRIGHT);

      // Trunk edge rows must carry dim (all are off-path).
      for (const e of [edges[0]!, edges[1]!, edges[2]!]) {
        const line = rendered.split('\n').find((l) => l.includes(e.dirName));
        expect(line, `${e.dirName} line must exist`).toBeDefined();
        expect(line, `${e.dirName} carries dim`).toContain(DIM);
      }

      // CRUCIAL — ARC BODY: The rollback arc corners (╮ at rp_c departure, ╯ at rp_a
      // landing) are structural rows. Their colour should be GREEN (on-path rollback).
      // But the current renderer colours them via columnHighlights by the column they
      // occupy, which is the TRUNK column → these rows get DIM instead of green.
      //
      // This assertion CURRENTLY FAILS.
      const arcCornerRows = rendered.split('\n').filter((l) => {
        const plain = stripAnsi(l);
        return (
          (plain.includes('╮') || plain.includes('╯')) &&
          !plain.includes('↑') &&
          !plain.includes('↓')
        );
      });
      const anyArcCornerGreen = arcCornerRows.some((l) => l.includes(GREEN_BRIGHT));
      expect(
        anyArcCornerGreen,
        'On-path rollback arc corners must contain GREEN_BRIGHT. ' +
          `Arc corner rows found: ${JSON.stringify(arcCornerRows.map(stripAnsi))}. ` +
          `Full output:\n${stripAnsi(rendered)}`,
      ).toBe(true);
    });

    it('path-highlight: trunk on-path, rollback off-path → rollback edge row dim, arc corners not green', () => {
      const onPath = new Set([
        edges[0]!.migrationHash,
        edges[1]!.migrationHash,
        edges[2]!.migrationHash,
      ]);
      const anno = annotations(edges, onPath);
      const rendered = renderEdges(edges, { colorize: true, edgeAnnotationsByHash: anno });

      assertNoRotationCodes(rendered, 'rollbackOnPath trunk on-path');

      // Rollback edge row: its ↓ arrow must be DIM.
      const rollbackLine = rendered.split('\n').find((l) => l.includes('rp_rollback'));
      expect(rollbackLine, 'rollback line exists').toBeDefined();
      if (rollbackLine !== undefined) {
        const code = lastCodeBefore(rollbackLine, '↓');
        expect(code, 'rollback col-1 ↓ must be DIM').toBe(DIM);
      }
    });
  });

  // =========================================================================
  // loop via invariant (self-loop)
  // =========================================================================
  describe('loopViaInvariant', () => {
    const edges = loopViaInvariantEdges();

    it('normal rotation: self-loop rendered, no forced colour', () => {
      const rendered = renderEdges(edges, { colorize: true });
      expect(rendered, 'self-loop dirName present').toContain('lp_noop');
      expect(rendered, 'no forced-green in normal rotation').not.toContain(GREEN_BRIGHT);
    });

    it('path-highlight: self-loop on-path → loop row green, will run present', () => {
      const loopEdge = edges.find((e) => e.dirName === 'lp_noop')!;
      const onPath = new Set([loopEdge.migrationHash]);
      const anno = annotations(edges, onPath);
      const rendered = renderEdges(edges, { colorize: true, edgeAnnotationsByHash: anno });

      assertNoRotationCodes(rendered, 'loopViaInvariant self-loop on-path');

      const loopLine = rendered.split('\n').find((l) => l.includes('lp_noop'));
      expect(loopLine, 'loop line exists').toBeDefined();
      expect(loopLine, 'loop line carries green').toContain(GREEN_BRIGHT);
      expect(loopLine, 'loop has will run').toContain('will run');

      // Off-path trunk edges must carry dim on their own glyphs.
      for (const e of [edges[0]!, edges[1]!]) {
        const line = rendered.split('\n').find((l) => l.includes(e.dirName));
        expect(line, `${e.dirName} must exist`).toBeDefined();
        expect(line, `${e.dirName} carries dim`).toContain(DIM);
      }
    });

    it('path-highlight: trunk on-path, self-loop off-path → loop row dim', () => {
      const loopEdge = edges.find((e) => e.dirName === 'lp_noop')!;
      const onPath = new Set(
        edges.filter((e) => e.migrationHash !== loopEdge.migrationHash).map((e) => e.migrationHash),
      );
      const anno = annotations(edges, onPath);
      const rendered = renderEdges(edges, { colorize: true, edgeAnnotationsByHash: anno });

      assertNoRotationCodes(rendered, 'loopViaInvariant trunk on-path');

      const loopLine = rendered.split('\n').find((l) => l.includes('lp_noop'));
      expect(loopLine, 'loop line exists').toBeDefined();
      expect(loopLine, 'off-path loop line carries dim').toContain(DIM);
    });
  });

  // =========================================================================
  // showcase (complex multi-lane)
  // =========================================================================
  describe('showcase', () => {
    const edges = showcaseEdges();

    it('normal rotation: col-0 neutral, cols ≥ 1 have at least two distinct rotation hues', () => {
      const rendered = renderEdges(edges, { colorize: true });
      expect(rendered, 'no forced-green in normal rotation').not.toContain(GREEN_BRIGHT);

      // There should be at least two distinct rotation hues (multiple branches).
      const presentHues = ALL_ROTATION_CODES.filter((code) => rendered.includes(code));
      expect(presentHues.length, 'at least two rotation hues on showcase').toBeGreaterThanOrEqual(
        2,
      );
    });

    it('path-highlight: init+addName on-path → their edge rows green, branch edge rows dim (no rotation)', () => {
      const initEdge = edges.find((e) => e.dirName === '20260601T0719_init')!;
      const addNameEdge = edges.find((e) => e.dirName === '20260601T0725_add_name')!;
      const onPath = new Set([initEdge.migrationHash, addNameEdge.migrationHash]);
      const anno = annotations(edges, onPath);
      const rendered = renderEdges(edges, { colorize: true, edgeAnnotationsByHash: anno });

      // No rotation codes in path-highlight mode.
      assertNoRotationCodes(rendered, 'showcase path-highlight init+addName trunk');

      // On-path rows must carry green.
      for (const e of [initEdge, addNameEdge]) {
        const line = rendered.split('\n').find((l) => l.includes(e.dirName));
        expect(line, `${e.dirName} must exist`).toBeDefined();
        expect(line, `${e.dirName} carries green`).toContain(GREEN_BRIGHT);
      }

      // Off-path branch edge rows must carry dim on their OWN arrow.
      // Note: these rows may also contain GREEN_BRIGHT on a pass-through cell from
      // an on-path trunk edge — that is CORRECT (FIX D). We check the arrow, not
      // the whole line.
      const offPathEdges = [
        edges.find((e) => e.dirName === '20260601T0725_alice_phone')!,
        edges.find((e) => e.dirName === '20260601T0725_bob_avatar')!,
        edges.find((e) => e.dirName === '20260601T0726_fast_forward')!,
      ];
      for (const e of offPathEdges) {
        const line = rendered.split('\n').find((l) => l.includes(e.dirName));
        expect(line, `${e.dirName} must exist`).toBeDefined();
        expect(line, `${e.dirName} carries dim`).toContain(DIM);
      }
    });

    it('path-highlight: addBio+addLocale on-path → their rows green, others dim (no rotation)', () => {
      const addBioEdge = edges.find((e) => e.dirName === '20260601T0726_add_bio')!;
      const addLocaleEdge = edges.find((e) => e.dirName === '20260601T0726_add_locale')!;
      const onPath = new Set([addBioEdge.migrationHash, addLocaleEdge.migrationHash]);
      const anno = annotations(edges, onPath);
      const rendered = renderEdges(edges, { colorize: true, edgeAnnotationsByHash: anno });

      assertNoRotationCodes(rendered, 'showcase addBio+addLocale on-path');

      for (const e of [addBioEdge, addLocaleEdge]) {
        const line = rendered.split('\n').find((l) => l.includes(e.dirName));
        expect(line, `${e.dirName} exists`).toBeDefined();
        expect(line, `${e.dirName} carries green`).toContain(GREEN_BRIGHT);
        expect(line, `${e.dirName} has will run`).toContain('will run');
      }

      // Sample off-path edge rows must carry dim.
      const offPathSampleNames = [
        '20260601T0719_init',
        '20260601T0725_add_name',
        '20260601T0725_alice_phone',
        '20260601T0727_hotfix',
        '20260601T0728_promote_bob',
      ];
      for (const name of offPathSampleNames) {
        const line = rendered.split('\n').find((l) => l.includes(name));
        expect(line, `${name} exists`).toBeDefined();
        expect(line, `${name} carries dim`).toContain(DIM);
      }
    });
  });

  // =========================================================================
  // Cross-cutting: no rotation codes in ANY path-highlight render
  // =========================================================================
  describe('no rotation codes in any path-highlight render', () => {
    const fixtures: Array<{ name: string; edges: readonly MigrationEdge[] }> = [
      { name: 'straightLine', edges: straightLineEdges() },
      { name: 'twoBranches', edges: twoBranchesEdges() },
      { name: 'diamond', edges: diamondEdges() },
      { name: 'rollbackOnPath', edges: rollbackOnPathEdges() },
      { name: 'loopViaInvariant', edges: loopViaInvariantEdges() },
      { name: 'showcase', edges: showcaseEdges() },
    ];

    // NOTE: branchPlusRollback is excluded from this cross-cutting suite because it
    // has a known rotation-code bug in the arc landing at ∅ (`∅ ╯` uses magenta even
    // in path-highlight mode). That specific bug is asserted in the branchPlusRollback
    // describe block's dedicated 'arc body' test. Including it here would make the
    // cross-cutting suite ambiguous — the failure message would point to the wrong thing.

    for (const { name, edges: fixtureEdges } of fixtures) {
      it(`${name}: no rotation codes when all edges on-path`, () => {
        const onPath = new Set(fixtureEdges.map((e) => e.migrationHash));
        const anno = annotations(fixtureEdges, onPath);
        const rendered = renderEdges(fixtureEdges, {
          colorize: true,
          edgeAnnotationsByHash: anno,
        });
        assertNoRotationCodes(rendered, `${name} all-on-path`);
      });

      it(`${name}: no rotation codes when all edges off-path`, () => {
        const anno = annotations(fixtureEdges, new Set());
        const rendered = renderEdges(fixtureEdges, {
          colorize: true,
          edgeAnnotationsByHash: anno,
        });
        assertNoRotationCodes(rendered, `${name} all-off-path`);
      });
    }
  });

  // =========================================================================
  // ARC LANDING AT ∅: rotation-code bug in branchPlusRollback
  // =========================================================================
  describe('branchPlusRollback arc landing at ∅', () => {
    // The `∅ ╯` row at the bottom of a node-skipping rollback to ∅ renders the ╯
    // corner with the normal laneColorForColumn rotation even in path-highlight mode.
    // This is because ∅ (EMPTY_CONTRACT_HASH) is excluded from contractHighlights, so
    // the renderer has no per-column override for the arc landing column. The corner
    // falls through to the ambient `laneStylerForColumn` → rotation code.
    //
    // Both all-on-path and all-off-path cases fail this invariant.

    const edges = branchPlusRollbackEdges();

    it('all edges on-path: ∅ landing row must not carry a rotation code (CURRENTLY FAILS)', () => {
      const onPath = new Set(edges.map((e) => e.migrationHash));
      const anno = annotations(edges, onPath);
      const rendered = renderEdges(edges, { colorize: true, edgeAnnotationsByHash: anno });

      // The ∅ landing row contains the arc corner. It should have no rotation code.
      const emptyLandingRow = rendered.split('\n').find((l) => {
        const plain = stripAnsi(l);
        return plain.startsWith('∅') && (plain.includes('╯') || plain.includes('/'));
      });
      expect(emptyLandingRow, '∅ landing row with arc corner must exist').toBeDefined();

      if (emptyLandingRow !== undefined) {
        const codeForCorner = lastCodeBefore(emptyLandingRow, '╯');
        expect(
          ALL_ROTATION_CODES.includes(codeForCorner),
          `∅ landing ╯ must NOT carry a rotation code. Got: ${JSON.stringify(codeForCorner)}. ` +
            `Line: ${JSON.stringify(emptyLandingRow)}`,
        ).toBe(false);
      }
    });

    it('all edges off-path: ∅ landing row must not carry a rotation code (CURRENTLY FAILS)', () => {
      const anno = annotations(edges, new Set());
      const rendered = renderEdges(edges, { colorize: true, edgeAnnotationsByHash: anno });

      const emptyLandingRow = rendered.split('\n').find((l) => {
        const plain = stripAnsi(l);
        return plain.startsWith('∅') && (plain.includes('╯') || plain.includes('/'));
      });
      expect(emptyLandingRow, '∅ landing row with arc corner must exist').toBeDefined();

      if (emptyLandingRow !== undefined) {
        const codeForCorner = lastCodeBefore(emptyLandingRow, '╯');
        expect(
          ALL_ROTATION_CODES.includes(codeForCorner),
          `∅ landing ╯ must NOT carry a rotation code. Got: ${JSON.stringify(codeForCorner)}. ` +
            `Line: ${JSON.stringify(emptyLandingRow)}`,
        ).toBe(false);
      }
    });
  });
});

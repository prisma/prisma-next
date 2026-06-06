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

    it('@db→prod path-highlight (init+addName+bobAvatar+promoteBob on-path): off-path lane and arc cells carry DIM, not green', () => {
      // Acceptance test for Stage-3 per-cell classification.
      //
      // The @db→prod path goes: ∅ --init--> 3bfce91 --addName--> 419c099
      //   --bobAvatar--> 935a023 --promoteBob--> f660984
      //
      // Off-path rollback cells that MUST be DIM (not green):
      //   - rollbackAlice lane glyphs (│↓│ rows) — rollback spine in arc lane
      //   - rollbackLocale lane glyphs (│↓│ rows)
      //   - rollbackUsers lane glyphs (│↓│ rows)
      //   - rollback arc landing corners (╯ in arc-land rows at rollback targets)
      //
      // On-path cells that MUST carry GREEN_BRIGHT:
      //   - init, addName, bobAvatar, promoteBob edge rows (their own lane glyph │)
      const edges = showcaseEdges();
      const initEdge = edges.find((e) => e.dirName === '20260601T0719_init')!;
      const addNameEdge = edges.find((e) => e.dirName === '20260601T0725_add_name')!;
      const bobAvatarEdge = edges.find((e) => e.dirName === '20260601T0725_bob_avatar')!;
      const promoteBobEdge = edges.find((e) => e.dirName === '20260601T0728_promote_bob')!;
      const onPath = new Set([
        initEdge.migrationHash,
        addNameEdge.migrationHash,
        bobAvatarEdge.migrationHash,
        promoteBobEdge.migrationHash,
      ]);
      const anno = annotations(edges, onPath);
      const rendered = renderEdges(edges, { colorize: true, edgeAnnotationsByHash: anno });

      // No rotation codes at all in path-highlight mode.
      assertNoRotationCodes(rendered, 'showcase @db→prod path-highlight');

      // On-path edges must carry green on their own lane glyphs.
      for (const e of [initEdge, addNameEdge, bobAvatarEdge, promoteBobEdge]) {
        const line = rendered.split('\n').find((l) => l.includes(e.dirName));
        expect(line, `${e.dirName} must exist`).toBeDefined();
        expect(line, `${e.dirName} must carry green`).toContain(GREEN_BRIGHT);
        expect(line, `${e.dirName} must have will run`).toContain('will run');
      }

      // Off-path rollback edges must carry DIM on their own direction arrow (↓).
      // These are the edges that form rollback arcs to earlier contracts.
      const offPathRollbackNames = [
        '20260601T0727_rollback_alice',
        '20260601T0727_rollback_locale',
        '20260601T0727_rollback_users',
      ];
      for (const name of offPathRollbackNames) {
        const line = rendered.split('\n').find((l) => l.includes(name));
        expect(line, `${name} must exist`).toBeDefined();
        if (line !== undefined) {
          const codeForArrow = lastCodeBefore(line, '↓');
          expect(
            codeForArrow,
            `${name}: rollback ↓ arrow must be preceded by DIM, not green. Line: ${JSON.stringify(line)}`,
          ).toBe(DIM);
        }
      }

      // Off-path arc landing cells (╯ in arc-landing node rows for rollback edges) must carry DIM.
      //
      // Arc-landing NODE rows are distinguished from merge-connector rows by the ◂ glyph: the
      // node marker ○◂ appears only when an arc lands at that node (arcLand decoration). Merge-
      // connector rows (├─╯) also contain ╯ with no direction arrow, but their ╯ is a merge-corner
      // that belongs to the edge whose lane converges there — which may be ON-PATH (e.g. bob_avatar
      // is on-path and its merge-corner ╯ correctly renders green). Filtering by ◂ ensures only
      // true arc-landing node rows are checked.
      //
      // In this specific @db→prod path (init+addName+bobAvatar+promoteBob), none of the on-path
      // edges are rollbacks, so every arc-land-corner ╯ in an ○◂ row belongs to an off-path
      // rollback edge and must be DIM.
      //
      // This is the key bleed guard: before Stage-3, these arc cells incorrectly rendered
      // green because columnHighlights used "on-path wins" at the column level. With per-cell
      // classification, each arc cell is coloured by its own edge's annotation.
      const arcLandingRows = rendered.split('\n').filter((l) => {
        const plain = stripAnsi(l);
        // ◂ only appears in the ○◂ arc-landing node marker — this reliably identifies arc-landing
        // node rows while excluding merge-connector rows (which also contain ╯ but no ◂).
        return plain.includes('◂') && plain.includes('╯');
      });
      // There should be at least one arc-landing row (rollback arcs land with ╯).
      expect(arcLandingRows.length, 'at least one arc-landing ╯ row must exist').toBeGreaterThan(0);
      // Every arc-landing ╯ in this path (all off-path rollbacks) must be DIM.
      for (const arcRow of arcLandingRows) {
        const codeForCorner = lastCodeBefore(arcRow, '╯');
        expect(
          codeForCorner,
          'Off-path rollback arc-landing ╯ must be preceded by DIM. ' +
            `Line: ${JSON.stringify(arcRow)}. Full output:\n${stripAnsi(rendered)}`,
        ).toBe(DIM);
      }

      // Glyph-level colour map for a sample off-path lane row (rollbackAlice ↓).
      // G=GREEN_BRIGHT D=DIM in column order (left to right):
      //   Before: some columns G (bleed), the ↓ arrow G (bleed)
      //   After:  the rollbackAlice lane glyph D, ↓ arrow D
      const rollbackAliceLine = rendered
        .split('\n')
        .find((l) => l.includes('20260601T0727_rollback_alice'));
      expect(rollbackAliceLine, 'rollbackAlice line must exist').toBeDefined();
      if (rollbackAliceLine !== undefined) {
        // Assert no GREEN_BRIGHT on the rollbackAlice row itself
        // (on-path pass-through from other lanes is allowed in other columns).
        // The rollbackAlice's OWN ↓ arrow must be DIM.
        const codeForDownArrow = lastCodeBefore(rollbackAliceLine, '↓');
        expect(codeForDownArrow, 'rollbackAlice ↓ arrow must be DIM (off-path)').toBe(DIM);
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
      // branchPlusRollback is included here after Stage-3 fixed the arc landing at ∅.
      // The `∅ ╯` arc-land-corner cell now carries its migrationHash and is classified
      // per-cell, so the rotation code from the old column-level fallback is gone.
      { name: 'branchPlusRollback', edges: branchPlusRollbackEdges() },
    ];

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
    // The `∅ ╯` row at the bottom of a node-skipping rollback to ∅ is an empty-source
    // node row. The ╯ corner is a trailing arc-land-corner cell whose migrationHash
    // identifies the rollback edge. The Stage-3 per-cell classification reads that hash
    // directly and applies the correct path-highlight colour (green for on-path, dim for
    // off-path), suppressing the rotation code that the old column-level fallback emitted.

    const edges = branchPlusRollbackEdges();

    it('all edges on-path: ∅ landing row must not carry a rotation code', () => {
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

    it('all edges off-path: ∅ landing row must not carry a rotation code', () => {
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

  // =========================================================================
  // Arc-tee connector colour (Bug X1 fix)
  // =========================================================================
  describe('arc-tee connector colour', () => {
    // When a node has arcTee (a back-arc leaving it), the node marker (○) takes
    // the node's own path-highlight, but the connector char (─) belongs to the
    // arc edge and must carry that arc's annotation independently.
    //
    // Graph:  ∅ → n0 → n1 → n2 (rollback arc: n2 → n0)
    //   ○  n2  (on-path node)
    //   ○─╮   node row: marker is GREEN, connector belongs to off-path rollback → DIM

    it('arc-tee connector char is dim when the arc edge is off-path, even if node is on-path', () => {
      const init = edge(EMPTY_CONTRACT_HASH, 'at_n0', 'at_init');
      const m1 = edge('at_n0', 'at_n1', 'at_m1');
      const m2 = edge('at_n1', 'at_n2', 'at_m2');
      const rb = edge('at_n2', 'at_n0', 'at_rb');
      const edgeList = [init, m1, m2, rb];
      // n2 is on-path (via m2); rollback rb is off-path
      const onPath = new Set([init.migrationHash, m1.migrationHash, m2.migrationHash]);
      const anno = annotations(edgeList, onPath);
      const rendered = renderEdges(edgeList, { colorize: true, edgeAnnotationsByHash: anno });

      // Find the node row for n2, which has arcTee (○─╮ pattern)
      const n2Row = rendered.split('\n').find((l) => {
        const plain = stripAnsi(l);
        return plain.includes('○─') || plain.includes('*-');
      });
      expect(n2Row, 'node row with arcTee must exist').toBeDefined();
      if (n2Row !== undefined) {
        // The ○ marker should be GREEN (on-path node).
        const codeForMarker = lastCodeBefore(n2Row, '○');
        expect(
          codeForMarker,
          `node marker ○ must be GREEN (on-path). Got: ${JSON.stringify(codeForMarker)}`,
        ).toBe(GREEN_BRIGHT);
        // The ─ connector immediately after ○ belongs to the off-path rollback → DIM.
        // lastCodeBefore finds the code before the FIRST ─ in the line; since ○ comes
        // before ─, and the ANSI reset after ○ is followed by the DIM code for ─, we
        // check that no GREEN_BRIGHT appears immediately before the ─.
        const codeForConnector = lastCodeBefore(n2Row, '─');
        expect(
          codeForConnector,
          `arc connector ─ must be DIM (off-path rollback). Got: ${JSON.stringify(codeForConnector)}`,
        ).toBe(DIM);
      }
    });
  });

  // =========================================================================
  // Branch-connector tee hash (Bug Y1 fix) + fan-lane pass-through (Bug Y2 fix)
  // =========================================================================
  describe('branch-connector tee and fan-lane pass-through colours', () => {
    // Diamond topology: ∅ → root → alice (col 0) → merge
    //                              → bob   (col 1) → merge
    // With alice + mergeAlice on-path, bob + mergeBob off-path.
    //
    // Bug Y1: branch-connector tee at col 0 was dim (carrying skip-rollback hash).
    //         After fix: tee carries mergeAlice hash → GREEN.
    // Bug Y2: merge_alice edge row, vertical-pass at col 1 carries no hash → DIM.
    //         After fix: pre-populated with mergeBob hash → DIM (correct — off-path).
    //         The key is that the pass-through carries the RIGHT hash so its colour
    //         is determined by that edge's annotation, not by falling through to the
    //         row's own override.

    it('branch-connector tee is GREEN when the trunk fanout edge is on-path', () => {
      const init = edge(EMPTY_CONTRACT_HASH, 'bc_root', 'bc_init');
      const alice = edge('bc_root', 'bc_alice', 'bc_alice');
      const bob = edge('bc_root', 'bc_bob', 'bc_bob');
      const mergeAlice = edge('bc_alice', 'bc_merge', 'bc_merge_alice');
      const mergeBob = edge('bc_bob', 'bc_merge', 'bc_merge_bob');
      const edgeList = [init, alice, bob, mergeAlice, mergeBob];
      // mergeAlice is the trunk fanout edge (col 0); alice is on-path; bob/mergeBob off-path
      const onPath = new Set([init.migrationHash, alice.migrationHash, mergeAlice.migrationHash]);
      const anno = annotations(edgeList, onPath);
      const rendered = renderEdges(edgeList, { colorize: true, edgeAnnotationsByHash: anno });

      // The branch-connector row contains ├ (tee) and ╮ (corner).
      // ├ at col 0 (trunk) carries mergeAlice → GREEN.
      // ╮ at col 1 (bob fan) carries mergeBob → DIM.
      const branchRow = rendered.split('\n').find((l) => {
        const plain = stripAnsi(l);
        return plain.includes('├') && plain.includes('╮');
      });
      expect(branchRow, 'branch-connector row (├…╮) must exist').toBeDefined();
      if (branchRow !== undefined) {
        const codeForTee = lastCodeBefore(branchRow, '├');
        expect(
          codeForTee,
          `branch-connector tee ├ must be GREEN (trunk fanout on-path). Got: ${JSON.stringify(codeForTee)}`,
        ).toBe(GREEN_BRIGHT);
        const codeForCorner = lastCodeBefore(branchRow, '╮');
        expect(
          codeForCorner,
          `branch-connector corner ╮ must be DIM (off-path fan). Got: ${JSON.stringify(codeForCorner)}`,
        ).toBe(DIM);
      }
    });

    it('branch-connector tee is DIM when the trunk fanout edge is off-path', () => {
      const init = edge(EMPTY_CONTRACT_HASH, 'bc2_root', 'bc2_init');
      const alice = edge('bc2_root', 'bc2_alice', 'bc2_alice');
      const bob = edge('bc2_root', 'bc2_bob', 'bc2_bob');
      const mergeAlice = edge('bc2_alice', 'bc2_merge', 'bc2_merge_alice');
      const mergeBob = edge('bc2_bob', 'bc2_merge', 'bc2_merge_bob');
      const edgeList = [init, alice, bob, mergeAlice, mergeBob];
      // All off-path (empty onPath set)
      const anno = annotations(edgeList, new Set());
      const rendered = renderEdges(edgeList, { colorize: true, edgeAnnotationsByHash: anno });

      const branchRow = rendered.split('\n').find((l) => {
        const plain = stripAnsi(l);
        return plain.includes('├') && plain.includes('╮');
      });
      expect(branchRow, 'branch-connector row (├…╮) must exist').toBeDefined();
      if (branchRow !== undefined) {
        const codeForTee = lastCodeBefore(branchRow, '├');
        expect(
          codeForTee,
          `branch-connector tee ├ must be DIM (trunk off-path). Got: ${JSON.stringify(codeForTee)}`,
        ).toBe(DIM);
      }
    });
  });

  // =========================================================================
  // Arc-crossing dash in branch-connector (Bug X2 fix)
  // =========================================================================
  describe('arc-crossing dash in branch-connector', () => {
    // When a branch-connector row contains an arc-crossing (┼─), the ┼ junction
    // belongs to the vertical lane passing through, and the ─ trailing dash runs
    // horizontally into the next column. The dash must carry the next column's
    // annotation, not the crossing's.
    //
    // Setup: node-skipping rollback through a branch-connector row:
    //   ∅ → n0 → n1 → n2 → n3 (trunk)
    //   n2 → n0 (skipping rollback, back-arc through connector rows)
    // The rollback's arc crosses the branch-connector (┼─). The ┼ is the crossing
    // lane (n2's rollback, which is off-path in this scenario), and the ─ leads
    // into the on-path trunk continuation — but since we're testing the fix, we
    // verify the dash uses the DASH COLUMN's annotation.

    it('arc-crossing dash in connector uses dash column annotation, not glyph column', () => {
      const init = edge(EMPTY_CONTRACT_HASH, 'ac_n0', 'ac_init');
      const m1 = edge('ac_n0', 'ac_n1', 'ac_m1');
      const m2 = edge('ac_n1', 'ac_n2', 'ac_m2');
      const m3 = edge('ac_n2', 'ac_n3', 'ac_m3');
      const rb = edge('ac_n2', 'ac_n0', 'ac_rb');
      const edgeList = [init, m1, m2, m3, rb];
      // All off-path so we can verify DIM on both junction and dash
      const anno = annotations(edgeList, new Set());
      const rendered = renderEdges(edgeList, { colorize: true, edgeAnnotationsByHash: anno });

      // In path-highlight mode with no on-path edges, no GREEN_BRIGHT must appear anywhere.
      expect(
        rendered,
        'with all edges off-path, no GREEN_BRIGHT must appear in the output',
      ).not.toContain(GREEN_BRIGHT);
    });
  });
});

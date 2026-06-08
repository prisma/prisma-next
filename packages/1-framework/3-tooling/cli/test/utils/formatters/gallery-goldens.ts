/**
 * Hand-authored golden pictures for the lock-the-look scenario set.
 *
 * ============================================================
 * THREE-LEVEL TAXONOMY: scenario : strategy : variant
 * ============================================================
 *
 *   strategy = 'flat'  — no chosen path; colour rotates by lane (lane0 = colour1/white,
 *                        lane1 = colour2/cyan, …); trunk stays on top at
 *                        merges/forks. EXACTLY ONE golden per scenario (no variant).
 *
 *   strategy = 'focus' — one chosen path; colour follows the ROUTE not the
 *                        column; the on-path line owns every cell it passes
 *                        through, drawn green and continuous, occluding whatever
 *                        it crosses; off-path lanes yield beneath it, dim. MANY
 *                        variants, each highlighting a different path.
 *
 * Filter syntax: scenario · scenario:strategy · scenario:strategy:variant
 * Examples: merge-2 · merge-2:flat · merge-2:focus · merge-2:focus:alt
 *
 * ============================================================
 * ERGONOMIC AUTHORING FORMAT: [glyphs, name?, colours] tuples
 * ============================================================
 *
 * Each golden is authored as an array of tuples — one per row:
 *   [glyphs, name, colours]  — node or migration row (carries identity)
 *   [glyphs, colours]        — pure connector row (no identity)
 *
 * glyphs   = structural characters only (│ ╭ ╮ ╰ ╯ ─ ↑ ↓ ⟲ ○ ∅ + spaces)
 * name     = a contract hash or migration name that exists in the scenario input
 * colours  = one code per glyph character (colours.length === glyphs.length)
 *
 * Colour code map:
 *   '.' = neutral (no SGR)
 *   '1' = lane1 (white)     ← flat graphs: lane N = colour N
 *   '2' = lane2 (cyan)
 *   '3' = lane3 (yellow)
 *   '4' = lane4 (blueBright)
 *   'g' = green (on-path)   ← focus graphs only
 *   'd' = dim (off-path)    ← focus graphs only
 *
 * Within-row glyph columns:
 *   col 0 = lane0 rail  (│/╭/╰/╯/○/∅)
 *   col 1 = lane0 conn  (─/↑ etc.)
 *   col 2 = lane1 rail
 *   col 3 = lane1 conn
 *
 * Visual language rules:
 *   - Glyph alphabet: │ ╭ ╮ ╰ ╯ ─ ↑ ↓ ⟲ ○ ∅ — NEVER ├ ┬ ┴ ┼
 *   - 2 columns per lane: rail col (verticals/nodes) + connector col (corners)
 *   - Tips at TOP, roots at BOTTOM (array row 0 = top of display)
 *
 */

import { parseGrid, type Row, type ScenarioInput } from './gallery-cells';

// ---------------------------------------------------------------------------
// Scenario: linear   ∅ → lin_a → lin_b → lin_c
// ---------------------------------------------------------------------------

const linearInput: ScenarioInput = {
  contracts: ['∅', 'lin_a', 'lin_b', 'lin_c'],
  migrations: [
    { name: '000_init', from: '∅', to: 'lin_a' },
    { name: '001_add_users', from: 'lin_a', to: 'lin_b' },
    { name: '002_add_posts', from: 'lin_b', to: 'lin_c' },
  ],
};

// ---------------------------------------------------------------------------
// Scenario: fork-2   ∅ → root → trunk (lane0) / → alt (lane1)
// ---------------------------------------------------------------------------

const fork2Input: ScenarioInput = {
  contracts: ['∅', 'root', 'trunk', 'alt'],
  migrations: [
    { name: '000_init', from: '∅', to: 'root' },
    { name: '001_trunk_feature', from: 'root', to: 'trunk' },
    { name: '002_alt_feature', from: 'root', to: 'alt' },
  ],
};

// ---------------------------------------------------------------------------
// Scenario: merge-2   two independent parents (m2_a, m2_b) converge into m2_merge
//                      (pure merge — no shared root; contrast diamond = fork+merge)
// ---------------------------------------------------------------------------

const merge2Input: ScenarioInput = {
  contracts: ['m2_a', 'm2_b', 'm2_merge'],
  migrations: [
    { name: '000_merge_a', from: 'm2_a', to: 'm2_merge' },
    { name: '001_merge_b', from: 'm2_b', to: 'm2_merge' },
  ],
};

// ---------------------------------------------------------------------------
// Scenario: diamond   ∅ → dm_root → dm_alice (lane0) → dm_merge
//                                 → dm_bob   (lane1) → dm_merge
// ---------------------------------------------------------------------------

const diamondInput: ScenarioInput = {
  contracts: ['∅', 'dm_root', 'dm_alice', 'dm_bob', 'dm_merge'],
  migrations: [
    { name: '000_init', from: '∅', to: 'dm_root' },
    { name: '001_alice', from: 'dm_root', to: 'dm_alice' },
    { name: '002_bob', from: 'dm_root', to: 'dm_bob' },
    { name: '003_merge_alice', from: 'dm_alice', to: 'dm_merge' },
    { name: '004_merge_bob', from: 'dm_bob', to: 'dm_merge' },
  ],
};

// ---------------------------------------------------------------------------
// Golden data model + registry
// ---------------------------------------------------------------------------

/**
 * A golden picture for one identified scenario/strategy/variant.
 *
 * - `strategy = 'flat'`  → `variant` is undefined (one golden per scenario).
 * - `strategy = 'focus'` → `variant` is a string (one golden per highlighted path).
 *
 * Identifier: `scenario:strategy` (flat) or `scenario:strategy:variant` (focus).
 */
export interface ScenarioGolden {
  /** e.g. 'linear', 'merge-2', 'diamond' */
  readonly scenario: string;
  /** 'flat' | 'focus' */
  readonly strategy: 'flat' | 'focus';
  /** undefined for flat goldens; e.g. 'trunk', 'alt', 'full' for focus goldens. */
  readonly variant: string | undefined;
  /** Human-readable description. */
  readonly description: string;
  /** The hand-authored 2D cell array. */
  readonly rows: readonly Row[];
  /** The explicit input graph this golden is anchored to. */
  readonly input: ScenarioInput;
  /** Migration names on the highlighted route; empty for flat strategy. */
  readonly onPath: readonly string[];
  /** focus only: migrate --from (path origin) */
  readonly from?: string;
  /** focus only: migrate --to   (path destination) */
  readonly to?: string;
}

/** Full identifier string: `scenario:strategy` or `scenario:strategy:variant`. */
export function goldenId(g: ScenarioGolden): string {
  return g.variant !== undefined
    ? `${g.scenario}:${g.strategy}:${g.variant}`
    : `${g.scenario}:${g.strategy}`;
}

export const GOLDENS: readonly ScenarioGolden[] = [
  // ── linear ──────────────────────────────────────────────────────────────
  // linear:flat
  {
    scenario: 'linear',
    strategy: 'flat',
    variant: undefined,
    description: 'single-lane chain, normal rotation (column-0 dim)',
    input: linearInput,
    onPath: [],
    rows: parseGrid([
      ['○', 'lin_c', '1'],
      ['│↑', '002_add_posts', '11'],
      ['○', 'lin_b', '1'],
      ['│↑', '001_add_users', '11'],
      ['○', 'lin_a', '1'],
      ['│↑', '000_init', '11'],
      ['○', '∅', '1'],
    ]),
  },
  // linear:focus:full
  {
    scenario: 'linear',
    strategy: 'focus',
    variant: 'full',
    description: 'all edges on-path — entire chain green',
    input: linearInput,
    onPath: ['000_init', '001_add_users', '002_add_posts'],
    from: '∅',
    to: 'lin_c',
    rows: parseGrid([
      ['○', 'lin_c', 'g'],
      ['│↑', '002_add_posts', 'gg'],
      ['○', 'lin_b', 'g'],
      ['│↑', '001_add_users', 'gg'],
      ['○', 'lin_a', 'g'],
      ['│↑', '000_init', 'gg'],
      ['○', '∅', 'g'],
    ]),
  },
  // ── fork-2 ──────────────────────────────────────────────────────────────
  // fork-2:flat
  {
    scenario: 'fork-2',
    strategy: 'flat',
    variant: undefined,
    description: 'fork from root into two branches, normal rotation',
    input: fork2Input,
    onPath: [],
    rows: parseGrid([
      ['○', 'trunk', '1'],
      ['│↑', '001_trunk_feature', '11'],
      ['│ ○', 'alt', '1.2'],
      ['│ │↑', '002_alt_feature', '1.22'],
      ['│─╯ ', '122.'],
      ['○', 'root', '1'],
      ['│↑', '000_init', '11'],
      ['○', '∅', '1'],
    ]),
  },
  // fork-2:focus:trunk
  {
    scenario: 'fork-2',
    strategy: 'focus',
    variant: 'trunk',
    description: 'highlight trunk branch — fork connector ╰─╯ trunk-side green',
    input: fork2Input,
    onPath: ['000_init', '001_trunk_feature'],
    from: '∅',
    to: 'trunk',
    rows: parseGrid([
      ['○', 'trunk', 'g'],
      ['│↑', '001_trunk_feature', 'gg'],
      ['│ ○', 'alt', 'g.d'],
      ['│ │↑', '002_alt_feature', 'g.dd'],
      ['│─╯ ', 'gdd.'],
      ['○', 'root', 'g'],
      ['│↑', '000_init', 'gg'],
      ['○', '∅', 'g'],
    ]),
  },
  // fork-2:focus:alt
  {
    scenario: 'fork-2',
    strategy: 'focus',
    variant: 'alt',
    description: 'highlight alt branch — fork connector ╭─╯ (entire alt sweep green)',
    input: fork2Input,
    onPath: ['000_init', '002_alt_feature'],
    from: '∅',
    to: 'alt',
    rows: parseGrid([
      ['○', 'trunk', 'd'],
      ['│↑', '001_trunk_feature', 'dd'],
      ['│ ○', 'alt', 'd.g'],
      ['│ │↑', '002_alt_feature', 'd.gg'],
      ['╭─╯ ', 'ggg.'],
      ['○', 'root', 'g'],
      ['│↑', '000_init', 'gg'],
      ['○', '∅', 'g'],
    ]),
  },
  // ── merge-2 ─────────────────────────────────────────────────────────────
  // merge-2:flat
  {
    scenario: 'merge-2',
    strategy: 'flat',
    variant: undefined,
    description: 'two independent parents converging into one child (pure merge), normal rotation',
    input: merge2Input,
    onPath: [],
    rows: parseGrid([
      ['○', 'm2_merge', '1'],
      ['│─╮ ', '122.'],
      ['│↑│', '000_merge_a', '112'],
      ['│ │↑', '001_merge_b', '1.22'],
      ['○ │', 'm2_a', '1.2'],
      ['  ○', 'm2_b', '..2'],
    ]),
  },
  // merge-2:focus:trunk
  {
    scenario: 'merge-2',
    strategy: 'focus',
    variant: 'trunk',
    description: 'highlight parent m2_a (col0) path — route green into the merge',
    input: merge2Input,
    onPath: ['000_merge_a'],
    from: 'm2_a',
    to: 'm2_merge',
    rows: parseGrid([
      ['○', 'm2_merge', 'g'],
      ['│─╮ ', 'gdd.'],
      ['│↑│', '000_merge_a', 'ggd'],
      ['│ │↑', '001_merge_b', 'g.dd'],
      ['○ │', 'm2_a', 'g.d'],
      ['  ○', 'm2_b', '..d'],
    ]),
  },
  // merge-2:focus:alt
  {
    scenario: 'merge-2',
    strategy: 'focus',
    variant: 'alt',
    description: 'highlight parent m2_b (col1) path — route sweeps green into the merge',
    input: merge2Input,
    onPath: ['001_merge_b'],
    from: 'm2_b',
    to: 'm2_merge',
    rows: parseGrid([
      ['○', 'm2_merge', 'g'],
      ['╰─╮ ', 'ggg.'],
      ['│↑│', '000_merge_a', 'ddg'],
      ['│ │↑', '001_merge_b', 'd.gg'],
      ['○ │', 'm2_a', 'd.g'],
      ['  ○', 'm2_b', '..g'],
    ]),
  },
  // ── diamond ─────────────────────────────────────────────────────────────
  // diamond:flat
  {
    scenario: 'diamond',
    strategy: 'flat',
    variant: undefined,
    description: 'fork+merge diamond, normal rotation',
    input: diamondInput,
    onPath: [],
    rows: parseGrid([
      ['○', 'dm_merge', '1'],
      ['│─╮ ', '122.'],
      ['│↑│', '003_merge_alice', '112'],
      ['│ │↑', '004_merge_bob', '1.22'],
      ['○ │', 'dm_alice', '1.2'],
      ['│↑│', '001_alice', '112'],
      ['│ ○', 'dm_bob', '1.2'],
      ['│ │↑', '002_bob', '1.22'],
      ['│─╯ ', '122.'],
      ['○', 'dm_root', '1'],
      ['│↑', '000_init', '11'],
      ['○', '∅', '1'],
    ]),
  },
  // diamond:focus:trunk
  {
    scenario: 'diamond',
    strategy: 'focus',
    variant: 'trunk',
    description: 'highlight alice (col0) path — both connectors trunk-side green',
    input: diamondInput,
    onPath: ['000_init', '001_alice', '003_merge_alice'],
    from: '∅',
    to: 'dm_merge',
    rows: parseGrid([
      ['○', 'dm_merge', 'g'],
      ['│─╮ ', 'gdd.'],
      ['│↑│', '003_merge_alice', 'ggd'],
      ['│ │↑', '004_merge_bob', 'g.dd'],
      ['○ │', 'dm_alice', 'g.d'],
      ['│↑│', '001_alice', 'ggd'],
      ['│ ○', 'dm_bob', 'g.d'],
      ['│ │↑', '002_bob', 'g.dd'],
      ['│─╯ ', 'gdd.'],
      ['○', 'dm_root', 'g'],
      ['│↑', '000_init', 'gg'],
      ['○', '∅', 'g'],
    ]),
  },
  // diamond:focus:alt
  {
    scenario: 'diamond',
    strategy: 'focus',
    variant: 'alt',
    description: 'highlight bob (col1) path — merge ╰─╯ + fork ╭─╯ (entire alt sweep green)',
    input: diamondInput,
    onPath: ['000_init', '002_bob', '004_merge_bob'],
    from: '∅',
    to: 'dm_merge',
    rows: parseGrid([
      ['○', 'dm_merge', 'g'],
      ['╰─╮ ', 'ggg.'],
      ['│↑│', '003_merge_alice', 'ddg'],
      ['│ │↑', '004_merge_bob', 'd.gg'],
      ['○ │', 'dm_alice', 'd.g'],
      ['│↑│', '001_alice', 'ddg'],
      ['│ ○', 'dm_bob', 'd.g'],
      ['│ │↑', '002_bob', 'd.gg'],
      ['╭─╯ ', 'ggg.'],
      ['○', 'dm_root', 'g'],
      ['│↑', '000_init', 'gg'],
      ['○', '∅', 'g'],
    ]),
  },
];

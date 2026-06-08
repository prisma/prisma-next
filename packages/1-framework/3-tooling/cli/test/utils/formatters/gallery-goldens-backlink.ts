/**
 * Hand-authored golden pictures — backlink scenarios + forward stragglers.
 *
 * ============================================================
 * SCENARIO COVERAGE
 * ============================================================
 *
 * Backlink scenarios (node-skipping and adjacent rollback edges):
 *   rollback-adjacent — 2-node cycle; rollback is plain ↓ (adjacent, no arc)
 *   rollback-arc      — rollback skips a node; drawn as explicit routed arc
 *   rollback-merge    — two rollback arcs landing on the same target (separate back-lanes)
 *   rollback-cross    — two back-arcs whose lane spans overlap (each arc on a back-lane;
 *                       one arc crosses the other's lane body)
 *   self-loop         — self-edge ⟲ immediately above its node
 *
 * Forward stragglers (completing the catalogue):
 *   fan-3             — 3-way convergence (three parents → one merge node)
 *   wide-fan          — pure divergence, N tips, no reconvergence
 *
 *
 * Colour codes (parseGrid):
 *   '.' = neutral (no SGR, labels and spaces)
 *   'd' = dim (off-path gutter, col-0 neutral in flat)
 *   'g' = green (on-path)
 *   '1' = lane1 (white)
 *   '2' = lane2 (cyan)
 *   'b' = back-arc lane colour (dim)
 */

import { parseGrid, type ScenarioInput } from './gallery-cells';
import type { ScenarioGolden } from './gallery-goldens';

// ---------------------------------------------------------------------------
// Scenario: rollback-adjacent   ∅ → rb_a → rb_b → rb_a (adjacent rollback)
// ---------------------------------------------------------------------------

const rollbackAdjacentInput: ScenarioInput = {
  contracts: ['∅', 'rb_a', 'rb_b'],
  migrations: [
    { name: '000_init', from: '∅', to: 'rb_a' },
    { name: '001_forward', from: 'rb_a', to: 'rb_b' },
    { name: '002_rollback', from: 'rb_b', to: 'rb_a' },
  ],
};

// ---------------------------------------------------------------------------
// Scenario: rollback-arc   ∅ → arc_a → arc_b → arc_c → arc_a (node-skipping arc)
// ---------------------------------------------------------------------------

const rollbackArcInput: ScenarioInput = {
  contracts: ['∅', 'arc_a', 'arc_b', 'arc_c'],
  migrations: [
    { name: '000_init', from: '∅', to: 'arc_a' },
    { name: '001_fwd_ab', from: 'arc_a', to: 'arc_b' },
    { name: '002_fwd_bc', from: 'arc_b', to: 'arc_c' },
    { name: '003_rollback', from: 'arc_c', to: 'arc_a' },
  ],
};

// ---------------------------------------------------------------------------
// Scenario: rollback-merge   two rollback arcs both landing on rm_a
// ---------------------------------------------------------------------------

const rollbackMergeInput: ScenarioInput = {
  contracts: ['∅', 'rm_a', 'rm_b', 'rm_c', 'rm_d'],
  migrations: [
    { name: '000_init', from: '∅', to: 'rm_a' },
    { name: '001_fwd_ab', from: 'rm_a', to: 'rm_b' },
    { name: '002_fwd_bc', from: 'rm_b', to: 'rm_c' },
    { name: '003_fwd_cd', from: 'rm_c', to: 'rm_d' },
    { name: '004_rollback_c', from: 'rm_c', to: 'rm_a' },
    { name: '005_rollback_d', from: 'rm_d', to: 'rm_a' },
  ],
};

// ---------------------------------------------------------------------------
// Scenario: rollback-cross   two back-arcs with overlapping spans
// ---------------------------------------------------------------------------

const rollbackCrossInput: ScenarioInput = {
  contracts: ['∅', 'rx_a', 'rx_b', 'rx_c', 'rx_d', 'rx_e'],
  migrations: [
    { name: '000_init', from: '∅', to: 'rx_a' },
    { name: '001_fwd_ab', from: 'rx_a', to: 'rx_b' },
    { name: '002_fwd_bc', from: 'rx_b', to: 'rx_c' },
    { name: '003_fwd_cd', from: 'rx_c', to: 'rx_d' },
    { name: '004_fwd_de', from: 'rx_d', to: 'rx_e' },
    { name: '005_rollback_1', from: 'rx_c', to: 'rx_a' },
    { name: '006_rollback_2', from: 'rx_d', to: 'rx_b' },
  ],
};

// ---------------------------------------------------------------------------
// Scenario: self-loop   ∅ → sl_a → sl_b ⟲ → sl_c
// ---------------------------------------------------------------------------

const selfLoopInput: ScenarioInput = {
  contracts: ['∅', 'sl_a', 'sl_b', 'sl_c'],
  migrations: [
    { name: '000_init', from: '∅', to: 'sl_a' },
    { name: '001_fwd_ab', from: 'sl_a', to: 'sl_b' },
    { name: '002_noop', from: 'sl_b', to: 'sl_b' },
    { name: '003_fwd_bc', from: 'sl_b', to: 'sl_c' },
  ],
};

// ---------------------------------------------------------------------------
// Scenario: fan-3   ∅ → fan_a/fan_b/fan_c → fan_merge (3-way convergence)
// ---------------------------------------------------------------------------

const fan3Input: ScenarioInput = {
  contracts: ['∅', 'fan_a', 'fan_b', 'fan_c', 'fan_merge'],
  migrations: [
    { name: '000_fan_a_init', from: '∅', to: 'fan_a' },
    { name: '001_fan_b_init', from: '∅', to: 'fan_b' },
    { name: '002_fan_c_init', from: '∅', to: 'fan_c' },
    { name: '003_merge_a', from: 'fan_a', to: 'fan_merge' },
    { name: '004_merge_b', from: 'fan_b', to: 'fan_merge' },
    { name: '005_merge_c', from: 'fan_c', to: 'fan_merge' },
  ],
};

// ---------------------------------------------------------------------------
// Scenario: wide-fan   ∅ → wf_root → wf_a/wf_b/wf_c (pure divergence)
// ---------------------------------------------------------------------------

const wideFanInput: ScenarioInput = {
  contracts: ['∅', 'wf_root', 'wf_a', 'wf_b', 'wf_c'],
  migrations: [
    { name: '000_init', from: '∅', to: 'wf_root' },
    { name: '001_wf_a_ft', from: 'wf_root', to: 'wf_a' },
    { name: '002_wf_b_ft', from: 'wf_root', to: 'wf_b' },
    { name: '003_wf_c_ft', from: 'wf_root', to: 'wf_c' },
  ],
};

// ===========================================================================
// Golden data model — same ScenarioGolden interface as gallery-goldens.ts
// ===========================================================================

export const BACKLINK_GOLDENS: readonly ScenarioGolden[] = [
  // ── rollback-adjacent ────────────────────────────────────────────────────
  // rollback-adjacent:flat
  {
    scenario: 'rollback-adjacent',
    strategy: 'flat',
    variant: undefined,
    description: '2-node cycle; rollback is adjacent → plain ↓, no arc',
    input: rollbackAdjacentInput,
    onPath: [],
    rows: parseGrid([
      ['○', 'rb_b', '1'],
      ['│↑', '001_forward', '11'],
      ['│↓', '002_rollback', '11'],
      ['○', 'rb_a', '1'],
      ['│↑', '000_init', '11'],
      ['○', '∅', '1'],
    ]),
  },
  // rollback-adjacent:focus:forward
  {
    scenario: 'rollback-adjacent',
    strategy: 'focus',
    variant: 'forward',
    description: 'highlight forward edge — rollback dim',
    input: rollbackAdjacentInput,
    onPath: ['000_init', '001_forward'],
    from: '∅',
    to: 'rb_b',
    rows: parseGrid([
      ['○', 'rb_b', 'g'],
      ['│↑', '001_forward', 'gg'],
      ['│↓', '002_rollback', 'gd'],
      ['○', 'rb_a', 'g'],
      ['│↑', '000_init', 'gg'],
      ['○', '∅', 'g'],
    ]),
  },
  // rollback-adjacent:focus:through-rollback
  {
    scenario: 'rollback-adjacent',
    strategy: 'focus',
    variant: 'through-rollback',
    description: 'highlight rollback edge — ↓ green, forward dim',
    input: rollbackAdjacentInput,
    onPath: ['002_rollback'],
    from: 'rb_b',
    to: 'rb_a',
    rows: parseGrid([
      ['○', 'rb_b', 'g'],
      ['│↑', '001_forward', 'gd'],
      ['│↓', '002_rollback', 'gg'],
      ['○', 'rb_a', 'g'],
      ['│↑', '000_init', 'dd'],
      ['○', '∅', 'd'],
    ]),
  },
  // ── rollback-arc ─────────────────────────────────────────────────────────
  // rollback-arc:flat
  {
    scenario: 'rollback-arc',
    strategy: 'flat',
    variant: undefined,
    description: 'node-skipping rollback drawn as explicit routed arc (○─╮ … ◂╯)',
    input: rollbackArcInput,
    onPath: [],
    rows: parseGrid([
      ['○─╮', 'arc_c', '122'],
      ['│ │↓', '003_rollback', '1122'],
      ['│↑│', '002_fwd_bc', '112'],
      ['○ │', 'arc_b', '112'],
      ['│↑│', '001_fwd_ab', '112'],
      ['○◂╯', 'arc_a', '122'],
      ['│↑', '000_init', '11'],
      ['○', '∅', '1'],
    ]),
  },
  // rollback-arc:focus:trunk
  {
    scenario: 'rollback-arc',
    strategy: 'focus',
    variant: 'trunk',
    description: 'highlight forward path — arc body dim',
    input: rollbackArcInput,
    onPath: ['000_init', '001_fwd_ab', '002_fwd_bc'],
    from: '∅',
    to: 'arc_c',
    rows: parseGrid([
      ['○─╮', 'arc_c', 'gdd'],
      ['│ │↓', '003_rollback', 'g.dd'],
      ['│↑│', '002_fwd_bc', 'ggd'],
      ['○ │', 'arc_b', 'g.d'],
      ['│↑│', '001_fwd_ab', 'ggd'],
      ['○◂╯', 'arc_a', 'gdd'],
      ['│↑', '000_init', 'gg'],
      ['○', '∅', 'g'],
    ]),
  },
  // rollback-arc:focus:through-arc
  {
    scenario: 'rollback-arc',
    strategy: 'focus',
    variant: 'through-arc',
    description:
      'route traverses the back-arc — arc body green + continuous; forward clips at crossing',
    input: rollbackArcInput,
    onPath: ['003_rollback'],
    from: 'arc_c',
    to: 'arc_a',
    rows: parseGrid([
      ['○─╮', 'arc_c', 'ggg'],
      ['│ │↓', '003_rollback', 'd.gg'],
      ['│↑│', '002_fwd_bc', 'ddg'],
      ['○ │', 'arc_b', 'd.g'],
      ['│↑│', '001_fwd_ab', 'ddg'],
      ['○◂╯', 'arc_a', 'ggg'],
      ['│↑', '000_init', 'dd'],
      ['○', '∅', 'd'],
    ]),
  },
  // ── rollback-merge ───────────────────────────────────────────────────────
  // rollback-merge:flat
  {
    scenario: 'rollback-merge',
    strategy: 'flat',
    variant: undefined,
    description: 'two rollback arcs landing on same target (two separate back-lanes)',
    input: rollbackMergeInput,
    onPath: [],
    rows: parseGrid([
      ['○───╮', 'rm_d', '13333'],
      ['│   │↓', '005_rollback_d', '1...33'],
      ['│↑  │', '003_fwd_cd', '11..3'],
      ['○─╮ │', 'rm_c', '122.3'],
      ['│ │↓│', '004_rollback_c', '11223'],
      ['│↑│ │', '002_fwd_bc', '112.3'],
      ['○ │ │', 'rm_b', '1.2.3'],
      ['│↑│ │', '001_fwd_ab', '112.3'],
      ['○◂╯─╯', 'rm_a', '12233'],
      ['│↑', '000_init', '11'],
      ['○', '∅', '1'],
    ]),
  },
  // rollback-merge:focus:via-A  (arc_D = 005_rollback_d is on-path)
  {
    scenario: 'rollback-merge',
    strategy: 'focus',
    variant: 'via-A',
    description: 'highlight arc_D (longer arc) — green; arc_C dim',
    input: rollbackMergeInput,
    onPath: ['005_rollback_d'],
    from: 'rm_d',
    to: 'rm_a',
    rows: parseGrid([
      ['○───╮', 'rm_d', 'ggggg'],
      ['│   │↓', '005_rollback_d', 'd...gg'],
      ['│↑  │', '003_fwd_cd', 'dd..g'],
      ['○─╮ │', 'rm_c', 'ddd.g'],
      ['│ │↓│', '004_rollback_c', 'd.ddg'],
      ['│↑│ │', '002_fwd_bc', 'ddd.g'],
      ['○ │ │', 'rm_b', 'd.d.g'],
      ['│↑│ │', '001_fwd_ab', 'ddd.g'],
      ['○◂──╯', 'rm_a', 'ggggg'],
      ['│↑', '000_init', 'dd'],
      ['○', '∅', 'd'],
    ]),
  },
  // rollback-merge:focus:via-B  (arc_C = 004_rollback_c is on-path)
  // rm_c is the source of the on-path rollback, so its node is on-path (green) —
  // mirroring how via-A renders rm_d (the source of its on-path rollback) green.
  {
    scenario: 'rollback-merge',
    strategy: 'focus',
    variant: 'via-B',
    description: 'highlight arc_C (shorter arc) — green; arc_D dim',
    input: rollbackMergeInput,
    onPath: ['004_rollback_c'],
    from: 'rm_c',
    to: 'rm_a',
    rows: parseGrid([
      ['○───╮', 'rm_d', 'ddddd'],
      ['│   │↓', '005_rollback_d', 'd...dd'],
      ['│↑  │', '003_fwd_cd', 'dd..d'],
      ['○─╮ │', 'rm_c', 'ggg.d'],
      ['│ │↓│', '004_rollback_c', 'd.ggd'],
      ['│↑│ │', '002_fwd_bc', 'ddg.d'],
      ['○ │ │', 'rm_b', 'd.g.d'],
      ['│↑│ │', '001_fwd_ab', 'ddg.d'],
      ['○◂╯─╯', 'rm_a', 'gggdd'],
      ['│↑', '000_init', 'dd'],
      ['○', '∅', 'd'],
    ]),
  },
  // ── rollback-cross ───────────────────────────────────────────────────────
  // rollback-cross:flat
  {
    scenario: 'rollback-cross',
    strategy: 'flat',
    variant: undefined,
    description: 'two back-arcs with overlapping spans; arc_1 bridge occludes arc_2 body at rx_c',
    input: rollbackCrossInput,
    onPath: [],
    rows: parseGrid([
      ['○', 'rx_e', '1'],
      ['│↑', '004_fwd_de', '11'],
      ['○─╮', 'rx_d', '133'],
      ['│ │↓', '006_rollback_2', '1.33'],
      ['│↑│', '003_fwd_cd', '113'],
      ['○───╮', 'rx_c', '12222'],
      ['│ │ │↓', '005_rollback_1', '1.3.22'],
      ['│↑│ │', '002_fwd_bc', '113.2'],
      ['○◂╯ │', 'rx_b', '133.2'],
      ['│↑  │', '001_fwd_ab', '11..2'],
      ['○◂──╯', 'rx_a', '12222'],
      ['│↑', '000_init', '11'],
      ['○', '∅', '1'],
    ]),
  },
  // rollback-cross:focus:arc-1  (005_rollback_1: rx_c → rx_a is on-path)
  {
    scenario: 'rollback-cross',
    strategy: 'focus',
    variant: 'arc-1',
    description: 'arc_1 on-path: green + continuous through crossing; arc_2 clipped at crossing',
    input: rollbackCrossInput,
    onPath: ['005_rollback_1'],
    from: 'rx_c',
    to: 'rx_a',
    rows: parseGrid([
      ['○', 'rx_e', 'd'],
      ['│↑', '004_fwd_de', 'dd'],
      ['○─╮', 'rx_d', 'ddd'],
      ['│ │↓', '006_rollback_2', 'd.dd'],
      ['│↑│', '003_fwd_cd', 'ddd'],
      ['○───╮', 'rx_c', 'ggggg'],
      ['│ │ │↓', '005_rollback_1', 'd.d.gg'],
      ['│↑│ │', '002_fwd_bc', 'ddd.g'],
      ['○◂╯ │', 'rx_b', 'ddd.g'],
      ['│↑  │', '001_fwd_ab', 'dd..g'],
      ['○◂──╯', 'rx_a', 'ggggg'],
      ['│↑', '000_init', 'dd'],
      ['○', '∅', 'd'],
    ]),
  },
  // rollback-cross:focus:arc-2  (006_rollback_2: rx_d → rx_b is on-path)
  {
    scenario: 'rollback-cross',
    strategy: 'focus',
    variant: 'arc-2',
    description: 'arc_2 on-path: green + continuous through crossing; arc_1 bridge clipped there',
    input: rollbackCrossInput,
    onPath: ['006_rollback_2'],
    from: 'rx_d',
    to: 'rx_b',
    rows: parseGrid([
      ['○', 'rx_e', 'd'],
      ['│↑', '004_fwd_de', 'dd'],
      ['○─╮', 'rx_d', 'ggg'],
      ['│ │↓', '006_rollback_2', 'd.gg'],
      ['│↑│', '003_fwd_cd', 'ddg'],
      ['○─│─╮', 'rx_c', 'ddgdd'],
      ['│ │ │↓', '005_rollback_1', 'd.g.dd'],
      ['│↑│ │', '002_fwd_bc', 'ddg.d'],
      ['○◂╯ │', 'rx_b', 'ggg.d'],
      ['│↑  │', '001_fwd_ab', 'dd..d'],
      ['○◂──╯', 'rx_a', 'ddddd'],
      ['│↑', '000_init', 'dd'],
      ['○', '∅', 'd'],
    ]),
  },
  // ── self-loop ────────────────────────────────────────────────────────────
  // self-loop:flat
  {
    scenario: 'self-loop',
    strategy: 'flat',
    variant: undefined,
    description: 'self-edge ⟲ immediately above its node, single lane',
    input: selfLoopInput,
    onPath: [],
    rows: parseGrid([
      ['○', 'sl_c', '1'],
      ['│↑', '003_fwd_bc', '11'],
      ['│⟲', '002_noop', '11'],
      ['○', 'sl_b', '1'],
      ['│↑', '001_fwd_ab', '11'],
      ['○', 'sl_a', '1'],
      ['│↑', '000_init', '11'],
      ['○', '∅', '1'],
    ]),
  },
  // self-loop:focus:through-loop
  {
    scenario: 'self-loop',
    strategy: 'focus',
    variant: 'through-loop',
    description: 'route traverses the self-loop — ⟲ green; sl_b node green; all others dim',
    input: selfLoopInput,
    onPath: ['002_noop'],
    from: 'sl_b',
    to: 'sl_b',
    rows: parseGrid([
      ['○', 'sl_c', 'd'],
      ['│↑', '003_fwd_bc', 'dd'],
      ['│⟲', '002_noop', 'gg'],
      ['○', 'sl_b', 'g'],
      ['│↑', '001_fwd_ab', 'dd'],
      ['○', 'sl_a', 'd'],
      ['│↑', '000_init', 'dd'],
      ['○', '∅', 'd'],
    ]),
  },
  // ── fan-3 ────────────────────────────────────────────────────────────────
  // fan-3:flat
  {
    scenario: 'fan-3',
    strategy: 'flat',
    variant: undefined,
    description: '3-way convergence, normal rotation (lane0=white, lane1=cyan, lane2=yellow)',
    input: fan3Input,
    onPath: [],
    rows: parseGrid([
      ['○', 'fan_merge', '1'],
      ['│─╮─╮ ', '12233.'],
      ['│↑│ │', '003_merge_a', '112.3'],
      ['│ │↑│', '004_merge_b', '1.223'],
      ['│ │ │↑', '005_merge_c', '1.2.33'],
      ['○ │ │', 'fan_a', '1.2.3'],
      ['│↑│ │', '000_fan_a_init', '112.3'],
      ['│ ○ │', 'fan_b', '1.2.3'],
      ['│ │↑│', '001_fan_b_init', '1.223'],
      ['│ │ ○', 'fan_c', '1.2.3'],
      ['│ │ │↑', '002_fan_c_init', '1.2.33'],
      ['│─╯─╯ ', '12233.'],
      ['○', '∅', '1'],
    ]),
  },
  // fan-3:focus:trunk
  {
    scenario: 'fan-3',
    strategy: 'focus',
    variant: 'trunk',
    description: 'highlight trunk (col0) path — merge connector trunk-side green',
    input: fan3Input,
    onPath: ['000_fan_a_init', '003_merge_a'],
    from: '∅',
    to: 'fan_merge',
    rows: parseGrid([
      ['○', 'fan_merge', 'g'],
      ['│─╮─╮ ', 'gdddd.'],
      ['│↑│ │', '003_merge_a', 'ggd.d'],
      ['│ │↑│', '004_merge_b', 'g.ddd'],
      ['│ │ │↑', '005_merge_c', 'g.d.dd'],
      ['○ │ │', 'fan_a', 'g.d.d'],
      ['│↑│ │', '000_fan_a_init', 'ggd.d'],
      ['│ ○ │', 'fan_b', 'g.d.d'],
      ['│ │↑│', '001_fan_b_init', 'g.ddd'],
      ['│ │ ○', 'fan_c', 'g.d.d'],
      ['│ │ │↑', '002_fan_c_init', 'g.d.dd'],
      ['│─╯─╯ ', 'gdddd.'],
      ['○', '∅', 'g'],
    ]),
  },
  // fan-3:focus:altA
  {
    scenario: 'fan-3',
    strategy: 'focus',
    variant: 'altA',
    description: 'highlight altA (col1) path — merge connector altA sweep green',
    input: fan3Input,
    onPath: ['001_fan_b_init', '004_merge_b'],
    from: '∅',
    to: 'fan_merge',
    rows: parseGrid([
      ['○', 'fan_merge', 'g'],
      ['╰─╮─╮ ', 'gggdd.'],
      ['│↑│ │', '003_merge_a', 'ddg.d'],
      ['│ │↑│', '004_merge_b', 'd.ggd'],
      ['│ │ │↑', '005_merge_c', 'd.g.dd'],
      ['○ │ │', 'fan_a', 'd.g.d'],
      ['│↑│ │', '000_fan_a_init', 'ddg.d'],
      ['│ ○ │', 'fan_b', 'd.g.d'],
      ['│ │↑│', '001_fan_b_init', 'd.ggd'],
      ['│ │ ○', 'fan_c', 'd.g.d'],
      ['│ │ │↑', '002_fan_c_init', 'd.g.dd'],
      ['╭─╯─╯ ', 'gggdd.'],
      ['○', '∅', 'g'],
    ]),
  },
  // fan-3:focus:altB
  {
    scenario: 'fan-3',
    strategy: 'focus',
    variant: 'altB',
    description: 'highlight altB (col2) path — entire merge connector sweep green',
    input: fan3Input,
    onPath: ['002_fan_c_init', '005_merge_c'],
    from: '∅',
    to: 'fan_merge',
    rows: parseGrid([
      ['○', 'fan_merge', 'g'],
      ['╰───╮', 'ggggg'],
      ['│↑│ │', '003_merge_a', 'ddd.g'],
      ['│ │↑│', '004_merge_b', 'd.ddg'],
      ['│ │ │↑', '005_merge_c', 'd.d.gg'],
      ['○ │ │', 'fan_a', 'd.d.g'],
      ['│↑│ │', '000_fan_a_init', 'ddd.g'],
      ['│ ○ │', 'fan_b', 'd.d.g'],
      ['│ │↑│', '001_fan_b_init', 'd.ddg'],
      ['│ │ ○', 'fan_c', 'd.d.g'],
      ['│ │ │↑', '002_fan_c_init', 'd.d.gg'],
      ['╭───╯ ', 'ggggg.'],
      ['○', '∅', 'g'],
    ]),
  },
  // ── wide-fan ─────────────────────────────────────────────────────────────
  // wide-fan:flat
  {
    scenario: 'wide-fan',
    strategy: 'flat',
    variant: undefined,
    description: 'pure divergence, 3 tips, no reconvergence, normal rotation',
    input: wideFanInput,
    onPath: [],
    rows: parseGrid([
      ['○', 'wf_a', '1'],
      ['│↑', '001_wf_a_ft', '11'],
      ['│ ○', 'wf_b', '1.2'],
      ['│ │↑', '002_wf_b_ft', '1.22'],
      ['│ │ ○', 'wf_c', '1.2.3'],
      ['│ │ │↑', '003_wf_c_ft', '1.2.33'],
      ['│─╯─╯', '12233'],
      ['○', 'wf_root', '1'],
      ['│↑', '000_init', '11'],
      ['○', '∅', '1'],
    ]),
  },
  // wide-fan:focus:trunk
  {
    scenario: 'wide-fan',
    strategy: 'focus',
    variant: 'trunk',
    description: 'highlight trunk path (∅→wf_root→wf_a)',
    input: wideFanInput,
    onPath: ['000_init', '001_wf_a_ft'],
    from: '∅',
    to: 'wf_a',
    rows: parseGrid([
      ['○', 'wf_a', 'g'],
      ['│↑', '001_wf_a_ft', 'gg'],
      ['│ ○', 'wf_b', 'g.d'],
      ['│ │↑', '002_wf_b_ft', 'g.dd'],
      ['│ │ ○', 'wf_c', 'g.d.d'],
      ['│ │ │↑', '003_wf_c_ft', 'g.d.dd'],
      ['│─╯─╯', 'gdddd'],
      ['○', 'wf_root', 'g'],
      ['│↑', '000_init', 'gg'],
      ['○', '∅', 'g'],
    ]),
  },
  // wide-fan:focus:alt
  {
    scenario: 'wide-fan',
    strategy: 'focus',
    variant: 'alt',
    description: 'highlight alt path (∅→wf_root→wf_b)',
    input: wideFanInput,
    onPath: ['000_init', '002_wf_b_ft'],
    from: '∅',
    to: 'wf_b',
    rows: parseGrid([
      ['○', 'wf_a', 'd'],
      ['│↑', '001_wf_a_ft', 'dd'],
      ['│ ○', 'wf_b', 'd.g'],
      ['│ │↑', '002_wf_b_ft', 'd.gg'],
      ['│ │ ○', 'wf_c', 'd.g.d'],
      ['│ │ │↑', '003_wf_c_ft', 'd.g.dd'],
      ['╭─╯─╯', 'gggdd'],
      ['○', 'wf_root', 'g'],
      ['│↑', '000_init', 'gg'],
      ['○', '∅', 'g'],
    ]),
  },
];

/**
 * Shared test graphs for the graph renderer test suite.
 */
import {
  type GraphEdge,
  type GraphNode,
  type GraphRenderOptions,
  type NodeMarker,
  RenderGraph,
} from '../../../src/utils/formatters/graph-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nodes(...ids: string[]): GraphNode[] {
  return ids.map((id) => ({ id }));
}

function node(id: string, markers?: NodeMarker[], style?: GraphNode['style']): GraphNode {
  return { id, markers, style };
}

function edge(from: string, to: string, label?: string): GraphEdge {
  return label !== undefined ? { from, to, label } : { from, to };
}

const db: NodeMarker = { kind: 'db' };
const contract: NodeMarker = { kind: 'contract', planned: true };
const unplanned: NodeMarker = { kind: 'contract', planned: false };
function ref(name: string, active = false): NodeMarker {
  return { kind: 'ref', name, active };
}

// ---------------------------------------------------------------------------
// Graph shape
// ---------------------------------------------------------------------------

export interface TestGraph {
  readonly name: string;
  readonly graph: RenderGraph;
  readonly options: GraphRenderOptions;
}

function testGraph(
  name: string,
  graphNodes: readonly GraphNode[],
  graphEdges: readonly GraphEdge[],
  options: GraphRenderOptions,
): TestGraph {
  return { name, graph: new RenderGraph(graphNodes, graphEdges), options };
}

// ---------------------------------------------------------------------------
// Graphs — organized from simple to complex
// ---------------------------------------------------------------------------

// 1. Trivial: single node, no edges
const emptyGraph = testGraph('Empty graph', nodes('∅'), [], { spineTarget: '∅', rootId: '∅' });

// 2. Single edge: ∅ → A
const singleEdge = testGraph(
  'Single edge',
  nodes('∅', 'abc1234'),
  [edge('∅', 'abc1234', '2025-01-15T1022_add-users')],
  { spineTarget: 'abc1234', rootId: '∅' },
);

// 3. Linear chain: ∅ → A → B → C
const linearChain = testGraph(
  'Linear chain',
  [...nodes('∅', 'abc1234', '7e1b9a0'), node('f03da82', [db, ref('prod')])],
  [
    edge('∅', 'abc1234', '20260101_init'),
    edge('abc1234', '7e1b9a0', '20260102_add_users'),
    edge('7e1b9a0', 'f03da82', '20260103_add_posts'),
  ],
  { spineTarget: 'f03da82', rootId: '∅' },
);

// 4. Linear with rollbacks: forward + backward on same spine
const linearWithRollbacks = testGraph(
  'Linear with rollbacks',
  nodes('∅', 'abc1234', 'def5678'),
  [
    edge('∅', 'abc1234', '2025-01-15T1022_add-users'),
    edge('abc1234', 'def5678', '2025-02-03T0905_add-posts'),
    edge('def5678', 'abc1234', '2025-02-03T0906_rollback-add-posts'),
    edge('abc1234', '∅', '2025-01-15T1023_rollback-add-users'),
  ],
  { spineTarget: 'def5678', rootId: '∅' },
);

// 5. Simple rollback cycle: ∅→A→B→C, C→A
const simpleRollback = testGraph(
  'Simple rollback',
  nodes('∅', 'A', 'B', 'C'),
  [
    edge('∅', 'A', 'init'),
    edge('A', 'B', 'add_users'),
    edge('B', 'C', 'bad_migration'),
    edge('C', 'A', 'rollback'),
  ],
  { spineTarget: 'C', rootId: '∅' },
);

// 6. Simple rollback cycle (adjacent): ∅→A→B, B→A
const simpleRollbackCycle = testGraph(
  'Simple rollback cycle',
  nodes('∅', 'abc1234', 'def5678'),
  [
    edge('∅', 'abc1234', '2025-01-15T1022_add-users'),
    edge('abc1234', 'def5678', '2025-02-03T0905_add-posts'),
    edge('def5678', 'abc1234', '2025-02-05T1000_rollback-add-posts'),
  ],
  { spineTarget: 'def5678', rootId: '∅' },
);

// 7. Multi-hop rollback: last node rolls back several hops
const multiHopRollback = testGraph(
  'Multi-hop rollback',
  nodes('∅', 'abc1234', 'def5678', 'ghi7890'),
  [
    edge('∅', 'abc1234', '2025-01-15T1022_add-users'),
    edge('abc1234', 'def5678', '2025-02-03T0905_add-posts'),
    edge('def5678', 'ghi7890', '2025-03-10T0900_add-comments'),
    edge('ghi7890', 'abc1234', '2025-03-12T0800_full-rollback'),
  ],
  { spineTarget: 'ghi7890', rootId: '∅' },
);

// 8. Step-by-step rollback: D→C→B→A chain
const stepRollback = testGraph(
  'Step-by-step rollback',
  nodes('∅', 'A', 'B', 'C', 'D'),
  [
    edge('∅', 'A', 'init'),
    edge('A', 'B', 'step_1'),
    edge('B', 'C', 'step_2'),
    edge('C', 'D', 'step_3'),
    edge('D', 'C', 'rollback_d'),
    edge('C', 'B', 'rollback_c'),
    edge('B', 'A', 'rollback_b'),
  ],
  { spineTarget: 'D', rootId: '∅' },
);

// 9. Skip rollback: D→B and C→A (skipping intermediate nodes)
const skipRollback = testGraph(
  'Skip rollback',
  nodes('∅', 'A', 'B', 'C', 'D'),
  [
    edge('∅', 'A', 'init'),
    edge('A', 'B', 'step_1'),
    edge('B', 'C', 'step_2'),
    edge('C', 'D', 'step_3'),
    edge('D', 'B', 'rollback_to_b'),
    edge('C', 'A', 'rollback_to_a'),
  ],
  { spineTarget: 'D', rootId: '∅' },
);

// 10. Rollback via intermediate branch nodes: A → X → Y → A (cycle through branch)
const rollbackViaIntermediates = testGraph(
  'Rollback via intermediates',
  [...nodes('∅', 'A', 'B', 'X', 'Y'), node('C', [db, ref('prod')])],
  [
    edge('∅', 'A', 'init'),
    edge('A', 'B', 'add_users'),
    edge('B', 'C', 'add_posts'),
    edge('A', 'X', 'experiment'),
    edge('X', 'Y', 'experiment_2'),
    edge('Y', 'A', 'rollback'),
  ],
  { spineTarget: 'C', rootId: '∅' },
);

// 11. Rollback then continue: full rollback D→C→B→A, then A→E (new path)
const rollbackThenContinue = testGraph(
  'Rollback then continue',
  [...nodes('∅', 'A', 'B', 'C', 'D'), node('E', [db, ref('prod')])],
  [
    edge('∅', 'A', 'init'),
    edge('A', 'B', 'step_1'),
    edge('B', 'C', 'step_2'),
    edge('C', 'D', 'step_3'),
    edge('D', 'C', 'rollback_d'),
    edge('C', 'B', 'rollback_c'),
    edge('B', 'A', 'rollback_b'),
    edge('A', 'E', 'fresh_start'),
  ],
  { spineTarget: 'E', rootId: '∅' },
);

// 12. Parallel edges: two edges between same nodes
const parallelEdges = testGraph(
  'Parallel edges',
  nodes('∅', 'abc1234', 'def5678'),
  [
    edge('∅', 'abc1234', '2025-01-15T1022_add-users'),
    edge('abc1234', 'def5678', '2025-02-03T0905_add-posts'),
    edge('abc1234', 'def5678', '2025-02-03T0906_add-posts-v2'),
  ],
  { spineTarget: 'def5678', rootId: '∅' },
);

// 13. Single branch: spine + one branch
const singleBranch = testGraph(
  'Single branch',
  [...nodes('∅', 'A', 'B', 'X'), node('C', [ref('prod', true)]), node('Y', [ref('staging')])],
  [
    edge('∅', 'A', 'init'),
    edge('A', 'B', 'add_users'),
    edge('B', 'C', 'add_posts'),
    edge('A', 'X', 'feature_x'),
    edge('X', 'Y', 'feature_y'),
  ],
  { spineTarget: 'C', rootId: '∅' },
);

// 14. Branch with continuation: spine continues past branch point
const branchWithContinuation = testGraph(
  'Branch with continuation',
  [node('∅'), node('abc1234', [db]), node('7e1b9a0'), node('f03da82'), node('b82cc10')],
  [
    edge('∅', 'abc1234', '2025-01-15T1022_add-users'),
    edge('abc1234', '7e1b9a0', '2025-02-03T0905_add-posts'),
    edge('7e1b9a0', 'f03da82', '2025-03-10T0900_add-comments'),
    edge('abc1234', 'b82cc10', '2025-03-20T0900_add-reactions'),
  ],
  { spineTarget: 'f03da82', rootId: '∅' },
);

// 15. Diamond (convergence): A → B → D, A → C → D
const diamond = testGraph(
  'Diamond (convergence)',
  [...nodes('∅', 'A', 'B', 'C'), node('D', [db, ref('prod')])],
  [
    edge('∅', 'A', 'init'),
    edge('A', 'B', 'path_a'),
    edge('A', 'C', 'path_b'),
    edge('B', 'D', 'merge_a'),
    edge('C', 'D', 'merge_b'),
  ],
  { spineTarget: 'D', rootId: '∅' },
);

// 16. Multi-branch: 3 branches at different spine points
const multiBranch = testGraph(
  'Multi-branch (3 branches)',
  nodes('∅', 'A', 'B', 'C', 'D', 'X', 'Y', 'Z', 'W'),
  [
    edge('∅', 'A', 'init'),
    edge('A', 'B', 'add_users'),
    edge('B', 'C', 'add_posts'),
    edge('C', 'D', 'add_comments'),
    edge('A', 'X', 'hotfix'),
    edge('B', 'Y', 'feature'),
    edge('Y', 'Z', 'feature_done'),
    edge('C', 'W', 'experiment'),
  ],
  { spineTarget: 'D', rootId: '∅' },
);

// 17. Sub-branches: branch off a branch
const subBranches = testGraph(
  'Sub-branches',
  nodes('∅', 'A', 'B', 'C', 'X', 'Y', 'W', 'U'),
  [
    edge('∅', 'A', 'init'),
    edge('A', 'B', 'add_users'),
    edge('B', 'C', 'add_posts'),
    edge('A', 'X', 'feature'),
    edge('X', 'Y', 'feature_done'),
    edge('X', 'W', 'sub_feature'),
    edge('W', 'U', 'sub_feature_done'),
  ],
  { spineTarget: 'C', rootId: '∅' },
);

// 18. Complex: diamond + extra branch + rollback
const complex = testGraph(
  'Complex (diamond + branch + rollback)',
  [...nodes('∅', 'A', 'B', 'C', 'D'), node('F', [ref('prod'), db]), node('E', [ref('staging')])],
  [
    edge('∅', 'A', 'init'),
    edge('A', 'B', 'path_a'),
    edge('A', 'C', 'path_b'),
    edge('B', 'D', 'merge_a'),
    edge('C', 'D', 'merge_b'),
    edge('D', 'F', 'add_tags'),
    edge('D', 'E', 'staging_feature'),
    edge('E', 'D', 'rollback_staging'),
  ],
  { spineTarget: 'F', rootId: '∅' },
);

// 19. Detached contract node
const detachedContract = testGraph(
  'Detached contract node',
  [...nodes('∅', 'A'), node('B', [ref('prod', true), db]), node('planned', [contract], 'detached')],
  [edge('∅', 'A', 'init'), edge('A', 'B', 'add_users')],
  { spineTarget: 'B', rootId: '∅' },
);

// 20. Sequential diamonds: two merge cycles in a row
const sequentialDiamonds = testGraph(
  'Sequential diamonds',
  nodes('∅', 'A', 'B', 'C', 'D', 'E', 'F', 'G'),
  [
    edge('∅', 'A', 'init'),
    edge('A', 'B', 'alice_1'),
    edge('A', 'C', 'bob_1'),
    edge('B', 'D', 'merge_1a'),
    edge('C', 'D', 'merge_1b'),
    edge('D', 'E', 'alice_2'),
    edge('D', 'F', 'bob_2'),
    edge('E', 'G', 'merge_2a'),
    edge('F', 'G', 'merge_2b'),
  ],
  { spineTarget: 'G', rootId: '∅' },
);

// 21. Wide fan: 5 branches from one node
const wideFan = testGraph(
  'Wide fan (5 branches)',
  [...nodes('∅', 'A', 'B', 'C', 'D', 'E', 'F'), node('G', [ref('prod'), db])],
  [
    edge('∅', 'A', 'init'),
    edge('A', 'G', 'spine_continue'),
    edge('A', 'B', 'branch_1'),
    edge('A', 'C', 'branch_2'),
    edge('A', 'D', 'branch_3'),
    edge('A', 'E', 'branch_4'),
    edge('A', 'F', 'branch_5'),
  ],
  { spineTarget: 'G', rootId: '∅' },
);

// 22. Diamond with sub-branch: one diamond path has a branch off it
const diamondWithSubBranch = testGraph(
  'Diamond with sub-branch',
  nodes('∅', 'A', 'B', 'C', 'D', 'E', 'F'),
  [
    edge('∅', 'A', 'init'),
    edge('A', 'B', 'alice'),
    edge('A', 'C', 'bob'),
    edge('B', 'D', 'merge_a'),
    edge('C', 'D', 'merge_b'),
    edge('C', 'E', 'bob_experiment'),
    edge('E', 'F', 'bob_experiment_2'),
  ],
  { spineTarget: 'D', rootId: '∅' },
);

// 23. Multiple rollbacks at different depths + a branch
const multiRollbackWithBranch = testGraph(
  'Multiple rollbacks + branch',
  [...nodes('∅', 'A', 'B', 'C', 'D'), node('E', [ref('staging')]), node('F', [ref('prod'), db])],
  [
    edge('∅', 'A', 'init'),
    edge('A', 'B', 'add_users'),
    edge('B', 'C', 'add_posts'),
    edge('C', 'D', 'add_comments'),
    edge('D', 'F', 'add_tags'),
    edge('D', 'B', 'rollback_to_b'),
    edge('C', 'A', 'rollback_to_a'),
    edge('B', 'E', 'staging_feature'),
  ],
  { spineTarget: 'F', rootId: '∅' },
);

// 24. Converging branches: 3 branches all merge into same node
const convergingBranches = testGraph(
  'Converging branches (3→1)',
  nodes('∅', 'A', 'B', 'C', 'D', 'E'),
  [
    edge('∅', 'A', 'init'),
    edge('A', 'B', 'alice'),
    edge('A', 'C', 'bob'),
    edge('A', 'D', 'carol'),
    edge('B', 'E', 'merge_a'),
    edge('C', 'E', 'merge_b'),
    edge('D', 'E', 'merge_c'),
  ],
  { spineTarget: 'E', rootId: '∅' },
);

// 25. Long spine with late branch
const longSpineLateBranch = testGraph(
  'Long spine + late branch',
  [
    ...nodes('∅', 'A', 'B', 'C', 'D', 'E', 'F', 'G'),
    node('H', [ref('prod'), db]),
    node('X', [ref('staging')]),
  ],
  [
    edge('∅', 'A', 'step_1'),
    edge('A', 'B', 'step_2'),
    edge('B', 'C', 'step_3'),
    edge('C', 'D', 'step_4'),
    edge('D', 'E', 'step_5'),
    edge('E', 'F', 'step_6'),
    edge('F', 'G', 'step_7'),
    edge('G', 'H', 'step_8'),
    edge('G', 'X', 'staging_feature'),
  ],
  { spineTarget: 'H', rootId: '∅' },
);

// 26. Named refs on a linear chain
const namedRefs = testGraph(
  'Named refs',
  [
    node('∅'),
    node('abc1234'),
    node('7e1b9a0', [ref('staging')]),
    node('f03da82', [ref('production')]),
  ],
  [
    edge('∅', 'abc1234', '2025-01-15T1022_add-users'),
    edge('abc1234', '7e1b9a0', '2025-02-03T0905_add-posts'),
    edge('7e1b9a0', 'f03da82', '2025-03-10T0900_add-comments'),
  ],
  { spineTarget: 'f03da82', rootId: '∅' },
);

// 27. Refs + DB combined
const refsPlusDb = testGraph(
  'Refs + DB combined',
  [
    node('∅'),
    node('abc1234'),
    node('7e1b9a0', [db, ref('staging')]),
    node('f03da82', [{ kind: 'contract', planned: false }, ref('production')]),
  ],
  [
    edge('∅', 'abc1234', '2025-01-15T1022_add-users'),
    edge('abc1234', '7e1b9a0', '2025-02-03T0905_add-posts'),
    edge('7e1b9a0', 'f03da82', '2025-03-10T0900_add-comments'),
  ],
  { spineTarget: 'f03da82', rootId: '∅' },
);

// 28. DB marker — fully applied
const dbFullyApplied = testGraph(
  'DB marker — fully applied',
  [node('∅'), node('abc1234'), node('f03da82', [db])],
  [
    edge('∅', 'abc1234', '2025-01-15T1022_add-users'),
    edge('abc1234', 'f03da82', '2025-03-10T0900_add-comments'),
  ],
  { spineTarget: 'f03da82', rootId: '∅' },
);

// 29. DB marker on a branch
const dbOnBranch = testGraph(
  'DB marker on a branch',
  [node('∅'), node('abc1234'), node('f03da82'), node('9c4f1e7', [db])],
  [
    edge('∅', 'abc1234', '2025-01-15T1022_add-users'),
    edge('abc1234', 'f03da82', '2025-03-10T0900_add-comments'),
    edge('abc1234', '9c4f1e7', '2025-02-10T0800_add-tags'),
  ],
  { spineTarget: 'f03da82', rootId: '∅' },
);

// 30. DB marker after rollback
const dbAfterRollback = testGraph(
  'DB marker after rollback',
  [node('∅'), node('abc1234', [db]), node('def5678')],
  [
    edge('∅', 'abc1234', '2025-01-15T1022_add-users'),
    edge('abc1234', 'def5678', '2025-02-03T0905_add-posts'),
    edge('def5678', 'abc1234', '2025-02-05T1000_rollback-add-posts'),
  ],
  { spineTarget: 'def5678', rootId: '∅' },
);

// 31. Partial rollback then continue
const partialRollbackThenContinue = testGraph(
  'Partial rollback then continue',
  nodes('∅', 'abc1234', 'def5678', 'ghi7890', 'jkl1234'),
  [
    edge('∅', 'abc1234', '2025-01-15T1022_add-users'),
    edge('abc1234', 'def5678', '2025-02-03T0905_add-posts'),
    edge('def5678', 'ghi7890', '2025-03-10T0900_add-comments'),
    edge('ghi7890', 'def5678', '2025-03-12T0800_rollback-add-comments'),
    edge('def5678', 'jkl1234', '2025-03-20T0900_add-likes'),
  ],
  { spineTarget: 'jkl1234', rootId: '∅' },
);

// 32. Realistic team workflow: diamond + staging branch + detached contract
const teamWorkflow = testGraph(
  'Realistic team workflow',
  [
    ...nodes('sha256:∅', 'a1b2c3d', 'e4f5g6h', 'f7a8b9c', 'g0h1i2j', 'k3l4m5n'),
    node('p6q7r8s', [ref('prod', true), db]),
    node('t9u0v1w', [ref('staging')]),
    node('x2y3z4a', [unplanned], 'detached'),
  ],
  [
    edge('sha256:∅', 'a1b2c3d', 'init'),
    edge('a1b2c3d', 'e4f5g6h', 'add_users'),
    edge('e4f5g6h', 'f7a8b9c', 'alice_add_posts'),
    edge('e4f5g6h', 'g0h1i2j', 'bob_add_comments'),
    edge('f7a8b9c', 'k3l4m5n', 'merge_alice'),
    edge('g0h1i2j', 'k3l4m5n', 'merge_bob'),
    edge('k3l4m5n', 'p6q7r8s', 'add_tags'),
    edge('k3l4m5n', 't9u0v1w', 'staging_experiment'),
  ],
  { spineTarget: 'p6q7r8s', rootId: 'sha256:∅' },
);

// 33. Multi-team workflow: diamond + dev branches + staging + QA + rollbacks + detached
const multiTeamWorkflow = testGraph(
  'Multi-team workflow (7 refs)',
  [
    node('∅'),
    node('abc1234'),
    node('def5678'),
    node('a11ce01'),
    node('b0b0001'),
    node('mer9e01'),
    node('f1x0001'),
    node('re1ea5e', [ref('prod'), db]),
    node('5ta9e01', [ref('staging')]),
    node('qa00001', [ref('qa')]),
    node('dev0001', [ref('dev-alice')]),
    node('dev0002', [ref('dev-bob')]),
    node('pre0001', [ref('preview-1')]),
    node('pre0002', [ref('preview-2')]),
    node('c0n7rac', [contract], 'detached'),
  ],
  [
    edge('∅', 'abc1234', 'init'),
    edge('abc1234', 'def5678', 'add_users'),
    edge('def5678', 'a11ce01', 'alice_add_posts'),
    edge('def5678', 'b0b0001', 'bob_add_comments'),
    edge('a11ce01', 'mer9e01', 'merge_alice'),
    edge('b0b0001', 'mer9e01', 'merge_bob'),
    edge('mer9e01', 'f1x0001', 'hotfix'),
    edge('f1x0001', 're1ea5e', 'release_v2'),
    edge('mer9e01', '5ta9e01', 'staging_deploy'),
    edge('f1x0001', 'qa00001', 'qa_deploy'),
    edge('def5678', 'dev0001', 'alice_wip'),
    edge('def5678', 'dev0002', 'bob_wip'),
    edge('dev0001', 'pre0001', 'preview_alice'),
    edge('dev0002', 'pre0002', 'preview_bob'),
    edge('5ta9e01', 'mer9e01', 'rollback_staging'),
    edge('qa00001', 'f1x0001', 'rollback_qa'),
  ],
  { spineTarget: 're1ea5e', rootId: '∅' },
);

// 34. Long spine with varied branches — designed for truncation testing.
// 15 spine nodes with branches of varying length, a diamond, a rollback,
// and a detached contract node.
//
// Spine: ∅ → S01 → S02 → S03 → S04 → S05 → S06 → S07 → S08 → S09 → S10 → S11 → S12 → S13 → S14
//
// Branches:
//   S02 → B1a                          (1-edge branch, early)
//   S04 → B2a → B2b                    (2-edge branch, mid-early)
//   S06 → B3a ──┐                      (diamond: S06 → B3a → S07, S06 → S07)
//               └─→ S07
//   S08 → B4a → B4b → B4c             (3-edge branch, mid-late)
//   S10 → R1 → S09                     (rollback from S10 to S09)
//   S12 → B5a                          (1-edge branch, late)
//   S14 → detached contract            (off-graph contract)
//
const longSpineWithBranches = testGraph(
  'Long spine with varied branches',
  [
    node('∅'),
    ...nodes('S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09', 'S10'),
    node('S11', [db]),
    ...nodes('S12', 'S13'),
    node('S14', [ref('prod', true)]),
    // branches
    node('B1a', [ref('hotfix')]),
    ...nodes('B2a', 'B2b'),
    ...nodes('B3a'),
    ...nodes('B4a', 'B4b', 'B4c'),
    ...nodes('R1'),
    node('B5a', [ref('staging')]),
    // detached
    node('planned', [contract], 'detached'),
  ],
  [
    // spine
    edge('∅', 'S01', '20260101_init'),
    edge('S01', 'S02', '20260102_add_users'),
    edge('S02', 'S03', '20260103_add_posts'),
    edge('S03', 'S04', '20260104_add_comments'),
    edge('S04', 'S05', '20260105_add_tags'),
    edge('S05', 'S06', '20260106_add_likes'),
    edge('S06', 'S07', '20260107_add_reactions'),
    edge('S07', 'S08', '20260108_add_notifications'),
    edge('S08', 'S09', '20260109_add_settings'),
    edge('S09', 'S10', '20260110_add_profiles'),
    edge('S10', 'S11', '20260111_add_avatars'),
    edge('S11', 'S12', '20260112_add_groups'),
    edge('S12', 'S13', '20260113_add_roles'),
    edge('S13', 'S14', '20260114_add_permissions'),
    // branch: 1-edge from S02
    edge('S02', 'B1a', '20260102_hotfix_typo'),
    // branch: 2-edge from S04
    edge('S04', 'B2a', '20260104_feature_search'),
    edge('B2a', 'B2b', '20260104_feature_search_v2'),
    // diamond: S06 → B3a → S07 (merges back)
    edge('S06', 'B3a', '20260106_alice_refactor'),
    edge('B3a', 'S07', '20260106_merge_alice'),
    // branch: 3-edge from S08
    edge('S08', 'B4a', '20260108_experiment_a'),
    edge('B4a', 'B4b', '20260108_experiment_b'),
    edge('B4b', 'B4c', '20260108_experiment_c'),
    // rollback: S10 → R1 → S09
    edge('S10', 'R1', '20260110_start_rollback'),
    edge('R1', 'S09', '20260110_complete_rollback'),
    // branch: 1-edge from S12
    edge('S12', 'B5a', '20260112_staging_deploy'),
  ],
  { spineTarget: 'S14', rootId: '∅' },
);

// 35. Same as #34 but without the detached contract — contract is on-graph at S14
const longSpineOnGraphContract = testGraph(
  'Long spine (contract on graph)',
  [
    node('∅'),
    ...nodes('S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09', 'S10'),
    node('S11', [db]),
    ...nodes('S12', 'S13'),
    node('S14', [ref('prod', true), contract]),
    // branches (same as #34)
    node('B1a', [ref('hotfix')]),
    ...nodes('B2a', 'B2b'),
    ...nodes('B3a'),
    ...nodes('B4a', 'B4b', 'B4c'),
    ...nodes('R1'),
    node('B5a', [ref('staging')]),
  ],
  [
    edge('∅', 'S01', '20260101_init'),
    edge('S01', 'S02', '20260102_add_users'),
    edge('S02', 'S03', '20260103_add_posts'),
    edge('S03', 'S04', '20260104_add_comments'),
    edge('S04', 'S05', '20260105_add_tags'),
    edge('S05', 'S06', '20260106_add_likes'),
    edge('S06', 'S07', '20260107_add_reactions'),
    edge('S07', 'S08', '20260108_add_notifications'),
    edge('S08', 'S09', '20260109_add_settings'),
    edge('S09', 'S10', '20260110_add_profiles'),
    edge('S10', 'S11', '20260111_add_avatars'),
    edge('S11', 'S12', '20260112_add_groups'),
    edge('S12', 'S13', '20260113_add_roles'),
    edge('S13', 'S14', '20260114_add_permissions'),
    edge('S02', 'B1a', '20260102_hotfix_typo'),
    edge('S04', 'B2a', '20260104_feature_search'),
    edge('B2a', 'B2b', '20260104_feature_search_v2'),
    edge('S06', 'B3a', '20260106_alice_refactor'),
    edge('B3a', 'S07', '20260106_merge_alice'),
    edge('S08', 'B4a', '20260108_experiment_a'),
    edge('B4a', 'B4b', '20260108_experiment_b'),
    edge('B4b', 'B4c', '20260108_experiment_c'),
    edge('S10', 'R1', '20260110_start_rollback'),
    edge('R1', 'S09', '20260110_complete_rollback'),
    edge('S12', 'B5a', '20260112_staging_deploy'),
  ],
  { spineTarget: 'S14', rootId: '∅' },
);

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const allGraphs: readonly TestGraph[] = [
  emptyGraph,
  singleEdge,
  linearChain,
  linearWithRollbacks,
  simpleRollback,
  simpleRollbackCycle,
  multiHopRollback,
  stepRollback,
  skipRollback,
  rollbackViaIntermediates,
  rollbackThenContinue,
  parallelEdges,
  singleBranch,
  branchWithContinuation,
  diamond,
  multiBranch,
  subBranches,
  complex,
  detachedContract,
  sequentialDiamonds,
  wideFan,
  diamondWithSubBranch,
  multiRollbackWithBranch,
  convergingBranches,
  longSpineLateBranch,
  namedRefs,
  refsPlusDb,
  dbFullyApplied,
  dbOnBranch,
  dbAfterRollback,
  partialRollbackThenContinue,
  teamWorkflow,
  multiTeamWorkflow,
  longSpineWithBranches,
  longSpineOnGraphContract,
];

export {
  emptyGraph,
  singleEdge,
  linearChain,
  linearWithRollbacks,
  simpleRollback,
  simpleRollbackCycle,
  multiHopRollback,
  stepRollback,
  skipRollback,
  rollbackViaIntermediates,
  rollbackThenContinue,
  parallelEdges,
  singleBranch,
  branchWithContinuation,
  diamond,
  multiBranch,
  subBranches,
  complex,
  detachedContract,
  sequentialDiamonds,
  wideFan,
  diamondWithSubBranch,
  multiRollbackWithBranch,
  convergingBranches,
  longSpineLateBranch,
  namedRefs,
  refsPlusDb,
  dbFullyApplied,
  dbOnBranch,
  dbAfterRollback,
  partialRollbackThenContinue,
  teamWorkflow,
  multiTeamWorkflow,
  longSpineWithBranches,
  longSpineOnGraphContract,
};

import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import type { MigrationEdge, MigrationGraph } from '@prisma-next/migration-tools/graph';
import { createColors, dim } from 'colorette';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { laneColorForColumn } from '../../../src/utils/formatters/migration-graph-lane-colors';
import type { StructuralCell } from '../../../src/utils/formatters/migration-graph-layout';
import { buildMigrationGraphLayout } from '../../../src/utils/formatters/migration-graph-layout';
import { buildMigrationGraphRows } from '../../../src/utils/formatters/migration-graph-rows';
import {
  renderMigrationGraphLegend,
  renderMigrationGraphTree,
  resolveConnectorLaneColors,
} from '../../../src/utils/formatters/migration-graph-tree-render';

const { bold: forcedBold } = createColors({ useColor: true });

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

function tree(
  edges: readonly MigrationEdge[],
  opts: Parameters<typeof renderMigrationGraphTree>[1] = { colorize: false },
): string {
  const rowModel = buildMigrationGraphRows(graph(edges), {
    ...(opts.contractHash !== undefined ? { contractHash: opts.contractHash } : {}),
  });
  const layout = buildMigrationGraphLayout(rowModel);
  return renderMigrationGraphTree(layout, opts);
}

function treeAscii(
  edges: readonly MigrationEdge[],
  opts: Parameters<typeof renderMigrationGraphTree>[1] = { colorize: false },
): string {
  return tree(edges, { ...opts, glyphMode: 'ascii' });
}

function refsMap(
  entries: readonly { hash: string; names: readonly string[] }[],
): ReadonlyMap<string, readonly string[]> {
  return new Map(entries.map((e) => [e.hash, e.names]));
}

describe('renderMigrationGraphTree', () => {
  it('renders a linear chain per mockup', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'init');
    const addPosts = edge('ef9de27', 'a94b7b4', 'add_posts');
    expect(tree([init, addPosts])).toBe(
      [
        '○   a94b7b4',
        '│↑  add_posts            ef9de27 → a94b7b4',
        '○   ef9de27',
        '│↑  init                 ∅       → ef9de27',
        '∅',
      ].join('\n'),
    );
  });

  it('renders a detached contract as a floating node per mockup', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'init');
    const addPosts = edge('ef9de27', 'a94b7b4', 'add_posts');
    expect(
      tree([init, addPosts], {
        colorize: false,
        refsByHash: refsMap([{ hash: 'a94b7b4', names: ['main'] }]),
        dbHash: 'a94b7b4',
        contractHash: 'c0ffee0',
      }),
    ).toBe(
      [
        '○   c0ffee0              (contract)',
        '',
        '○   a94b7b4              (main, db)',
        '│↑  add_posts            ef9de27 → a94b7b4',
        '○   ef9de27',
        '│↑  init                 ∅       → ef9de27',
        '∅',
      ].join('\n'),
    );
  });

  it('renders node overlays for refs, db, and contract per mockup', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'init');
    const addPosts = edge('ef9de27', 'a94b7b4', 'add_posts');
    expect(
      tree([init, addPosts], {
        colorize: false,
        refsByHash: refsMap([
          { hash: 'a94b7b4', names: ['main'] },
          { hash: 'ef9de27', names: ['prod'] },
        ]),
        dbHash: 'ef9de27',
        contractHash: 'a94b7b4',
      }),
    ).toBe(
      [
        '○   a94b7b4              (main, contract)',
        '│↑  add_posts            ef9de27 → a94b7b4',
        '○   ef9de27              (prod, db)',
        '│↑  init                 ∅       → ef9de27',
        '∅',
      ].join('\n'),
    );
  });

  it('renders the node marker when a non-trunk node lands a multi-lane merge', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'A', 'init');
    const alice = edge('A', 'B', 'alice');
    const bob = edge('A', 'C', 'bob');
    const mergeAlice = edge('B', 'D', 'merge_alice');
    const mergeBob = edge('C', 'D', 'merge_bob');
    const bobExtra = edge('C', 'E', 'bob_extra');
    const promote = edge('D', 'E', 'promote');
    const edges = [init, alice, bob, mergeAlice, mergeBob, bobExtra, promote];
    const output = tree(edges);
    expect(output).toBe(
      [
        '○   E',
        '├─╮',
        '│↑│   promote            D → E',
        '│ │↑  bob_extra          C → E',
        '○ │   D',
        '├─┼─╮',
        '│↑│ │   merge_alice      B → D',
        '│ │ │↑  merge_bob        C → D',
        '○ │ │   B',
        '│↑│ │   alice            A → B',
        '│ ├─╯',
        '│ ○   C',
        '│ │↑  bob                A → C',
        '├─╯',
        '○   A',
        '│↑  init                 ∅       → A',
        '∅',
      ].join('\n'),
    );
    expect(treeAscii(edges)).toContain('| *   C');
  });

  it('renders a diamond per mockup', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'init');
    const alice = edge('ef9de27', '73e3abe', 'alice_add_phone');
    const bob = edge('ef9de27', '6656a6e', 'bob_add_avatar');
    const mergeAlice = edge('73e3abe', '3b2d98d', 'merge_alice');
    const mergeBob = edge('6656a6e', '3b2d98d', 'merge_bob');
    expect(tree([init, alice, bob, mergeAlice, mergeBob])).toBe(
      [
        '○   3b2d98d',
        '├─╮',
        '│↑│   merge_alice        73e3abe → 3b2d98d',
        '│ │↑  merge_bob          6656a6e → 3b2d98d',
        '○ │   73e3abe',
        '│↑│   alice_add_phone    ef9de27 → 73e3abe',
        '│ ○   6656a6e',
        '│ │↑  bob_add_avatar     ef9de27 → 6656a6e',
        '├─╯',
        '○   ef9de27',
        '│↑  init                 ∅       → ef9de27',
        '∅',
      ].join('\n'),
    );
  });

  it('renders a three-way convergence fan per mockup', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'init');
    const addPhone = edge('ef9de27', '73e3abe', 'add_phone');
    const addPosts = edge('ef9de27', 'a94b7b4', 'add_posts');
    const addAvatar = edge('ef9de27', '6656a6e', 'add_avatar');
    const mergePhone = edge('73e3abe', '3116048', 'merge_phone');
    const mergePosts = edge('a94b7b4', '3116048', 'merge_posts');
    const mergeAvatar = edge('6656a6e', '3116048', 'merge_avatar');
    expect(tree([init, addPhone, addPosts, addAvatar, mergePhone, mergePosts, mergeAvatar])).toBe(
      [
        '○   3116048',
        '├─┬─╮',
        '│↑│ │   merge_phone      73e3abe → 3116048',
        '│ │↑│   merge_posts      a94b7b4 → 3116048',
        '│ │ │↑  merge_avatar     6656a6e → 3116048',
        '○ │ │   73e3abe',
        '│↑│ │   add_phone        ef9de27 → 73e3abe',
        '│ ○ │   a94b7b4',
        '│ │↑│   add_posts        ef9de27 → a94b7b4',
        '│ │ ○   6656a6e',
        '│ │ │↑  add_avatar       ef9de27 → 6656a6e',
        '├─┴─╯',
        '○   ef9de27',
        '│↑  init                 ∅       → ef9de27',
        '∅',
      ].join('\n'),
    );
  });

  it('renders skip-rollback with routed back-arcs per mockup', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'init');
    const addPhone = edge('ef9de27', '73e3abe', 'add_phone');
    const addBio = edge('73e3abe', '3ee5d20', 'add_bio');
    const addPosts = edge('3ee5d20', 'a94b7b4', 'add_posts');
    const rollbackToPhone = edge('a94b7b4', '73e3abe', 'rollback_to_phone');
    const rollbackToInit = edge('3ee5d20', 'ef9de27', 'rollback_to_init');
    expect(tree([init, addPhone, addBio, addPosts, rollbackToPhone, rollbackToInit])).toBe(
      [
        '○─╮       a94b7b4',
        '│ │↓      rollback_to_phone   a94b7b4 → 73e3abe',
        '│↑│       add_posts           3ee5d20 → a94b7b4',
        '○───╮     3ee5d20',
        '│ │ │↓    rollback_to_init    3ee5d20 → ef9de27',
        '│↑│ │     add_bio             73e3abe → 3ee5d20',
        '○◂╯ │     73e3abe',
        '│↑  │     add_phone           ef9de27 → 73e3abe',
        '○◂──╯     ef9de27',
        '│↑        init                ∅       → ef9de27',
        '∅',
      ].join('\n'),
    );
  });

  it('renders an adjacent rollback as a plain down arrow per mockup', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'init');
    const addPhone = edge('ef9de27', '73e3abe', 'add_phone');
    const addBio = edge('73e3abe', '3ee5d20', 'add_bio');
    const rollbackBio = edge('3ee5d20', '73e3abe', 'rollback_bio');
    const rollbackPhone = edge('73e3abe', 'ef9de27', 'rollback_phone');
    expect(tree([init, addPhone, addBio, rollbackBio, rollbackPhone])).toBe(
      [
        '○   3ee5d20',
        '│↑  add_bio              73e3abe → 3ee5d20',
        '│↓  rollback_bio         3ee5d20 → 73e3abe',
        '○   73e3abe',
        '│↑  add_phone            ef9de27 → 73e3abe',
        '│↓  rollback_phone       73e3abe → ef9de27',
        '○   ef9de27',
        '│↑  init                 ∅       → ef9de27',
        '∅',
      ].join('\n'),
    );
  });

  it('renders a self-edge row above its node per mockup', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'aaaaaaa', 'init');
    const noop = edge('aaaaaaa', 'aaaaaaa', 'noop');
    const next = edge('aaaaaaa', 'bbbbbbb', 'next');
    expect(tree([init, noop, next])).toBe(
      [
        '○   bbbbbbb',
        '│↑  next                 aaaaaaa → bbbbbbb',
        '│⟲  noop                 aaaaaaa → aaaaaaa',
        '○   aaaaaaa',
        '│↑  init                 ∅       → aaaaaaa',
        '∅',
      ].join('\n'),
    );
  });

  it('renders a crossing glyph where a pass-through lane crosses a fan connector', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'root', 'init');
    const alice = edge('root', 'phone', 'alice');
    const bob = edge('root', 'posts', 'bob');
    const fastForward = edge('root', 'avatar', 'fast_forward');
    const mergeAlice = edge('phone', 'tip', 'merge_alice');
    const mergeBob = edge('posts', 'tip', 'merge_bob');
    const mergeFf = edge('avatar', 'tip', 'merge_ff');
    const promote = edge('posts', 'spur', 'promote');
    const spurHold = edge('spur', 'hold', 'spur_hold');
    const edges = [init, alice, bob, fastForward, mergeAlice, mergeBob, mergeFf, promote, spurHold];

    const rendered = tree(edges);
    expect(rendered).toContain('├─┬─╮');
    expect(rendered).toContain('├─┼─╯');

    const ascii = treeAscii(edges);
    expect(ascii).toContain('+-+-\\');
    expect(ascii).toContain('+-+-/');
  });

  it('appends operation count and invariants from edgeAnnotationsByHash', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'init');
    const addPhone = edge('ef9de27', '3b2d98d', '20260303_add_phone');
    const annotations = new Map([
      [init.migrationHash, { operationCount: 5 }],
      [addPhone.migrationHash, { operationCount: 2, invariants: ['phone_present'] }],
    ]);
    expect(
      tree([init, addPhone], {
        colorize: false,
        edgeAnnotationsByHash: annotations,
      }),
    ).toBe(
      [
        '○   3b2d98d',
        '│↑  20260303_add_phone   ef9de27 → 3b2d98d  2 ops  {phone_present}',
        '○   ef9de27',
        '│↑  init                 ∅       → ef9de27  5 ops',
        '∅',
      ].join('\n'),
    );
  });

  it('omits invariants from edgeAnnotationsByHash when the set is empty', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'init');
    const annotations = new Map([[init.migrationHash, { operationCount: 1, invariants: [] }]]);
    const output = tree([init], { colorize: false, edgeAnnotationsByHash: annotations });
    expect(output).toContain('1 ops');
    expect(output).not.toContain('{');
  });

  it('leaves migration rows plain when edgeAnnotationsByHash is absent', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'init');
    const output = tree([init], { colorize: false });
    expect(output).not.toContain(' ops');
  });

  it('renders a realistic multi-topology graph', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'init');
    const alice = edge('ef9de27', '73e3abe', 'alice_add_phone');
    const bob = edge('ef9de27', '6656a6e', 'bob_add_avatar');
    const mergeAlice = edge('73e3abe', '3b2d98d', 'merge_alice');
    const mergeBob = edge('6656a6e', '3b2d98d', 'merge_bob');
    const addComments = edge('3b2d98d', '0276f92', 'add_comments');
    const addPostsBranch = edge('3b2d98d', 'a94b7b4', 'add_posts_branch');
    const merge2a = edge('0276f92', 'cd5c15b', 'merge_2a');
    const merge2b = edge('a94b7b4', 'cd5c15b', 'merge_2b');
    expect(
      tree(
        [init, alice, bob, mergeAlice, mergeBob, addComments, addPostsBranch, merge2a, merge2b],
        {
          colorize: false,
          refsByHash: refsMap([{ hash: 'cd5c15b', names: ['main'] }]),
          contractHash: 'cd5c15b',
        },
      ),
    ).toMatchInlineSnapshot(`
      "○   cd5c15b              (main, contract)
      ├─╮
      │↑│   merge_2a           0276f92 → cd5c15b
      │ │↑  merge_2b           a94b7b4 → cd5c15b
      ○ │   0276f92
      │↑│   add_comments       3b2d98d → 0276f92
      │ ○   a94b7b4
      │ │↑  add_posts_branch   3b2d98d → a94b7b4
      ├─╯
      ○   3b2d98d
      ├─╮
      │↑│   merge_alice        73e3abe → 3b2d98d
      │ │↑  merge_bob          6656a6e → 3b2d98d
      ○ │   73e3abe
      │↑│   alice_add_phone    ef9de27 → 73e3abe
      │ ○   6656a6e
      │ │↑  bob_add_avatar     ef9de27 → 6656a6e
      ├─╯
      ○   ef9de27
      │↑  init                 ∅       → ef9de27
      ∅"
    `);
  });

  function convergingEdges(): readonly MigrationEdge[] {
    return [
      edge(EMPTY_CONTRACT_HASH, 'n0', 'init'),
      edge('n0', 'n1', 'm1'),
      edge('n1', 'n2', 'm2'),
      edge('n2', 'n3', 'm3'),
      edge('n3', 'n4', 'm4'),
      edge('n4', 'n5', 'm5'),
      edge('n5', 'n6', 'm6'),
      edge('n3', 'n1', 'rb_a'),
      edge('n5', 'n1', 'rb_b'),
    ];
  }

  function nodeOrder(rendered: string): string[] {
    return rendered
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^(○|∅)/.test(line))
      .map((line) => (line === '∅' ? '∅' : (line.split(/\s+/).pop() ?? '')));
  }

  it('lands two converging skip-rollbacks and keeps the tip at the top', () => {
    const rendered = tree(convergingEdges());
    // Tip first, root last — the rollbacks do not perturb the forward order.
    expect(nodeOrder(rendered)).toEqual(['n6', 'n5', 'n4', 'n3', 'n2', 'n1', 'n0', '∅']);
    // Both arcs close onto n1: an inner landing tee then the outer corner.
    const landing = rendered.split('\n').find((line) => line.includes('◂') && line.endsWith('n1'));
    expect(landing?.startsWith('○◂┴─╯')).toBe(true);
  });

  it('lands three converging skip-rollbacks onto one target', () => {
    const rendered = tree([...convergingEdges(), edge('n4', 'n1', 'rb_c')]);
    expect(nodeOrder(rendered)).toEqual(['n6', 'n5', 'n4', 'n3', 'n2', 'n1', 'n0', '∅']);
    const landing = rendered.split('\n').find((line) => line.includes('◂') && line.endsWith('n1'));
    expect(landing?.startsWith('○◂┴─┴─╯')).toBe(true);
  });

  it('renders a single skip-rollback landing as a bare corner', () => {
    const rendered = tree([
      edge(EMPTY_CONTRACT_HASH, 'n0', 'init'),
      edge('n0', 'n1', 'm1'),
      edge('n1', 'n2', 'm2'),
      edge('n2', 'n3', 'm3'),
      edge('n3', 'n4', 'm4'),
      edge('n4', 'n5', 'm5'),
      edge('n5', 'n6', 'm6'),
      edge('n5', 'n1', 'rb_b'),
    ]);
    expect(nodeOrder(rendered)).toEqual(['n6', 'n5', 'n4', 'n3', 'n2', 'n1', 'n0', '∅']);
    const landing = rendered.split('\n').find((line) => line.includes('◂') && line.endsWith('n1'));
    expect(landing?.startsWith('○◂╯')).toBe(true);
    expect(landing).not.toContain('┴');
  });
});

describe('renderMigrationGraphTree (ASCII)', () => {
  it('renders a linear chain per mockup', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'init');
    const addPosts = edge('ef9de27', 'a94b7b4', 'add_posts');
    expect(treeAscii([init, addPosts])).toMatchInlineSnapshot(`
      "*   a94b7b4
      |^  add_posts            ef9de27 -> a94b7b4
      *   ef9de27
      |^  init                 -       -> ef9de27
      -"
    `);
  });

  it('renders a detached contract as a floating node per mockup', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'init');
    const addPosts = edge('ef9de27', 'a94b7b4', 'add_posts');
    expect(
      treeAscii([init, addPosts], {
        colorize: false,
        refsByHash: refsMap([{ hash: 'a94b7b4', names: ['main'] }]),
        dbHash: 'a94b7b4',
        contractHash: 'c0ffee0',
      }),
    ).toMatchInlineSnapshot(`
      "*   c0ffee0              (contract)

      *   a94b7b4              (main, db)
      |^  add_posts            ef9de27 -> a94b7b4
      *   ef9de27
      |^  init                 -       -> ef9de27
      -"
    `);
  });

  it('renders node overlays for refs, db, and contract per mockup', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'init');
    const addPosts = edge('ef9de27', 'a94b7b4', 'add_posts');
    expect(
      treeAscii([init, addPosts], {
        colorize: false,
        refsByHash: refsMap([
          { hash: 'a94b7b4', names: ['main'] },
          { hash: 'ef9de27', names: ['prod'] },
        ]),
        dbHash: 'ef9de27',
        contractHash: 'a94b7b4',
      }),
    ).toMatchInlineSnapshot(`
      "*   a94b7b4              (main, contract)
      |^  add_posts            ef9de27 -> a94b7b4
      *   ef9de27              (prod, db)
      |^  init                 -       -> ef9de27
      -"
    `);
  });

  it('renders a diamond per mockup', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'init');
    const alice = edge('ef9de27', '73e3abe', 'alice_add_phone');
    const bob = edge('ef9de27', '6656a6e', 'bob_add_avatar');
    const mergeAlice = edge('73e3abe', '3b2d98d', 'merge_alice');
    const mergeBob = edge('6656a6e', '3b2d98d', 'merge_bob');
    expect(treeAscii([init, alice, bob, mergeAlice, mergeBob])).toMatchInlineSnapshot(`
      "*   3b2d98d
      +-\\
      |^|   merge_alice        73e3abe -> 3b2d98d
      | |^  merge_bob          6656a6e -> 3b2d98d
      * |   73e3abe
      |^|   alice_add_phone    ef9de27 -> 73e3abe
      | *   6656a6e
      | |^  bob_add_avatar     ef9de27 -> 6656a6e
      +-/
      *   ef9de27
      |^  init                 -       -> ef9de27
      -"
    `);
  });

  it('renders a three-way convergence fan per mockup', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'init');
    const addPhone = edge('ef9de27', '73e3abe', 'add_phone');
    const addPosts = edge('ef9de27', 'a94b7b4', 'add_posts');
    const addAvatar = edge('ef9de27', '6656a6e', 'add_avatar');
    const mergePhone = edge('73e3abe', '3116048', 'merge_phone');
    const mergePosts = edge('a94b7b4', '3116048', 'merge_posts');
    const mergeAvatar = edge('6656a6e', '3116048', 'merge_avatar');
    expect(
      treeAscii([init, addPhone, addPosts, addAvatar, mergePhone, mergePosts, mergeAvatar]),
    ).toMatchInlineSnapshot(`
      "*   3116048
      +-+-\\
      |^| |   merge_phone      73e3abe -> 3116048
      | |^|   merge_posts      a94b7b4 -> 3116048
      | | |^  merge_avatar     6656a6e -> 3116048
      * | |   73e3abe
      |^| |   add_phone        ef9de27 -> 73e3abe
      | * |   a94b7b4
      | |^|   add_posts        ef9de27 -> a94b7b4
      | | *   6656a6e
      | | |^  add_avatar       ef9de27 -> 6656a6e
      +-+-/
      *   ef9de27
      |^  init                 -       -> ef9de27
      -"
    `);
  });

  it('renders skip-rollback with routed back-arcs per mockup', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'init');
    const addPhone = edge('ef9de27', '73e3abe', 'add_phone');
    const addBio = edge('73e3abe', '3ee5d20', 'add_bio');
    const addPosts = edge('3ee5d20', 'a94b7b4', 'add_posts');
    const rollbackToPhone = edge('a94b7b4', '73e3abe', 'rollback_to_phone');
    const rollbackToInit = edge('3ee5d20', 'ef9de27', 'rollback_to_init');
    expect(
      treeAscii([init, addPhone, addBio, addPosts, rollbackToPhone, rollbackToInit]),
    ).toMatchInlineSnapshot(`
      "*-\\       a94b7b4
      | |v      rollback_to_phone   a94b7b4 -> 73e3abe
      |^|       add_posts           3ee5d20 -> a94b7b4
      *---\\     3ee5d20
      | | |v    rollback_to_init    3ee5d20 -> ef9de27
      |^| |     add_bio             73e3abe -> 3ee5d20
      *</ |     73e3abe
      |^  |     add_phone           ef9de27 -> 73e3abe
      *<--/     ef9de27
      |^        init                -       -> ef9de27
      -"
    `);
  });

  it('renders an adjacent rollback as a plain down arrow per mockup', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'init');
    const addPhone = edge('ef9de27', '73e3abe', 'add_phone');
    const addBio = edge('73e3abe', '3ee5d20', 'add_bio');
    const rollbackBio = edge('3ee5d20', '73e3abe', 'rollback_bio');
    const rollbackPhone = edge('73e3abe', 'ef9de27', 'rollback_phone');
    expect(treeAscii([init, addPhone, addBio, rollbackBio, rollbackPhone])).toMatchInlineSnapshot(`
      "*   3ee5d20
      |^  add_bio              73e3abe -> 3ee5d20
      |v  rollback_bio         3ee5d20 -> 73e3abe
      *   73e3abe
      |^  add_phone            ef9de27 -> 73e3abe
      |v  rollback_phone       73e3abe -> ef9de27
      *   ef9de27
      |^  init                 -       -> ef9de27
      -"
    `);
  });

  it('renders a self-edge row above its node per mockup', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'aaaaaaa', 'init');
    const noop = edge('aaaaaaa', 'aaaaaaa', 'noop');
    const next = edge('aaaaaaa', 'bbbbbbb', 'next');
    expect(treeAscii([init, noop, next])).toMatchInlineSnapshot(`
      "*   bbbbbbb
      |^  next                 aaaaaaa -> bbbbbbb
      |@  noop                 aaaaaaa -> aaaaaaa
      *   aaaaaaa
      |^  init                 -       -> aaaaaaa
      -"
    `);
  });

  it('renders a realistic multi-topology graph', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'init');
    const alice = edge('ef9de27', '73e3abe', 'alice_add_phone');
    const bob = edge('ef9de27', '6656a6e', 'bob_add_avatar');
    const mergeAlice = edge('73e3abe', '3b2d98d', 'merge_alice');
    const mergeBob = edge('6656a6e', '3b2d98d', 'merge_bob');
    const addComments = edge('3b2d98d', '0276f92', 'add_comments');
    const addPostsBranch = edge('3b2d98d', 'a94b7b4', 'add_posts_branch');
    const merge2a = edge('0276f92', 'cd5c15b', 'merge_2a');
    const merge2b = edge('a94b7b4', 'cd5c15b', 'merge_2b');
    expect(
      treeAscii(
        [init, alice, bob, mergeAlice, mergeBob, addComments, addPostsBranch, merge2a, merge2b],
        {
          colorize: false,
          refsByHash: refsMap([{ hash: 'cd5c15b', names: ['main'] }]),
          contractHash: 'cd5c15b',
        },
      ),
    ).toMatchInlineSnapshot(`
      "*   cd5c15b              (main, contract)
      +-\\
      |^|   merge_2a           0276f92 -> cd5c15b
      | |^  merge_2b           a94b7b4 -> cd5c15b
      * |   0276f92
      |^|   add_comments       3b2d98d -> 0276f92
      | *   a94b7b4
      | |^  add_posts_branch   3b2d98d -> a94b7b4
      +-/
      *   3b2d98d
      +-\\
      |^|   merge_alice        73e3abe -> 3b2d98d
      | |^  merge_bob          6656a6e -> 3b2d98d
      * |   73e3abe
      |^|   alice_add_phone    ef9de27 -> 73e3abe
      | *   6656a6e
      | |^  bob_add_avatar     ef9de27 -> 6656a6e
      +-/
      *   ef9de27
      |^  init                 -       -> ef9de27
      -"
    `);
  });
});

describe('renderMigrationGraphTree (lane colors)', () => {
  function linearEdges(): readonly MigrationEdge[] {
    const init = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'init');
    const addUsers = edge('ef9de27', '73e3abe', 'add_users');
    const addPosts = edge('73e3abe', '6656a6e', 'add_posts');
    return [init, addUsers, addPosts];
  }

  function diamondEdges(): readonly MigrationEdge[] {
    const init = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'init');
    const alice = edge('ef9de27', '73e3abe', 'alice_add_phone');
    const bob = edge('ef9de27', '6656a6e', 'bob_add_avatar');
    const mergeAlice = edge('73e3abe', '3b2d98d', 'merge_alice');
    const mergeBob = edge('6656a6e', '3b2d98d', 'merge_bob');
    return [init, alice, bob, mergeAlice, mergeBob];
  }

  // Two node-skipping rollbacks whose back-lanes overlap, producing routed arcs
  // (`◂` landings, `──` bridges, `╮`/`╯` corners) and an arc crossing (`──`).
  function skipArcEdges(): readonly MigrationEdge[] {
    const init = edge(EMPTY_CONTRACT_HASH, 'aaaaaaa', 'init');
    const s1 = edge('aaaaaaa', 'bbbbbbb', 'step_1');
    const s2 = edge('bbbbbbb', 'ccccccc', 'step_2');
    const s3 = edge('ccccccc', 'ddddddd', 'step_3');
    const s4 = edge('ddddddd', 'eeeeeee', 'step_4');
    const rollbackEtoA = edge('eeeeeee', 'aaaaaaa', 'rollback_e_to_a');
    const rollbackDtoB = edge('ddddddd', 'bbbbbbb', 'rollback_d_to_b');
    return [init, s1, s2, s3, s4, rollbackEtoA, rollbackDtoB];
  }

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

  it('renders a single-lane linear graph monochrome (column 0 neutral)', () => {
    const colored = tree(linearEdges(), { colorize: true });
    // Nothing to tell column 0 apart from: no palette hue is emitted at all.
    for (const column of [1, 2, 3]) {
      expect(colored).not.toContain(laneColorForColumn(column)('│'));
      expect(colored).not.toContain(laneColorForColumn(column)('○'));
    }
    // The column-0 node marker renders without lane-color wrapping.
    expect(colored.split('\n')[0]).toMatch(/^○/);
  });

  it('rotates the palette over columns ≥ 1 while column 0 stays neutral', () => {
    const colored = tree(diamondEdges(), { colorize: true });
    // Column 1 lanes/corners take a palette hue; adjacent columns differ.
    expect(colored).toContain(laneColorForColumn(1)('│ '));
    expect(colored).toContain(laneColorForColumn(1)('╮'));
    expect(laneColorForColumn(1)('│')).not.toBe(laneColorForColumn(2)('│'));
    // A column-0 vertical pass-through (the surviving spine between the branch
    // and merge connectors) reads neutral — no palette hue on the bare lane.
    expect(colored).not.toContain(laneColorForColumn(1)('│↑'));
  });

  it('colors a startLane tee junction by its own column; the trailing dash by the served lane', () => {
    const colored = tree(diamondEdges(), { colorize: true });
    const lines = colored.split('\n');
    const branchLine = lines.find((line) => line.includes('╮'));
    expect(branchLine).toBeDefined();
    expect(branchLine).toContain(dim('├') + laneColorForColumn(1)('─'));
    expect(branchLine).toContain(laneColorForColumn(1)('╮'));
    expect(branchLine).not.toContain(laneColorForColumn(1)('├'));
    expect(stripAnsi(branchLine ?? '')).toBe('├─╮');
    const mergeLine = lines.find((line) => line.includes('╯') && line.includes('├'));
    expect(mergeLine).toBeDefined();
    expect(mergeLine).toContain(dim('├') + laneColorForColumn(1)('─'));
    expect(mergeLine).toContain(laneColorForColumn(1)('╯'));
    expect(mergeLine).not.toContain(laneColorForColumn(1)('├'));
    expect(stripAnsi(mergeLine ?? '')).toBe('├─╯');
  });

  it('colors a multi-lane fan-out run by the lane each elbow serves', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'init');
    const addPhone = edge('ef9de27', '73e3abe', 'add_phone');
    const addPosts = edge('ef9de27', 'a94b7b4', 'add_posts');
    const addAvatar = edge('ef9de27', '6656a6e', 'add_avatar');
    const mergePhone = edge('73e3abe', '3116048', 'merge_phone');
    const mergePosts = edge('a94b7b4', '3116048', 'merge_posts');
    const mergeAvatar = edge('6656a6e', '3116048', 'merge_avatar');
    const colored = tree(
      [init, addPhone, addPosts, addAvatar, mergePhone, mergePosts, mergeAvatar],
      { colorize: true },
    );
    // `├─┬─╮`: the leading `├` sits in column 0 (neutral); its `─` and the
    // closing corner take the lanes they lead into.
    const fanLine = colored.split('\n').find((line) => line.includes('┬'));
    expect(fanLine).toBeDefined();
    expect(fanLine).toContain(dim('├') + laneColorForColumn(1)('─'));
    expect(fanLine).toContain(laneColorForColumn(2)('╮'));
    expect(fanLine).not.toContain(laneColorForColumn(1)('├'));
  });

  it('rotates distinct hues across three lanes on a convergence fan', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'init');
    const addPhone = edge('ef9de27', '73e3abe', 'add_phone');
    const addPosts = edge('ef9de27', 'a94b7b4', 'add_posts');
    const addAvatar = edge('ef9de27', '6656a6e', 'add_avatar');
    const mergePhone = edge('73e3abe', '3116048', 'merge_phone');
    const mergePosts = edge('a94b7b4', '3116048', 'merge_posts');
    const mergeAvatar = edge('6656a6e', '3116048', 'merge_avatar');
    const colored = tree(
      [init, addPhone, addPosts, addAvatar, mergePhone, mergePosts, mergeAvatar],
      { colorize: true },
    );
    // Columns 1 and 2 take distinct rotating hues; column 0 stays neutral.
    const hues = [1, 2].map((column) => laneColorForColumn(column)('│ '));
    expect(new Set(hues).size).toBe(2);
    for (const hue of hues) {
      expect(colored).toContain(hue);
    }
  });

  it('preserves visible layout when colorize is true', () => {
    const edges = diamondEdges();
    const plain = tree(edges, { colorize: false });
    const colored = tree(edges, { colorize: true });
    expect(colored.split('\n').map(stripAnsi)).toEqual(plain.split('\n').map(stripAnsi));
  });

  it('colors the contract node glyph by its lane', () => {
    const colored = tree(diamondEdges(), { colorize: true });
    // A node sitting in column 1 takes its lane's hue.
    const branchNodeLine = colored
      .split('\n')
      .find((line) => line.includes('6656a6e') && !line.includes('→'));
    expect(branchNodeLine).toBeDefined();
    expect(branchNodeLine).toContain(laneColorForColumn(1)('○ '));
    // The column-0 node stays neutral (no palette wrapping).
    expect(colored.split('\n')[0]).toMatch(/^○/);
  });

  it('colors a branched edge arrow and bolds its name by the edge lane; column 0 stays default', () => {
    const colored = tree(diamondEdges(), { colorize: true });
    const lines = colored.split('\n');
    // A branched edge (column 1) reads in one branch colour: the arrow takes the
    // lane hue (not bold), and the name takes the lane hue AND keeps its bold.
    const branchEdge = lines.find((line) => line.includes('bob_add_avatar'));
    expect(branchEdge).toBeDefined();
    expect(branchEdge).toContain(laneColorForColumn(1)('↑'));
    expect(branchEdge).toContain(forcedBold(laneColorForColumn(1)('bob_add_avatar')));
    // A column-0 edge keeps the default arrow/name styling — no palette hue, so
    // a plain linear chain stays uncoloured.
    const linearEdge = lines.find((line) => line.includes('alice_add_phone'));
    expect(linearEdge).toBeDefined();
    expect(linearEdge).not.toContain(laneColorForColumn(1)('↑'));
    expect(linearEdge).not.toContain(laneColorForColumn(1)('alice_add_phone'));
    expect(stripAnsi(linearEdge ?? '')).toContain('alice_add_phone');
  });

  it('colors a `┬─` trailing dash by the branch on its right', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'init');
    const addPhone = edge('ef9de27', '73e3abe', 'add_phone');
    const addPosts = edge('ef9de27', 'a94b7b4', 'add_posts');
    const addAvatar = edge('ef9de27', '6656a6e', 'add_avatar');
    const mergePhone = edge('73e3abe', '3116048', 'merge_phone');
    const mergePosts = edge('a94b7b4', '3116048', 'merge_posts');
    const mergeAvatar = edge('6656a6e', '3116048', 'merge_avatar');
    const colored = tree(
      [init, addPhone, addPosts, addAvatar, mergePhone, mergePosts, mergeAvatar],
      { colorize: true },
    );
    // In `├─┬─╮`, the `┬` anchors its own lane (column 1) but its trailing `─`
    // leads into the branch on its right (column 2, toward the `╮`).
    const fanLine = colored.split('\n').find((line) => line.includes('┬'));
    expect(fanLine).toBeDefined();
    expect(fanLine).toContain(laneColorForColumn(1)('┬') + laneColorForColumn(2)('─'));
    // The dash is no longer tinted with the tee's own (left) lane.
    expect(fanLine).not.toContain(laneColorForColumn(1)('┬─'));
  });

  it('colors showcase connector junctions by their own column, not the served lane', () => {
    const colored = tree(showcaseEdges(), { colorize: true });
    const lines = colored.split('\n');
    const fanRow = lines.find((line) => line.includes('┼') && line.includes('┬'));
    expect(fanRow).toBeDefined();
    expect(fanRow).not.toContain(laneColorForColumn(2)('├'));
    expect(fanRow).toContain(laneColorForColumn(1)('─'));
    expect(fanRow).toContain(laneColorForColumn(1)('┼'));
    expect(fanRow).toContain(laneColorForColumn(2)('─'));
    expect(fanRow).toContain(laneColorForColumn(2)('┬'));
    expect(fanRow).not.toContain(laneColorForColumn(2)('┼'));
    expect(fanRow).not.toContain(laneColorForColumn(1)('┼─'));
    const bobMergeRow = lines.find((line) => {
      const plain = stripAnsi(line);
      return plain.includes('╯') && plain.includes('├') && !plain.includes('↑');
    });
    expect(bobMergeRow).toBeDefined();
    expect(bobMergeRow).toContain(laneColorForColumn(1)('├'));
    expect(bobMergeRow).not.toContain(laneColorForColumn(2)('├'));
    expect(bobMergeRow).toContain(laneColorForColumn(2)('─'));
    const fastForwardMergeRow = lines.find((line) => stripAnsi(line).startsWith('├─────╯'));
    expect(fastForwardMergeRow).toBeDefined();
    expect(fastForwardMergeRow).not.toContain(laneColorForColumn(3)('├'));
    expect(fastForwardMergeRow).toContain(laneColorForColumn(3)('─'));
    const addNameMergeRow = lines.find((line) => stripAnsi(line).startsWith('├─╯   '));
    expect(addNameMergeRow).toBeDefined();
    expect(addNameMergeRow).not.toContain(laneColorForColumn(1)('├'));
    expect(addNameMergeRow).toContain(laneColorForColumn(1)('─'));
  });

  // A 4-way forward fan (occupying lanes 0..3) plus three node-skipping
  // rollbacks converging on an early node. The back-lanes are pushed out to
  // columns 4/5/6, so the landing row reads `○◂──────┴─┴─╯`: a bridge run, two
  // converging landing tees, then the outermost corner.
  function convergingLandingEdges(): readonly MigrationEdge[] {
    return [
      edge(EMPTY_CONTRACT_HASH, 'n0', 'init'),
      edge('n0', 'n1', 'm1'),
      edge('n1', 'n2', 'm2'),
      edge('n2', 'n3', 'm3'),
      edge('n3', 'n4', 'm4'),
      edge('n4', 'n5', 'm5'),
      edge('n5', 'n6', 'm6'),
      edge('n6', 'n7', 'm7'),
      edge('n1', 'b1', 'fan_b1'),
      edge('n1', 'b2', 'fan_b2'),
      edge('n1', 'b3', 'fan_b3'),
      edge('b1', 'n6', 'merge_b1'),
      edge('b2', 'n6', 'merge_b2'),
      edge('b3', 'n6', 'merge_b3'),
      edge('n3', 'n1', 'rb_a'),
      edge('n4', 'n1', 'rb_c'),
      edge('n5', 'n1', 'rb_b'),
    ];
  }

  it('colors each converging-landing dash by the arc it leads into', () => {
    const colored = tree(convergingLandingEdges(), { colorize: true });
    const landing = colored.split('\n').find((line) => stripAnsi(line).startsWith('○◂──────┴─┴─╯'));
    expect(landing).toBeDefined();
    // Arcs converge in columns 4, 5, 6 (left → right). The bridge run leads into
    // the first arc; each tee's trailing dash leads into the NEXT arc out.
    expect(landing).toContain(laneColorForColumn(4)('◂'));
    expect(landing).toContain(laneColorForColumn(4)('──'));
    // First tee: `┴` keeps its own column (4); its trailing `─` leads into 5.
    expect(landing).toContain(laneColorForColumn(4)('┴') + laneColorForColumn(5)('─'));
    // Second tee: `┴` keeps its own column (5); its trailing `─` leads into 6.
    expect(landing).toContain(laneColorForColumn(5)('┴') + laneColorForColumn(6)('─'));
    // The corner keeps its own column hue.
    expect(landing).toContain(laneColorForColumn(6)('╯ '));
    // No tee's trailing dash wears its own (left) lane any more.
    expect(landing).not.toContain(laneColorForColumn(4)('┴─'));
    expect(landing).not.toContain(laneColorForColumn(5)('┴─'));
    // The bridge run no longer wears the outer corner's (col 6) hue.
    expect(landing).not.toContain(laneColorForColumn(6)('──'));
  });

  it('keeps a single (non-converging) back-arc landing one continuous hue', () => {
    const colored = tree(skipArcEdges(), { colorize: true });
    const landing = colored
      .split('\n')
      .find((line) => line.includes('bbbbbbb') && line.includes('◂'));
    expect(landing).toBeDefined();
    // The lone arc lands in column 2; with only the corner as an anchor, the
    // whole run — connector, bridges, and corner — reads as that one hue.
    expect(landing).toContain(laneColorForColumn(2)('◂'));
    expect(landing).toContain(laneColorForColumn(2)('──'));
    expect(landing).toContain(laneColorForColumn(2)('╯ '));
    expect(landing).not.toContain('┴');
  });

  it("colors a routed back-arc's whole horizontal run — bridges and crossings — one hue", () => {
    const colored = tree(skipArcEdges(), { colorize: true });
    const lines = colored.split('\n');
    // The outer back-arc (rollback_d_to_b) routes in column 2. Its source-tee
    // row crosses the inner arc's body and closes the corner; the crossing
    // bridge and the corner share the arc's own back-lane hue (column 2) — not
    // a per-column "rainbow".
    const teeLine = lines.find((line) => line.includes('ddddddd') && line.includes('╮'));
    expect(teeLine).toBeDefined();
    expect(teeLine).toContain(laneColorForColumn(2)('──'));
    expect(teeLine).toContain(laneColorForColumn(2)('╮ '));
    expect(teeLine).not.toContain(laneColorForColumn(1)('──'));
    expect(stripAnsi(teeLine ?? '')).toContain('───╮');
    // Landing row: the ◂ connector, crossing bridge, and ╯ corner share the
    // arc hue; the landing node ○ keeps its own (neutral column-0) lane.
    const landLine = lines.find((line) => line.includes('bbbbbbb') && line.includes('◂'));
    expect(landLine).toBeDefined();
    expect(landLine).toContain(laneColorForColumn(2)('◂'));
    expect(landLine).toContain(laneColorForColumn(2)('──'));
    expect(landLine).toContain(laneColorForColumn(2)('╯ '));
    expect(stripAnsi(landLine ?? '')).toContain('◂──╯');
  });
});

describe('resolveConnectorLaneColors', () => {
  it('colours arc-crossing dashes by the branch point immediately on their right', () => {
    const cells: readonly StructuralCell[] = [
      { kind: 'branch-tee' },
      { kind: 'arc-crossing' },
      { kind: 'branch-tee' },
      { kind: 'branch-corner' },
    ];
    const { glyph, dash } = resolveConnectorLaneColors(cells, 0);
    expect([...glyph]).toEqual([0, 1, 2, 3]);
    expect(dash[0]).toBe(1);
    expect(dash[1]).toBe(2);
    expect(dash[2]).toBe(3);
  });
});

describe('renderMigrationGraphLegend', () => {
  it('renders the unicode legend without color', () => {
    expect(renderMigrationGraphLegend({ colorize: false })).toMatchInlineSnapshot(`
      "Legend:
        ○ contract   ↑ forward   ↓ rollback
        ⟲ migration without schema change
        ✓ applied   ⧗ pending
        ∅ empty database (baseline)
        (refs) db / contract markers
        aaaaaa → bbbbbb   migration from contract aaaaaa to bbbbbb"
    `);
  });

  it('renders the ASCII legend without color', () => {
    expect(
      renderMigrationGraphLegend({ colorize: false, glyphMode: 'ascii' }),
    ).toMatchInlineSnapshot(`
      "Legend:
        * contract   ^ forward   v rollback
        @ migration without schema change
        + applied   > pending
        - empty database (baseline)
        (refs) db / contract markers
        aaaaaa -> bbbbbb   migration from contract aaaaaa to bbbbbb"
    `);
  });

  it('emits zero ANSI when colorize is off; content is unchanged by the colorize gate', () => {
    const plain = renderMigrationGraphLegend({ colorize: false });
    expect(plain).not.toContain('\u001b[');
    // The colorize gate only adds styling — the visible content is identical.
    expect(stripAnsi(renderMigrationGraphLegend({ colorize: true }))).toBe(plain);
  });

  it('drops the old lane sample, data-column, and "node" wording', () => {
    for (const colorize of [false, true]) {
      const text = stripAnsi(renderMigrationGraphLegend({ colorize }));
      expect(text).not.toContain('lanes');
      expect(text).not.toContain('contract node');
      expect(text).not.toContain('data column');
      expect(text).not.toContain('node overlay');
      expect(text).toContain('(refs) db / contract markers');
      expect(text).toContain('migration from contract aaaaaa to bbbbbb');
    }
  });

  it('honors the ASCII palette when color is on', () => {
    const colored = renderMigrationGraphLegend({ colorize: true, glyphMode: 'ascii' });
    expect(stripAnsi(colored)).toContain('* contract   ^ forward   v rollback');
    expect(stripAnsi(colored)).toContain('aaaaaa -> bbbbbb');
    expect(stripAnsi(colored)).not.toContain('lanes');
  });

  it('dims legend label prose when colorize is on, not the heading or glyphs', () => {
    const { dim } = createColors({ useColor: true });
    const colored = renderMigrationGraphLegend({ colorize: true });
    expect(colored.startsWith('Legend:')).toBe(true);
    const lines = colored.split('\n');
    expect(lines[0]).toBe('Legend:');
    expect(lines[0]).not.toContain('\u001b[2m');

    const firstContent = lines[1] ?? '';
    const forwardIdx = firstContent.indexOf('forward');
    expect(forwardIdx).toBeGreaterThan(-1);
    const dimForward = dim('forward');
    if (colored.includes(dimForward)) {
      expect(firstContent.indexOf(dimForward)).toBe(forwardIdx);
    } else {
      expect(stripAnsi(colored)).toBe(renderMigrationGraphLegend({ colorize: false }));
    }

    // The leading glyph markers (○, ↑, ↓, ⟲, ∅) stay bright like the other kind
    // glyphs — only the descriptive prose dims.
    expect(colored).not.toContain(`${dim('∅')}`);
  });
});

describe('renderMigrationGraphTree status overlay', () => {
  it('renders operation counts before status overlay labels', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'init');
    const annotations = new Map([
      [init.migrationHash, { operationCount: 3, status: 'applied' as const }],
    ]);
    const output = tree([init], {
      colorize: false,
      edgeAnnotationsByHash: annotations,
    });
    expect(output).toMatch(/3 ops\s+✓ applied/);
  });

  it('appends applied and pending labels on migration rows', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'init');
    const addPosts = edge('ef9de27', 'a94b7b4', 'add_posts');
    const annotations = new Map([
      [init.migrationHash, { status: 'applied' as const }],
      [addPosts.migrationHash, { status: 'pending' as const }],
    ]);
    const output = tree([init, addPosts], {
      colorize: false,
      edgeAnnotationsByHash: annotations,
    });
    expect(output).toContain('✓ applied');
    expect(output).toContain('⧗ pending');
  });

  it('uses ASCII overlay status markers when glyphMode is ascii', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'init');
    const addPosts = edge('ef9de27', 'a94b7b4', 'add_posts');
    const annotations = new Map([
      [init.migrationHash, { status: 'applied' as const }],
      [addPosts.migrationHash, { status: 'pending' as const }],
    ]);
    const output = treeAscii([init, addPosts], {
      colorize: false,
      edgeAnnotationsByHash: annotations,
    });
    expect(output).toContain('+ applied');
    expect(output).toContain('> pending');
    expect(output).not.toContain('✓');
    expect(output).not.toContain('⧗');
  });
});

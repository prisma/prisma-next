import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import type { MigrationEdge, MigrationGraph } from '@prisma-next/migration-tools/graph';
import { describe, expect, it } from 'vitest';
import { buildMigrationGraphLayout } from '../../../src/utils/formatters/migration-graph-layout';
import { buildMigrationGraphRows } from '../../../src/utils/formatters/migration-graph-rows';
import { renderMigrationGraphTree } from '../../../src/utils/formatters/migration-graph-tree-render';

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
        '│↑  init                 ∅ → ef9de27',
        '○   ∅',
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
        '│↑  init                 ∅ → ef9de27',
        '○   ∅',
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
        '│↑  init                 ∅ → ef9de27',
        '○   ∅',
      ].join('\n'),
    );
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
        '│↑  init                 ∅ → ef9de27',
        '○   ∅',
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
        '│↑  init                 ∅ → ef9de27',
        '○   ∅',
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
        '○─┼─╮     3ee5d20',
        '│ │ │↓    rollback_to_init    3ee5d20 → ef9de27',
        '│↑│ │     add_bio             73e3abe → 3ee5d20',
        '○◂╯ │     73e3abe',
        '│↑  │     add_phone           ef9de27 → 73e3abe',
        '○◂──╯     ef9de27',
        '│↑        init                ∅ → ef9de27',
        '○         ∅',
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
        '│↑  init                 ∅ → ef9de27',
        '○   ∅',
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
        '│↑  init                 ∅ → aaaaaaa',
        '○   ∅',
      ].join('\n'),
    );
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
      │↑  init                 ∅ → ef9de27
      ○   ∅"
    `);
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
      |^  init                 - -> ef9de27
      *   -"
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
      |^  init                 - -> ef9de27
      *   -"
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
      |^  init                 - -> ef9de27
      *   -"
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
      |^  init                 - -> ef9de27
      *   -"
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
      |^  init                 - -> ef9de27
      *   -"
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
      *-+-\\     3ee5d20
      | | |v    rollback_to_init    3ee5d20 -> ef9de27
      |^| |     add_bio             73e3abe -> 3ee5d20
      *</ |     73e3abe
      |^  |     add_phone           ef9de27 -> 73e3abe
      *<--/     ef9de27
      |^        init                - -> ef9de27
      *         -"
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
      |^  init                 - -> ef9de27
      *   -"
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
      |^  init                 - -> aaaaaaa
      *   -"
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
      |^  init                 - -> ef9de27
      *   -"
    `);
  });
});

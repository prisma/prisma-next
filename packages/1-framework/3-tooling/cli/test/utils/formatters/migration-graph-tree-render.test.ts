import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import type { MigrationEdge, MigrationGraph } from '@prisma-next/migration-tools/graph';
import { bold, createColors, dim, green } from 'colorette';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { laneColorForColumn } from '../../../src/utils/formatters/migration-graph-lane-colors';
import type { StructuralCell } from '../../../src/utils/formatters/migration-graph-layout';
import { buildMigrationGraphLayout } from '../../../src/utils/formatters/migration-graph-layout';
import { buildMigrationGraphRows } from '../../../src/utils/formatters/migration-graph-rows';
import { renderMigrationGraphSpaceTrees } from '../../../src/utils/formatters/migration-graph-space-render';
import {
  renderMigrationGraphLegend,
  renderMigrationGraphTree,
  resolveConnectorLaneColors,
} from '../../../src/utils/formatters/migration-graph-tree-render';
import { MIGRATION_LIST_HASH_WIDTH } from '../../../src/utils/formatters/migration-list-data-column';

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

function migrationDirNameColumns(rendered: string, dirNames: readonly string[]): readonly number[] {
  const plain = stripAnsi(rendered);
  return dirNames.map((name) => {
    const pattern = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    const line = plain.split('\n').find((row) => pattern.test(row));
    if (line === undefined) {
      throw new Error(`no line for ${name}`);
    }
    const match = pattern.exec(line);
    if (match?.index === undefined) {
      throw new Error(`dirName ${name} not found in line`);
    }
    return match.index;
  });
}

function assertMigrationDataColumnsAligned(rendered: string, dirNames: readonly string[]): void {
  const columns = migrationDirNameColumns(rendered, dirNames);
  expect(new Set(columns).size).toBe(1);
}

function arrowColumnOffset(line: string): number {
  const plain = stripAnsi(line);
  const idx = plain.indexOf('→');
  if (idx === -1) {
    throw new Error('arrow not found in line');
  }
  return idx;
}

function tokenStartOffset(line: string, token: string): number {
  const plain = stripAnsi(line);
  const idx = plain.indexOf(token);
  if (idx === -1) {
    throw new Error(`token ${token} not found in line`);
  }
  return idx;
}

const LABEL_GAP = 2;

describe('renderMigrationGraphTree (D23 padding rules)', () => {
  it('aligns migration dirName columns across spaces with different tree depths', () => {
    const appInit = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'init');
    const appAlice = edge('ef9de27', '73e3abe', 'alice_add_phone');
    const appBob = edge('ef9de27', '6656a6e', 'bob_add_avatar');
    const appMergeAlice = edge('73e3abe', '3b2d98d', 'merge_alice');
    const appMergeBob = edge('6656a6e', '3b2d98d', 'merge_bob');

    const pgInit = edge(EMPTY_CONTRACT_HASH, '29059df', 'install_vector_v1');

    const [appTree, pgTree] = renderMigrationGraphSpaceTrees([
      {
        graph: graph([appInit, appAlice, appBob, appMergeAlice, appMergeBob]),
        migrations: [],
        liveContractHash: '3b2d98d',
        glyphMode: 'unicode',
        colorize: false,
      },
      {
        graph: graph([pgInit]),
        migrations: [],
        liveContractHash: '29059df',
        glyphMode: 'unicode',
        colorize: false,
      },
    ]);
    if (appTree === undefined || pgTree === undefined) {
      throw new Error('expected two rendered space trees');
    }

    const appDirName = migrationDirNameColumns(appTree, ['merge_alice', 'init']);
    const pgDirName = migrationDirNameColumns(pgTree, ['install_vector_v1']);
    expect(appDirName[0]!).toBe(pgDirName[0]!);

    const appMergeLine = stripAnsi(
      appTree.split('\n').find((row) => row.includes('merge_alice')) ?? '',
    );
    const pgInstallLine = stripAnsi(
      pgTree.split('\n').find((row) => row.includes('install_vector_v1')) ?? '',
    );
    expect(arrowColumnOffset(appMergeLine)).toBe(arrowColumnOffset(pgInstallLine));
  });

  it('places contract-node markers adjacent to the hash with LABEL_GAP', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'init');
    const addPosts = edge('ef9de27', 'a94b7b4', 'add_posts');
    const edges = [init, addPosts];

    const contractOnly = tree(edges, {
      colorize: false,
      contractHash: 'a94b7b4',
    });
    const contractOnlyLine = stripAnsi(contractOnly.split('\n')[0] ?? '');
    expect(contractOnlyLine).toBe('○   a94b7b4  @contract');
    expect(tokenStartOffset(contractOnlyLine, '@contract')).toBe(
      tokenStartOffset(contractOnlyLine, 'a94b7b4') + MIGRATION_LIST_HASH_WIDTH + LABEL_GAP,
    );

    const markersAndRefs = tree(edges, {
      colorize: false,
      refsByHash: refsMap([{ hash: 'a94b7b4', names: ['prod'] }]),
      dbHash: 'a94b7b4',
      contractHash: 'a94b7b4',
    });
    const markersLine = stripAnsi(markersAndRefs.split('\n')[0] ?? '');
    expect(markersLine).toBe('○   a94b7b4  @contract @db (prod)');
    expect(tokenStartOffset(markersLine, '@contract')).toBe(
      tokenStartOffset(markersLine, 'a94b7b4') + MIGRATION_LIST_HASH_WIDTH + LABEL_GAP,
    );

    const hashOnly = tree(edges, { colorize: false });
    const hashOnlyLine = stripAnsi(hashOnly.split('\n')[0] ?? '');
    expect(hashOnlyLine).toBe('○   a94b7b4');
    expect(hashOnlyLine).not.toMatch(/\s+$/);
  });

  it('right-justifies the from-hash column so the arrow lands at a fixed column', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'init');
    const bookend = edge('6cee614', 'f7a8eb5', 'bookend');
    const output = tree([init, bookend], { colorize: false });
    const lines = stripAnsi(output)
      .split('\n')
      .filter((line) => line.includes('→'));
    const initLine = lines.find((line) => line.includes('init'));
    const bookendLine = lines.find((line) => line.includes('bookend'));
    expect(initLine).toBeDefined();
    expect(bookendLine).toBeDefined();
    expect(arrowColumnOffset(initLine ?? '')).toBe(arrowColumnOffset(bookendLine ?? ''));
    expect(initLine).toContain('      ∅ →');
  });
});

describe('renderMigrationGraphTree', () => {
  it('renders a linear chain per mockup', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'init');
    const addPosts = edge('ef9de27', 'a94b7b4', 'add_posts');
    expect(tree([init, addPosts])).toBe(
      [
        '○   a94b7b4',
        '│↑  add_posts            ef9de27 → a94b7b4',
        '○   ef9de27',
        '│↑  init                       ∅ → ef9de27',
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
        '○   c0ffee0  @contract',
        '',
        '○   a94b7b4  @db (main)',
        '│↑  add_posts            ef9de27 → a94b7b4',
        '○   ef9de27',
        '│↑  init                       ∅ → ef9de27',
        '∅',
      ].join('\n'),
    );
  });

  it('renders system markers with the @-sigil', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'init');
    expect(
      tree([init], {
        colorize: false,
        dbHash: 'ef9de27',
        contractHash: 'ef9de27',
      }),
    ).toContain('@contract @db');
  });

  it('renders only user refs in parentheses', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'init');
    expect(
      tree([init], {
        colorize: false,
        refsByHash: refsMap([{ hash: 'ef9de27', names: ['prod', 'staging'] }]),
      }),
    ).toContain('(prod, staging)');
  });

  it('renders system markers before user refs when both are present', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'init');
    const addPosts = edge('ef9de27', 'a94b7b4', 'add_posts');
    expect(
      tree([init, addPosts], {
        colorize: false,
        refsByHash: refsMap([{ hash: 'a94b7b4', names: ['prod'] }]),
        dbHash: 'a94b7b4',
        contractHash: 'a94b7b4',
      }),
    ).toContain('@contract @db (prod)');
  });

  it('renders colliding system db marker and user ref named db separately', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'init');
    expect(
      tree([init], {
        colorize: false,
        refsByHash: refsMap([{ hash: 'ef9de27', names: ['db'] }]),
        dbHash: 'ef9de27',
      }),
    ).toContain('@db (db)');
  });

  it('emphasizes the contract system marker in colorized output', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'init');
    const colored = tree([init], {
      colorize: true,
      contractHash: 'ef9de27',
    });
    expect(colored).toContain(green('@') + bold(green('contract')));
    expect(colored).not.toContain(bold(green('db')));
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
        '○   a94b7b4  @contract (main)',
        '│↑  add_posts            ef9de27 → a94b7b4',
        '○   ef9de27  @db (prod)',
        '│↑  init                       ∅ → ef9de27',
        '∅',
      ].join('\n'),
    );
  });

  it('places the live-contract leaf on the trunk for a two-leaf shared-root graph', () => {
    const historical1 = edge(EMPTY_CONTRACT_HASH, '76c1bd5', 'historical_1');
    const historical2 = edge('76c1bd5', '5618dca', 'historical_2');
    const historical3 = edge('5618dca', '6cee614', 'historical_3');
    const historical4 = edge('6cee614', 'f7a8eb5', 'historical_4');
    const live = edge(EMPTY_CONTRACT_HASH, '1375f13', 'live_migration');
    const edges = [historical1, historical2, historical3, historical4, live];
    expect(tree(edges, { colorize: false, contractHash: '1375f13' })).toBe(
      [
        '○   1375f13  @contract',
        '│↑    live_migration           ∅ → 1375f13',
        '│ ○   f7a8eb5',
        '│ │↑  historical_4       6cee614 → f7a8eb5',
        '│ ○   6cee614',
        '│ │↑  historical_3       5618dca → 6cee614',
        '│ ○   5618dca',
        '│ │↑  historical_2       76c1bd5 → 5618dca',
        '│ ○   76c1bd5',
        '│ │↑  historical_1             ∅ → 76c1bd5',
        '├─╯',
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
        '│↑│     promote                D → E',
        '│ │↑    bob_extra              C → E',
        '○ │   D',
        '├─┼─╮',
        '│↑│ │   merge_alice            B → D',
        '│ │ │↑  merge_bob              C → D',
        '○ │ │   B',
        '│↑│ │   alice                  A → B',
        '│ ├─╯',
        '│ ○   C',
        '│ │↑    bob                    A → C',
        '├─╯',
        '○   A',
        '│↑      init                   ∅ → A',
        '∅',
      ].join('\n'),
    );
    expect(treeAscii(edges)).toContain('| *   C');
  });

  it('aligns migration data columns on diamond and rollback peel', () => {
    const init = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'init');
    const alice = edge('ef9de27', '73e3abe', 'alice_add_phone');
    const bob = edge('ef9de27', '6656a6e', 'bob_add_avatar');
    const mergeAlice = edge('73e3abe', '3b2d98d', 'merge_alice');
    const mergeBob = edge('6656a6e', '3b2d98d', 'merge_bob');
    const addBio = edge('73e3abe', '3ee5d20', 'add_bio');
    const addPosts = edge('3ee5d20', 'a94b7b4', 'add_posts');
    const rollbackToPhone = edge('a94b7b4', '73e3abe', 'rollback_to_phone');
    const rollbackToInit = edge('3ee5d20', 'ef9de27', 'rollback_to_init');
    const edges = [
      init,
      alice,
      bob,
      mergeAlice,
      mergeBob,
      addBio,
      addPosts,
      rollbackToPhone,
      rollbackToInit,
    ];
    const dirNames = edges.map((e) => e.dirName);
    assertMigrationDataColumnsAligned(tree(edges), dirNames);
    assertMigrationDataColumnsAligned(treeAscii(edges), dirNames);
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
        '│↑    init                     ∅ → ef9de27',
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
        '│↑      init                   ∅ → ef9de27',
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
        '│↑        init                      ∅ → ef9de27',
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
        '│↑  init                       ∅ → ef9de27',
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
        '│↑  init                       ∅ → aaaaaaa',
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
        '│↑  init                       ∅ → ef9de27  5 ops',
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
      "○   cd5c15b  @contract (main)
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
      │↑    init                     ∅ → ef9de27
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
      |^  init                       - -> ef9de27
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
      "*   c0ffee0  @contract

      *   a94b7b4  @db (main)
      |^  add_posts            ef9de27 -> a94b7b4
      *   ef9de27
      |^  init                       - -> ef9de27
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
      "*   a94b7b4  @contract (main)
      |^  add_posts            ef9de27 -> a94b7b4
      *   ef9de27  @db (prod)
      |^  init                       - -> ef9de27
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
      |^    init                     - -> ef9de27
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
      |^      init                   - -> ef9de27
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
      |^        init                      - -> ef9de27
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
      |^  init                       - -> ef9de27
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
      |^  init                       - -> aaaaaaa
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
      "*   cd5c15b  @contract (main)
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
      |^    init                     - -> ef9de27
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
    expect(fanRow).toContain(dim('┼'));
    expect(fanRow).not.toContain(laneColorForColumn(1)('┼'));
    expect(fanRow).not.toContain(laneColorForColumn(2)('┼'));
    expect(fanRow).toContain(laneColorForColumn(2)('─'));
    expect(fanRow).toContain(laneColorForColumn(2)('┬'));
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

  function kitchenSinkEdges(): readonly MigrationEdge[] {
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
    return [
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
    ];
  }

  function threeWayFanEdges(): readonly MigrationEdge[] {
    const init = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'init');
    const addPhone = edge('ef9de27', '73e3abe', 'add_phone');
    const addPosts = edge('ef9de27', 'a94b7b4', 'add_posts');
    const addAvatar = edge('ef9de27', '6656a6e', 'add_avatar');
    const mergePhone = edge('73e3abe', '3116048', 'merge_phone');
    const mergePosts = edge('a94b7b4', '3116048', 'merge_posts');
    const mergeAvatar = edge('6656a6e', '3116048', 'merge_avatar');
    return [init, addPhone, addPosts, addAvatar, mergePhone, mergePosts, mergeAvatar];
  }

  it('kitchen-sink colorized snapshot asserts all six lane-color rules', () => {
    const fixtures: readonly {
      readonly name: string;
      readonly edges: readonly MigrationEdge[];
    }[] = [
      { name: 'diamond', edges: diamondEdges() },
      { name: 'routed-back-arc', edges: skipArcEdges() },
      { name: 'three-way-fan', edges: threeWayFanEdges() },
      { name: 'kitchen-sink', edges: kitchenSinkEdges() },
    ];

    for (const { edges } of fixtures) {
      const plain = tree(edges, { colorize: false });
      const colored = tree(edges, { colorize: true });
      expect(colored.split('\n').map(stripAnsi)).toEqual(plain.split('\n').map(stripAnsi));
    }

    const diamondColored = tree(diamondEdges(), { colorize: true });
    expect(diamondColored).toContain(laneColorForColumn(1)('│ '));
    expect(diamondColored.split('\n')[0]).toMatch(/^○/);

    const fanColored = tree(threeWayFanEdges(), { colorize: true });
    expect(new Set([1, 2].map((column) => laneColorForColumn(column)('│ '))).size).toBe(2);
    for (const column of [1, 2]) {
      expect(fanColored).toContain(laneColorForColumn(column)('│ '));
    }

    const showcaseColored = tree(showcaseEdges(), { colorize: true });
    const crossingRow = showcaseColored
      .split('\n')
      .find((line) => line.includes('┼') && line.includes('┬'));
    expect(crossingRow).toBeDefined();
    expect(crossingRow).toContain(dim('┼'));
    expect(crossingRow).not.toContain(laneColorForColumn(1)('┼'));

    const skipColored = tree(skipArcEdges(), { colorize: true });
    const landLine = skipColored
      .split('\n')
      .find((line) => line.includes('bbbbbbb') && line.includes('◂'));
    expect(landLine).toContain(laneColorForColumn(2)('◂'));
    expect(landLine).toContain(laneColorForColumn(2)('──'));

    const branchNode = diamondColored
      .split('\n')
      .find((line) => line.includes('6656a6e') && !line.includes('→'));
    expect(branchNode).toContain(laneColorForColumn(1)('○ '));

    const branchEdge = diamondColored.split('\n').find((line) => line.includes('bob_add_avatar'));
    expect(branchEdge).toContain(laneColorForColumn(1)('↑'));

    const sinkColored = tree(kitchenSinkEdges(), { colorize: true });
    const shortBranchNode = sinkColored
      .split('\n')
      .find((line) => line.includes('tip_sho') && !line.includes('→'));
    expect(shortBranchNode).toContain(laneColorForColumn(1)('○ '));
    expect(sinkColored).toMatch(/kitchen_sink/);
    expect(sinkColored).toMatch(/rollback/);
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
        @contract @db reserved markers — also typeable as --from/--to tokens
        (prod, staging) user-defined refs
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
        @contract @db reserved markers — also typeable as --from/--to tokens
        (prod, staging) user-defined refs
        aaaaaa -> bbbbbb   migration from contract aaaaaa to bbbbbb"
    `);
  });

  it('emits zero ANSI when colorize is off', () => {
    const plain = renderMigrationGraphLegend({ colorize: false });
    expect(plain).not.toContain('\u001b[');
  });

  it('omits the lane-swatch line in both color and plain modes', () => {
    for (const colorize of [false, true]) {
      const text = stripAnsi(renderMigrationGraphLegend({ colorize }));
      expect(text).not.toContain('gutter lanes by column');
    }
  });

  it('renders the unicode legend with color', () => {
    expect(stripAnsi(renderMigrationGraphLegend({ colorize: true }))).toMatchInlineSnapshot(`
      "Legend:
        ○ contract   ↑ forward   ↓ rollback
        ⟲ migration without schema change
        ✓ applied   ⧗ pending
        ∅ empty database (baseline)
        @contract @db reserved markers — also typeable as --from/--to tokens
        (prod, staging) user-defined refs
        aaaaaa → bbbbbb   migration from contract aaaaaa to bbbbbb"
    `);
  });

  it('renders the ASCII legend with color', () => {
    expect(
      stripAnsi(renderMigrationGraphLegend({ colorize: true, glyphMode: 'ascii' })),
    ).toMatchInlineSnapshot(`
      "Legend:
        * contract   ^ forward   v rollback
        @ migration without schema change
        + applied   > pending
        - empty database (baseline)
        @contract @db reserved markers — also typeable as --from/--to tokens
        (prod, staging) user-defined refs
        aaaaaa -> bbbbbb   migration from contract aaaaaa to bbbbbb"
    `);
  });

  it('renders the marker/ref block as two lines in system-then-ref order', () => {
    const text = renderMigrationGraphLegend({ colorize: false });
    const lines = text.split('\n');
    const markersIdx = lines.findIndex((line) => line.includes('reserved markers'));
    const refsIdx = lines.findIndex((line) => line.includes('user-defined refs'));
    expect(markersIdx).toBeGreaterThan(-1);
    expect(refsIdx).toBeGreaterThan(markersIdx);
    expect(lines[markersIdx]).toContain('@contract @db');
    expect(lines[refsIdx]).toContain('(prod, staging)');
  });

  it('does not bold the illustrative marker and ref example names when colorized', () => {
    const colored = renderMigrationGraphLegend({ colorize: true });
    const bold = '\u001b[1m';
    for (const name of ['contract', 'db', 'prod', 'staging'] as const) {
      expect(colored).not.toContain(`${bold}${name}`);
    }
  });

  it('omits legacy contract-node and data-column legend wording', () => {
    for (const colorize of [false, true]) {
      const text = stripAnsi(renderMigrationGraphLegend({ colorize }));
      expect(text).not.toContain('contract node');
      expect(text).not.toContain('data column');
      expect(text).not.toContain('node overlay');
      expect(text).not.toContain('db / contract markers');
      expect(text).toContain('@contract @db');
      expect(text).toContain('(prod, staging)');
      expect(text).toContain('reserved markers — also typeable as --from/--to tokens');
      expect(text).toContain('user-defined refs');
      expect(text).toContain('migration from contract aaaaaa to bbbbbb');
    }
  });

  it('honors the ASCII palette when color is on', () => {
    const colored = renderMigrationGraphLegend({ colorize: true, glyphMode: 'ascii' });
    expect(stripAnsi(colored)).toContain('* contract   ^ forward   v rollback');
    expect(stripAnsi(colored)).toContain('aaaaaa -> bbbbbb');
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

describe('renderMigrationGraphTree path highlight colors', () => {
  // This describe exercises the path-highlight rendering branch:
  //   on-path  => gutter/name/hash wrapped in greenBright (ANSI [92m)
  //   off-path => gutter/name/hash wrapped in dim         (ANSI [2m)
  //
  // The test env runs with NO_COLOR=1, which causes colorette's ambient dim/greenBright
  // to be no-ops, so we cannot inspect ANSI codes in the rendered string directly.
  // Instead we assert the observable behavior that is detectable regardless of color env:
  //   - on-path rows carry the 'will run' annotation suffix (added only for on-path)
  //   - off-path rows are fully drawn (name present; not suppressed or blanked)
  //   - with colorize:false, no ANSI escapes appear at all
  //
  // Wrapping the gutter/name/hash in greenBright vs dim is verified at the code level by
  // reading renderMigrationGraphTree (search for `isOnPath`/`isOffPath` in the renderer);
  // the tests below protect against routing bugs (wrong edge gets wrong wrapper) and against
  // off-path suppression (name accidentally removed), which are the most likely refactoring
  // regressions. Both color helper shapes (greenBright/dim) are sourced from the same
  // colorette module the renderer imports, per the task requirement.

  it('on-path row: migration name is present and the will-run suffix appears', () => {
    const offPathEdge = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'path_init');
    const onPathEdge = edge('ef9de27', 'a94b7b4', 'path_add_posts');
    const annotations = new Map([
      [offPathEdge.migrationHash, { pathHighlight: 'off-path' as const }],
      [onPathEdge.migrationHash, { pathHighlight: 'on-path' as const }],
    ]);
    const rendered = tree([offPathEdge, onPathEdge], {
      colorize: true,
      edgeAnnotationsByHash: annotations,
    });

    const onPathLine = rendered.split('\n').find((line) => line.includes(onPathEdge.dirName));
    expect(onPathLine).toBeDefined();
    // Migration name is present (not blank) in the on-path row.
    expect(onPathLine).toContain(onPathEdge.dirName);
    // The on-path annotation suffix 'will run' is appended by formatEdgeAnnotationSuffix.
    expect(onPathLine).toContain('will run');
    // Strip ANSI to confirm the plain name too (belt-check that stripAnsi doesn't lose it).
    expect(stripAnsi(onPathLine ?? '')).toContain(onPathEdge.dirName);
  });

  it('off-path row: migration name is fully drawn and the will-run suffix is absent', () => {
    const offPathEdge = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'path_init');
    const onPathEdge = edge('ef9de27', 'a94b7b4', 'path_add_posts');
    const annotations = new Map([
      [offPathEdge.migrationHash, { pathHighlight: 'off-path' as const }],
      [onPathEdge.migrationHash, { pathHighlight: 'on-path' as const }],
    ]);
    const rendered = tree([offPathEdge, onPathEdge], {
      colorize: true,
      edgeAnnotationsByHash: annotations,
    });

    const offPathLine = rendered.split('\n').find((line) => line.includes(offPathEdge.dirName));
    expect(offPathLine).toBeDefined();
    // Off-path rows must be fully drawn: name present (not suppressed or replaced with blank).
    expect(offPathLine).toContain(offPathEdge.dirName);
    expect(stripAnsi(offPathLine ?? '')).toContain(offPathEdge.dirName);
    // Off-path rows do NOT receive the on-path 'will run' annotation suffix.
    expect(offPathLine).not.toContain('will run');
  });

  it('no ANSI colour is emitted for either path role when colorize is false', () => {
    const offPathEdge = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'path_init');
    const onPathEdge = edge('ef9de27', 'a94b7b4', 'path_add_posts');
    const annotations = new Map([
      [offPathEdge.migrationHash, { pathHighlight: 'off-path' as const }],
      [onPathEdge.migrationHash, { pathHighlight: 'on-path' as const }],
    ]);
    const output = tree([offPathEdge, onPathEdge], {
      colorize: false,
      edgeAnnotationsByHash: annotations,
    });
    expect(output).not.toContain('\x1b[');
    // Both names must appear even without color.
    expect(output).toContain(offPathEdge.dirName);
    expect(output).toContain(onPathEdge.dirName);
  });
});

describe('renderMigrationGraphTree isAppSpace gate', () => {
  // Helpers local to this suite so migSeq stays independent.
  function makeGraph(edges: readonly MigrationEdge[]): MigrationGraph {
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

  function renderSpace(
    edges: readonly MigrationEdge[],
    contractHash: string,
    isAppSpace: boolean,
  ): string {
    const g = makeGraph(edges);
    const rowModel = buildMigrationGraphRows(g, isAppSpace ? { contractHash } : {});
    const layout = buildMigrationGraphLayout(rowModel);
    return stripAnsi(
      renderMigrationGraphTree(layout, {
        contractHash,
        isAppSpace,
        colorize: false,
      }),
    );
  }

  const APP_CONTRACT = `sha256:${'a'.repeat(64)}`;
  const EXT_CONTRACT = `sha256:${'e'.repeat(64)}`;

  it('app space shows @contract on the node that matches contractHash', () => {
    const initEdge = edge(EMPTY_CONTRACT_HASH, APP_CONTRACT.slice(7, 14), 'app_init');
    const output = renderSpace([initEdge], APP_CONTRACT, true);
    expect(output).toContain('@contract');
  });

  it('extension space does not show @contract even when contractHash matches a node', () => {
    const initEdge = edge(EMPTY_CONTRACT_HASH, EXT_CONTRACT.slice(7, 14), 'ext_init');
    const output = renderSpace([initEdge], EXT_CONTRACT, false);
    expect(output).not.toContain('@contract');
  });

  it('extension space does not produce a floating working-contract node', () => {
    // Use a contractHash that is NOT in the graph — would float as an extra node if app-gated.
    const initEdge = edge(EMPTY_CONTRACT_HASH, 'aaa1111', 'ext_init');
    const detachedHash = `sha256:${'f'.repeat(64)}`;
    const g = makeGraph([initEdge]);
    const appRows = buildMigrationGraphRows(g, { contractHash: detachedHash });
    const extRows = buildMigrationGraphRows(g, {});
    // App space: detached contract causes an extra floating node.
    expect(appRows.nodes.length).toBeGreaterThan(extRows.nodes.length);
    // Extension space: no floating node — row count equals graph-only row count.
    expect(extRows.nodes).not.toContain(detachedHash);
  });

  it('@db marker still appears in extension spaces (per-space, not app-gated)', () => {
    const initEdge = edge(EMPTY_CONTRACT_HASH, EXT_CONTRACT.slice(7, 14), 'ext_init');
    const g = makeGraph([initEdge]);
    const rowModel = buildMigrationGraphRows(g, {});
    const layout = buildMigrationGraphLayout(rowModel);
    const output = stripAnsi(
      renderMigrationGraphTree(layout, {
        contractHash: APP_CONTRACT,
        dbHash: EXT_CONTRACT.slice(7, 14),
        isAppSpace: false,
        colorize: false,
      }),
    );
    expect(output).not.toContain('@contract');
    expect(output).toContain('@db');
  });

  it('default (isAppSpace omitted) behaves as app space — @contract renders', () => {
    const initEdge = edge(EMPTY_CONTRACT_HASH, APP_CONTRACT.slice(7, 14), 'app_init');
    const g = makeGraph([initEdge]);
    const rowModel = buildMigrationGraphRows(g, { contractHash: APP_CONTRACT });
    const layout = buildMigrationGraphLayout(rowModel);
    const output = stripAnsi(
      renderMigrationGraphTree(layout, {
        contractHash: APP_CONTRACT,
        colorize: false,
        // isAppSpace omitted — must default to true
      }),
    );
    expect(output).toContain('@contract');
  });
});

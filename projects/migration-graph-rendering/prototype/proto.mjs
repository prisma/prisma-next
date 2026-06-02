#!/usr/bin/env node
// Throwaway prototyping harness for the tier-3 `migration graph` redesign.
//
// Loads every fixture under examples/prisma-next-demo/migration-fixtures,
// extracts its topology (contracts = nodes, migrations = edges), classifies
// edge kinds, runs a pluggable `render(graph)` and writes one gallery file
// with every case rendered side by side.
//
// Run from the repo root:
//   node projects/migration-graph-rendering/prototype/proto.mjs
//
// Design loop:  edit render()  ->  re-run  ->
// open projects/migration-graph-rendering/prototype/gallery.md  ->  react  ->  repeat.
//
// Not production code. The real renderer will consume the consolidated
// tolerant model (TML-2739); here we recompute topology in plain JS so the
// loop stays zero-build.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES = 'examples/prisma-next-demo/migration-fixtures';
const EMPTY = '∅';

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

/** @typedef {{ dirName: string, from: string, to: string }} Edge */
/** @typedef {{ name: string, edges: Edge[], nodes: string[], short: (h:string)=>string, refs: Record<string,string> }} Graph */

function loadFixture(name) {
  const appDir = join(FIXTURES, name, 'app');
  const migDirs = readdirSync(appDir)
    .filter((d) => statSync(join(appDir, d)).isDirectory())
    .sort(); // dirName ascending; we sort per-view as needed
  /** @type {Edge[]} */
  const edges = [];
  for (const dirName of migDirs) {
    const m = JSON.parse(readFileSync(join(appDir, dirName, 'migration.json'), 'utf8'));
    edges.push({ dirName, from: m.from ?? EMPTY, to: m.to });
  }
  // refs (optional)
  /** @type {Record<string,string>} */
  const refs = {};
  try {
    const refsDir = join(FIXTURES, name, 'refs');
    for (const f of readdirSync(refsDir)) {
      if (!f.endsWith('.json')) continue;
      const r = JSON.parse(readFileSync(join(refsDir, f), 'utf8'));
      refs[f.replace(/\.json$/, '')] = r.hash;
    }
  } catch {
    /* no refs */
  }

  const nodeSet = new Set();
  for (const e of edges) {
    nodeSet.add(e.from);
    nodeSet.add(e.to);
  }
  const nodes = [...nodeSet];

  // stable short labels per fixture
  const shortMap = new Map();
  for (const h of nodes) {
    shortMap.set(h, h === EMPTY ? EMPTY : h.replace(/^sha256:/, '').slice(0, 7));
  }
  const short = (h) => shortMap.get(h) ?? h.replace(/^sha256:/, '').slice(0, 7);

  return { name, edges, nodes, short, refs };
}

// ---------------------------------------------------------------------------
// Topology: classify edge kinds (forward / back / self) via 3-colour DFS.
// Neighbour order pinned to dirName-descending for determinism.
// Seed from forward-in-degree-0 roots (∅ first, then lexicographic), then any
// unvisited remainder lexicographically (covers pure cycles / multi-root).
// ---------------------------------------------------------------------------

function classify(graph) {
  const { edges, nodes } = graph;
  /** @type {Map<string, Edge[]>} */
  const out = new Map();
  for (const n of nodes) out.set(n, []);
  for (const e of edges) out.get(e.from).push(e);
  for (const list of out.values()) list.sort((a, b) => (a.dirName < b.dirName ? 1 : -1)); // dirName desc

  /** @type {Map<string,'fwd'|'back'|'self'>} */
  const kind = new Map();
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const color = new Map(nodes.map((n) => [n, WHITE]));

  const indeg = new Map(nodes.map((n) => [n, 0]));
  for (const e of edges) if (e.from !== e.to) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  const roots = nodes.filter((n) => (indeg.get(n) ?? 0) === 0);
  roots.sort((a, b) => (a === EMPTY ? -1 : b === EMPTY ? 1 : a < b ? -1 : 1));
  const seeds = [...roots, ...nodes.filter((n) => !roots.includes(n)).sort()];

  function dfs(u) {
    color.set(u, GREY);
    for (const e of out.get(u)) {
      if (e.from === e.to) {
        kind.set(e.dirName, 'self');
        continue;
      }
      const c = color.get(e.to);
      if (c === GREY) kind.set(e.dirName, 'back');
      else {
        if (!kind.has(e.dirName)) kind.set(e.dirName, 'fwd');
        if (c === WHITE) dfs(e.to);
      }
    }
    color.set(u, BLACK);
  }
  for (const s of seeds) if (color.get(s) === WHITE) dfs(s);
  for (const e of edges) if (!kind.has(e.dirName)) kind.set(e.dirName, 'fwd');

  return kind;
}

// ---------------------------------------------------------------------------
// render(graph, kind)  <-- THE THING WE ITERATE ON
//
// v0 strawman: just a normalized edge list + degree summary. Replace the body
// with candidate node-per-row lane layouts as the design converges.
// ---------------------------------------------------------------------------

function render(graph, kind) {
  const { edges, nodes, short } = graph;
  const tag = { fwd: ' ', back: '↩', self: '⟲' };

  const indeg = new Map(nodes.map((n) => [n, 0]));
  const outdeg = new Map(nodes.map((n) => [n, 0]));
  for (const e of edges) {
    if (kind.get(e.dirName) !== 'fwd') continue;
    outdeg.set(e.from, (outdeg.get(e.from) ?? 0) + 1);
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  }
  const roots = nodes.filter((n) => (indeg.get(n) ?? 0) === 0);
  const tips = nodes.filter((n) => (outdeg.get(n) ?? 0) === 0);
  const conv = nodes.filter((n) => (indeg.get(n) ?? 0) >= 2);
  const div = nodes.filter((n) => (outdeg.get(n) ?? 0) >= 2);

  const lines = [];
  // edges newest-first (dirName desc) — the language we talk in
  for (const e of [...edges].sort((a, b) => (a.dirName < b.dirName ? 1 : -1))) {
    const k = kind.get(e.dirName);
    lines.push(`  ${tag[k]} ${e.dirName.padEnd(34)} ${short(e.from).padStart(7)} → ${short(e.to)}`);
  }
  const meta =
    `  roots: ${roots.map(short).join(', ') || '—'}` +
    `   tips: ${tips.map(short).join(', ') || '—'}` +
    `   conv: ${conv.map(short).join(', ') || '—'}` +
    `   div: ${div.map(short).join(', ') || '—'}`;
  return [...lines, '', meta].join('\n');
}

// ---------------------------------------------------------------------------
// Synthetic graphs: the model-permitted shapes the on-disk fixtures don't
// cover (no ∅ genesis, pruned ancestors, pure cycles, disconnected forests).
// Built in the same shape loadFixture returns.
// ---------------------------------------------------------------------------

function makeGraph(name, rawEdges, refs = {}) {
  const edges = rawEdges.map(([dirName, from, to]) => ({ dirName, from: from ?? EMPTY, to }));
  const nodeSet = new Set();
  for (const e of edges) {
    nodeSet.add(e.from);
    nodeSet.add(e.to);
  }
  const nodes = [...nodeSet];
  const short = (h) => (h === EMPTY ? EMPTY : h.replace(/^sha256:/, '').slice(0, 7));
  return { name, edges, nodes, short, refs };
}

const SYNTH = [
  // two independent roots converging — no ∅ anywhere
  makeGraph('synth-multi-root', [
    ['0001_branch_a_init', 'sha256:aaaaaaa0', 'sha256:ccccccc0'],
    ['0002_branch_b_init', 'sha256:bbbbbbb0', 'sha256:ccccccc0'],
    ['0003_merge', 'sha256:ccccccc0', 'sha256:ddddddd0'],
  ]),
  // a `from` whose producing migration was pruned (dangling parent → root)
  makeGraph('synth-dangling-parent', [
    ['0001_after_prune', 'sha256:ddddddd0', 'sha256:eeeeeee0'],
    ['0002_continue', 'sha256:eeeeeee0', 'sha256:fffffff0'],
  ]),
  // pure 2-cycle, no in-degree-0 root to seed from
  makeGraph('synth-pure-cycle', [
    ['0001_forward', 'sha256:aaaaaaa0', 'sha256:bbbbbbb0'],
    ['0002_rollback', 'sha256:bbbbbbb0', 'sha256:aaaaaaa0'],
  ]),
  // two disconnected components (one ∅-rooted, one dangling-rooted)
  makeGraph('synth-forest', [
    ['0001_app_init', null, 'sha256:aaaaaaa0'],
    ['0002_app_next', 'sha256:aaaaaaa0', 'sha256:bbbbbbb0'],
    ['0003_other_root', 'sha256:ccccccc0', 'sha256:ddddddd0'],
  ]),
  // self-edge alongside forward edges
  makeGraph('synth-self-edge', [
    ['0001_init', null, 'sha256:aaaaaaa0'],
    ['0002_noop', 'sha256:aaaaaaa0', 'sha256:aaaaaaa0'],
    ['0003_next', 'sha256:aaaaaaa0', 'sha256:bbbbbbb0'],
  ]),
];

// ---------------------------------------------------------------------------
// Drive: render every fixture + synthetic case into one gallery file.
// ---------------------------------------------------------------------------

const names = readdirSync(FIXTURES)
  .filter((d) => statSync(join(FIXTURES, d)).isDirectory())
  .sort();

const graphs = [...names.map(loadFixture), ...SYNTH];

const out = ['# tier-3 `migration graph` prototype gallery', ''];
out.push(
  `_Generated by \`projects/migration-graph-rendering/prototype/proto.mjs\` — ${names.length} fixtures + ${SYNTH.length} synthetic._`,
  '',
);

for (const g of graphs) {
  const name = g.name;
  const kind = classify(g);
  const backs = [...kind.values()].filter((k) => k === 'back').length;
  const selfs = [...kind.values()].filter((k) => k === 'self').length;
  out.push(
    `## ${name}  (${g.nodes.length} nodes, ${g.edges.length} edges` +
      `${backs ? `, ${backs} back` : ''}${selfs ? `, ${selfs} self` : ''})`,
    '',
    '```',
    render(g, kind),
    '```',
    '',
  );
}

writeFileSync('projects/migration-graph-rendering/prototype/gallery.md', out.join('\n'));
console.log(
  `Wrote projects/migration-graph-rendering/prototype/gallery.md (${names.length} fixtures)`,
);

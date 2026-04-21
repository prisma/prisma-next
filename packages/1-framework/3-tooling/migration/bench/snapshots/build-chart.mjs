#!/usr/bin/env node
/**
 * Reads a single vitest-bench JSON output (produced by `pnpm bench:save`)
 * and emits a self-contained HTML report with inline SVG log-log charts.
 *
 * One chart per benchmark group (`findPath`, `detectCycles`, …). Within
 * each chart: x-axis is approximate edge count (derived from the
 * benchmark's shape parameters); y-axis is mean ms; one coloured series
 * per shape family (linear, diamond, wide-tree, merge-heavy, …).
 *
 * Run:
 *   pnpm bench:save
 *   node bench/snapshots/build-chart.mjs [bench/results/latest.json]
 *
 * Default input: bench/results/latest.json (relative to repo root).
 * Output:        bench/snapshots/report.html (gitignored).
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_INPUT = resolve(__dirname, '../results/latest.json');

// ---------------------------------------------------------------------------
// Shape parsing: benchmark names encode their shape parameters. Return a
// { family, edges } pair for each known pattern. Unknown names fall back to
// the 'other' family with a best-guess edge count of 1.
// ---------------------------------------------------------------------------

function parseShape(name) {
  let m;

  m = /^linear\((\d+)\)$/.exec(name);
  if (m) return { family: 'linear', edges: Number(m[1]) };

  m = /^diamond\((\d+)\)$/.exec(name);
  if (m) return { family: 'diamond', edges: 2 * Number(m[1]) + 2 };

  m = /^wide-tree\(b=(\d+),d=(\d+)\)$/.exec(name);
  if (m) {
    const b = Number(m[1]);
    const d = Number(m[2]);
    // Total edges in a full b-ary tree of depth d = (b^(d+1) - b) / (b - 1).
    const edges = b === 1 ? d : (b ** (d + 1) - b) / (b - 1);
    return { family: 'wide-tree', edges };
  }

  m = /^merge-heavy\(spine=(\d+),k=(\d+),every=(\d+)\)$/.exec(name);
  if (m) {
    const S = Number(m[1]);
    const K = Number(m[2]);
    const E = Number(m[3]);
    const merges = Math.floor(S / E);
    return { family: 'merge-heavy', edges: S + merges * K * E };
  }

  m = /^ambiguous-leaves\(spine=(\d+),branches=(\d+),len=(\d+)\)$/.exec(name);
  if (m) {
    const S = Number(m[1]);
    const B = Number(m[2]);
    const L = Number(m[3]);
    return { family: 'ambiguous-leaves', edges: S + B * L };
  }

  m = /^realistic-mixed\(spine=(\d+),rate=([\d.]+),branch=(\d+)\)$/.exec(name);
  if (m) {
    const S = Number(m[1]);
    const R = Number(m[2]);
    const B = Number(m[3]);
    return { family: 'realistic-mixed', edges: Math.round(S + S * R * B) };
  }

  m = /^pathological-cycle\((\d+)\)$/.exec(name);
  if (m) return { family: 'pathological-cycle', edges: Number(m[1]) + 1 };

  m = /^disconnected-orphans\(spine=(\d+),clusters=(\d+),size=(\d+)\)$/.exec(name);
  if (m) {
    const S = Number(m[1]);
    const C = Number(m[2]);
    const Z = Number(m[3]);
    return { family: 'disconnected-orphans', edges: S + C * Z };
  }

  // Tolerate the findLeaf "ok · …" / "throw · …" variant names: fall through
  // to the inner shape.
  m = /^(?:ok|throw)\s+·\s+(.+)$/.exec(name);
  if (m) return parseShape(m[1].trim());

  return { family: 'other', edges: 1 };
}

// ---------------------------------------------------------------------------
// Collect (groupName, family, edges, meanMs) tuples from a single bench run.
// ---------------------------------------------------------------------------

function collect(data) {
  const groups = new Map();
  for (const file of data.files ?? []) {
    for (const group of file.groups ?? []) {
      const groupName = group.fullName.replace(/^bench\/dag\.bench\.ts > /, '');
      if (!groups.has(groupName)) groups.set(groupName, new Map());
      const families = groups.get(groupName);
      for (const bench of group.benchmarks ?? []) {
        const mean = bench.mean;
        if (!Number.isFinite(mean) || mean <= 0 || bench.samples === 0) continue;
        const { family, edges } = parseShape(bench.name);
        if (!families.has(family)) families.set(family, []);
        families.get(family).push({ label: bench.name, edges, mean });
      }
    }
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Log-log SVG chart. X: edges. Y: mean ms.
// ---------------------------------------------------------------------------

const PALETTE = [
  '#1f77b4',
  '#ff7f0e',
  '#2ca02c',
  '#d62728',
  '#9467bd',
  '#8c564b',
  '#e377c2',
  '#7f7f7f',
  '#bcbd22',
  '#17becf',
];

function renderChart(title, families) {
  const width = 900;
  const height = 420;
  const margin = { top: 30, right: 200, bottom: 60, left: 70 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  // Gather all (edges, mean) to set axes.
  const points = [];
  for (const series of families.values()) {
    for (const p of series) points.push(p);
  }
  if (points.length === 0) {
    return `<svg width="${width}" height="80"><text x="10" y="40">${escapeXml(title)}: no data</text></svg>`;
  }

  const xVals = points.map((p) => p.edges).filter((v) => v > 0);
  const yVals = points.map((p) => p.mean);
  const logXMin = Math.log10(Math.max(Math.min(...xVals), 1));
  const logXMax = Math.log10(Math.max(...xVals));
  const logYMin = Math.log10(Math.max(Math.min(...yVals), 1e-5));
  const logYMax = Math.log10(Math.max(...yVals));
  const logXSpan = Math.max(logXMax - logXMin, 0.3);
  const logYSpan = Math.max(logYMax - logYMin, 0.3);

  const xFor = (edges) =>
    margin.left + ((Math.log10(Math.max(edges, 1)) - logXMin) / logXSpan) * innerW;
  const yFor = (mean) =>
    margin.top + (1 - (Math.log10(Math.max(mean, 1e-5)) - logYMin) / logYSpan) * innerH;

  const xTickValues = [];
  for (let p = Math.floor(logXMin); p <= Math.ceil(logXMax); p++) {
    xTickValues.push(10 ** p);
  }
  const yTickValues = [];
  for (let p = Math.floor(logYMin); p <= Math.ceil(logYMax); p++) {
    yTickValues.push(10 ** p);
  }

  // Gridlines + axis labels.
  const xAxis = xTickValues
    .map((v) => {
      const x = xFor(v);
      return (
        `<line x1="${x}" x2="${x}" y1="${margin.top}" y2="${margin.top + innerH}" stroke="#eee"/>` +
        `<text x="${x}" y="${margin.top + innerH + 16}" font-size="10" text-anchor="middle" fill="#666">${formatEdges(v)}</text>`
      );
    })
    .join('');

  const yAxis = yTickValues
    .map((v) => {
      const y = yFor(v);
      return (
        `<line x1="${margin.left}" x2="${margin.left + innerW}" y1="${y}" y2="${y}" stroke="#eee"/>` +
        `<text x="${margin.left - 8}" y="${y + 4}" font-size="10" text-anchor="end" fill="#666">${formatMs(v)}</text>`
      );
    })
    .join('');

  // One line + dots per family. Sort each family's points by edge count so
  // the polyline is monotonic.
  const lineEls = [];
  const legend = [];
  let colourIdx = 0;
  for (const [family, series] of families) {
    const colour = PALETTE[colourIdx++ % PALETTE.length];
    const sorted = [...series].sort((a, b) => a.edges - b.edges);
    const pts = sorted.map((p) => `${xFor(p.edges)},${yFor(p.mean)}`);
    if (pts.length >= 2) {
      lineEls.push(
        `<polyline fill="none" stroke="${colour}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" points="${pts.join(' ')}"/>`,
      );
    }
    for (const p of sorted) {
      lineEls.push(
        `<circle cx="${xFor(p.edges)}" cy="${yFor(p.mean)}" r="3.5" fill="${colour}">` +
          `<title>${escapeXml(p.label)}: ${p.mean.toFixed(4)} ms @ ~${p.edges} edges</title>` +
          `</circle>`,
      );
    }
    legend.push({ family, colour });
  }

  const legendItems = legend
    .map((l, i) => {
      const ly = margin.top + i * 16;
      return (
        `<rect x="${margin.left + innerW + 15}" y="${ly - 8}" width="12" height="12" fill="${l.colour}"/>` +
        `<text x="${margin.left + innerW + 32}" y="${ly + 2}" font-size="11" fill="#333">${escapeXml(l.family)}</text>`
      );
    })
    .join('');

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}">
  <style>text { font-family: system-ui, -apple-system, sans-serif; }</style>
  <text x="${width / 2}" y="20" font-size="15" font-weight="600" text-anchor="middle" fill="#111">${escapeXml(title)}</text>
  <text x="${margin.left + innerW / 2}" y="${margin.top + innerH + 45}" font-size="11" text-anchor="middle" fill="#666">edges (log scale)</text>
  <text transform="translate(18 ${margin.top + innerH / 2}) rotate(-90)" font-size="11" text-anchor="middle" fill="#666">mean (ms, log scale)</text>
  <rect x="${margin.left}" y="${margin.top}" width="${innerW}" height="${innerH}" fill="#fafafa" stroke="#ddd"/>
  ${xAxis}
  ${yAxis}
  ${lineEls.join('\n  ')}
  ${legendItems}
</svg>`;
}

function formatMs(v) {
  if (v >= 1) return `${v.toFixed(0)} ms`;
  if (v >= 0.01) return `${v.toFixed(2)} ms`;
  if (v >= 0.001) return `${v.toFixed(3)} ms`;
  return `${(v * 1000).toFixed(1)} µs`;
}

function formatEdges(v) {
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
  return String(v);
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[→→]/g, 'to')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function tryConvertSvgToPng(svgPath, pngPath) {
  try {
    // rsvg-convert is lightweight (librsvg, no browser) and present on most
    // Linux dev machines. If unavailable, skip PNG emission silently.
    execFileSync('rsvg-convert', [svgPath, '-o', pngPath, '-d', '150', '-p', '150'], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

function render(data, inputPath) {
  const groups = collect(data);
  const charts = [];
  const imagesDir = join(__dirname, 'images');
  mkdirSync(imagesDir, { recursive: true });
  let pngCount = 0;
  let svgCount = 0;
  let pngAvailable = true;

  for (const [groupName, families] of groups) {
    const svg = renderChart(groupName, families);
    charts.push(`<section>${svg}</section>`);

    // Also emit a standalone SVG and (if rsvg-convert is available) a PNG.
    const slug = slugify(groupName);
    const svgPath = join(imagesDir, `${slug}.svg`);
    writeFileSync(svgPath, `<?xml version="1.0" encoding="UTF-8"?>\n${svg.trim()}\n`);
    svgCount++;

    if (pngAvailable) {
      const pngPath = join(imagesDir, `${slug}.png`);
      if (tryConvertSvgToPng(svgPath, pngPath)) {
        pngCount++;
      } else {
        pngAvailable = false; // stop trying after first failure
      }
    }
  }
  if (svgCount > 0) {
    console.log(`Wrote ${svgCount} SVGs to ${imagesDir}`);
  }
  if (pngCount > 0) {
    console.log(`Wrote ${pngCount} PNGs (rsvg-convert).`);
  } else if (svgCount > 0 && !pngAvailable) {
    console.log('PNG emission skipped — install rsvg-convert (librsvg) to produce PNGs.');
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Migration graph bench — scaling</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; margin: 2em auto; max-width: 1000px; padding: 0 1em; color: #222; }
  h1 { margin-bottom: 0.3em; }
  .sub { color: #666; margin-top: 0; margin-bottom: 2em; }
  section { margin-bottom: 2em; background: white; border: 1px solid #e5e5e5; border-radius: 6px; padding: 0.5em; }
  section svg { display: block; margin: 0 auto; max-width: 100%; height: auto; }
  code { background: #eee; padding: 1px 4px; border-radius: 3px; font-size: 0.95em; }
</style>
</head>
<body>
<h1>Migration graph bench — scaling</h1>
<p class="sub">Mean latency as graph size grows. One chart per operation; one line per shape family. Both axes log scale. Hover any dot for the exact value. Input: <code>${escapeXml(inputPath)}</code>.</p>
${charts.join('\n')}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const inputArg = process.argv[2];
const inputPath = inputArg ? resolve(inputArg) : DEFAULT_INPUT;

let data;
try {
  data = JSON.parse(readFileSync(inputPath, 'utf8'));
} catch (err) {
  console.error(`Failed to read ${inputPath}: ${err.message}`);
  console.error('Produce one with: pnpm --filter @prisma-next/migration-tools bench:save');
  process.exit(1);
}

const html = render(data, inputPath);
const outPath = join(__dirname, 'report.html');
writeFileSync(outPath, html);
console.log(`Wrote ${outPath}`);

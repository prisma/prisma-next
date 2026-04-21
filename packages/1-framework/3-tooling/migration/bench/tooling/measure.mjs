#!/usr/bin/env node
/**
 * End-to-end measurement pipeline for contract.json size on large Prisma
 * ORM schemas.
 *
 * For each `*.prisma` in this directory:
 *   1. Sanitise (strip generator/datasource/view blocks, @db.* and @updatedAt
 *      attributes, replace Unsupported(), normalise @@id into @id, add a
 *      synthetic @id to pk-less models). See preprocess.mjs.
 *   2. Copy the result into the demo app's `prisma/schema.prisma`.
 *   3. Run `pnpm --filter prisma-next-demo emit`. If the emitter still
 *      reports errors, extract any `file.prisma:LINE:COL` references from
 *      the error messages, blank those lines, and retry. Iterate until
 *      the emit succeeds or we stop making progress.
 *   4. Measure the produced `contract.json` / `contract.d.ts` sizes, count
 *      models and tables, record per-model averages.
 *
 * Restores the demo's original schema + contract files at the end.
 * Prints a markdown table summarising the results.
 *
 * Usage: drop one or more `.prisma` files into this directory, then run
 *   node packages/1-framework/3-tooling/migration/bench/tooling/measure.mjs
 */

import { execSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitise, blankLine } from './preprocess.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '../../../../../..');
const DEMO_DIR = join(REPO_ROOT, 'examples/prisma-next-demo');
const DEMO_SCHEMA = join(DEMO_DIR, 'prisma/schema.prisma');
const DEMO_CONTRACT_JSON = join(DEMO_DIR, 'src/prisma/contract.json');
const DEMO_CONTRACT_DTS = join(DEMO_DIR, 'src/prisma/contract.d.ts');

function backup() {
  const tmpDir = mkdtempSync(join(tmpdir(), 'demo-backup-'));
  copyFileSync(DEMO_SCHEMA, join(tmpDir, 'schema.prisma'));
  copyFileSync(DEMO_CONTRACT_JSON, join(tmpDir, 'contract.json'));
  copyFileSync(DEMO_CONTRACT_DTS, join(tmpDir, 'contract.d.ts'));
  return tmpDir;
}

function restore(tmpDir) {
  copyFileSync(join(tmpDir, 'schema.prisma'), DEMO_SCHEMA);
  copyFileSync(join(tmpDir, 'contract.json'), DEMO_CONTRACT_JSON);
  copyFileSync(join(tmpDir, 'contract.d.ts'), DEMO_CONTRACT_DTS);
}

function countModels(pslSrc) {
  return (pslSrc.match(/^\s*model\s+\w+\s*\{/gm) ?? []).length;
}

/**
 * Run `pnpm emit` in the demo dir. Return the log text and exit status.
 */
function runEmit() {
  try {
    const out = execSync('pnpm emit', {
      cwd: DEMO_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    return { ok: true, log: out };
  } catch (err) {
    const log =
      `${err.stdout ?? ''}\n${err.stderr ?? ''}` || String(err.message ?? err);
    return { ok: false, log };
  }
}

/**
 * Parse emit error output for references to lines in `./prisma/schema.prisma`
 * and return the list of offending 1-based line numbers (deduped, sorted).
 */
function extractErrorLines(log) {
  const re = /\.\/prisma\/schema\.prisma:(\d+):\d+/g;
  const lines = new Set();
  let match;
  while ((match = re.exec(log)) !== null) {
    lines.add(Number.parseInt(match[1], 10));
  }
  return [...lines].sort((a, b) => a - b);
}

/**
 * Iterate: emit → if errors, blank the offending lines, try again.
 * Bail if we stop making progress or hit a retry cap.
 */
function emitWithRetries(initialPsl, maxRetries = 10) {
  let psl = initialPsl;
  writeFileSync(DEMO_SCHEMA, psl);
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const result = runEmit();
    if (result.ok) return { ok: true, psl, attempts: attempt + 1 };

    const offending = extractErrorLines(result.log);
    if (offending.length === 0) {
      return { ok: false, log: result.log, psl, attempts: attempt + 1 };
    }

    let next = psl;
    for (const lineNumber of offending) {
      next = blankLine(next, lineNumber);
    }
    if (next === psl) {
      return { ok: false, log: result.log, psl, attempts: attempt + 1 };
    }
    psl = next;
    writeFileSync(DEMO_SCHEMA, psl);
  }
  return { ok: false, log: 'max retries exhausted', psl, attempts: maxRetries };
}

function size(path) {
  return statSync(path).size;
}

function gzSize(path) {
  return gzipSync(readFileSync(path)).length;
}

function countContractModels(contractJsonPath) {
  const json = JSON.parse(readFileSync(contractJsonPath, 'utf8'));
  const models = Object.keys(json.models ?? {}).length;
  const tables = Object.keys(json.storage?.tables ?? {}).length;
  return { models, tables };
}

function measure(pslName, originalPsl, finalPsl, attempts) {
  const original = originalPsl.length;
  const finalLen = finalPsl.length;
  const pslModels = countModels(finalPsl);
  const { models, tables } = countContractModels(DEMO_CONTRACT_JSON);
  return {
    schema: pslName,
    pslBytes: original,
    pslBytesAfterStrip: finalLen,
    pslModels,
    contractModels: models,
    contractTables: tables,
    contractJsonBytes: size(DEMO_CONTRACT_JSON),
    contractDtsBytes: size(DEMO_CONTRACT_DTS),
    contractJsonGzBytes: gzSize(DEMO_CONTRACT_JSON),
    bytesPerModelJson: Math.round(size(DEMO_CONTRACT_JSON) / Math.max(models, 1)),
    attemptsToEmit: attempts,
  };
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MiB`;
}

function printReport(rows) {
  const header =
    '| Schema | Models (PSL) | Models (contract) | Tables | contract.json | contract.json (gzip) | contract.d.ts | Bytes/model (JSON) | Emit attempts |';
  const sep =
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|';
  console.log(header);
  console.log(sep);
  for (const r of rows) {
    console.log(
      `| ${r.schema} | ${r.pslModels} | ${r.contractModels} | ${r.contractTables} | ${fmtBytes(r.contractJsonBytes)} | ${fmtBytes(r.contractJsonGzBytes)} | ${fmtBytes(r.contractDtsBytes)} | ${r.bytesPerModelJson} B | ${r.attemptsToEmit} |`,
    );
  }
}

// --- Main ---

const schemas = readdirSync(__dirname)
  .filter((f) => f.endsWith('.prisma'))
  .sort();

if (schemas.length === 0) {
  console.error(`No .prisma files found in ${__dirname}`);
  process.exit(1);
}

const backupDir = backup();
console.log(`Backed up demo state to ${backupDir}`);
console.log();

const rows = [];
const failures = [];

try {
  for (const name of schemas) {
    const srcPath = join(__dirname, name);
    const original = readFileSync(srcPath, 'utf8');
    const sanitised = sanitise(original);
    process.stdout.write(`Emitting ${name} (${countModels(sanitised)} models)… `);

    const result = emitWithRetries(sanitised);
    if (!result.ok) {
      console.log(`FAILED after ${result.attempts} attempts`);
      failures.push({ name, log: result.log.slice(-800) });
      continue;
    }
    console.log(`ok after ${result.attempts} attempt(s)`);
    rows.push(measure(name, original, result.psl, result.attempts));
  }
} finally {
  restore(backupDir);
  console.log('\nRestored demo state.');
}

if (rows.length) {
  console.log();
  printReport(rows);
}

if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`--- ${f.name} ---\n${f.log}\n`);
  }
}

// Write structured output for downstream use.
const outPath = join(__dirname, 'measurements.json');
writeFileSync(outPath, JSON.stringify(rows, null, 2));
console.log(`\nWrote ${outPath}`);

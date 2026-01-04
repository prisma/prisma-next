#!/usr/bin/env node
/**
 * Reports footprint metrics for Cursor rules and agent documentation.
 *
 * Usage: node scripts/rules-footprint.mjs [--check]
 *
 * With --check flag: exits with code 1 if any thresholds are exceeded.
 *
 * Outputs:
 *   - total bytes/lines for .cursor/rules/**
 *   - bytes/lines for alwaysApply: true rulecards only
 *   - bytes/lines for AGENTS.md
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RULES_DIR = '.cursor/rules';
const AGENTS_FILE = 'AGENTS.md';

// Thresholds for --check mode (adjust as needed)
const THRESHOLDS = {
  // alwaysApply rulecards should stay minimal
  alwaysApplyLines: 500,
  alwaysApplyBytes: 20_000,
  // AGENTS.md should stay concise
  agentsLines: 200,
  agentsBytes: 10_000,
  // Total rules footprint
  totalRulesLines: 5_000,
  totalRulesBytes: 200_000,
};

function countLines(content) {
  return content.split(/\r?\n/).length;
}

function parseFrontmatter(src) {
  const obj = {};
  const lines = src.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (val === 'true') val = true;
    else if (val === 'false') val = false;
    else if (val === '') {
      if (key === 'globs') val = [];
      else val = undefined;
    } else if (val.startsWith('[') && val.endsWith(']')) {
      const inner = val.slice(1, -1).trim();
      obj[key] = inner ? inner.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')) : [];
      continue;
    } else {
      val = val.replace(/^['"]|['"]$/g, '');
    }
    if (val !== undefined) {
      obj[key] = val;
    }
  }
  return obj;
}

function extractFrontmatter(content) {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;
  return parseFrontmatter(fmMatch[1]);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function main() {
  const checkMode = process.argv.includes('--check');
  const violations = [];

  // Collect rule file stats
  const files = readdirSync(RULES_DIR).filter((f) => /\.(md|mdc)$/i.test(f) && !/^README\.md$/i.test(f));

  let totalBytes = 0;
  let totalLines = 0;
  let alwaysApplyBytes = 0;
  let alwaysApplyLines = 0;
  const alwaysApplyFiles = [];
  const allRuleStats = [];

  for (const file of files) {
    const full = join(RULES_DIR, file);
    const content = readFileSync(full, 'utf8');
    const stats = statSync(full);
    const lines = countLines(content);
    const bytes = stats.size;

    totalBytes += bytes;
    totalLines += lines;

    const fm = extractFrontmatter(content);
    const isAlwaysApply = fm?.alwaysApply === true;

    allRuleStats.push({
      file,
      lines,
      bytes,
      alwaysApply: isAlwaysApply,
    });

    if (isAlwaysApply) {
      alwaysApplyBytes += bytes;
      alwaysApplyLines += lines;
      alwaysApplyFiles.push({ file, lines, bytes });
    }
  }

  // AGENTS.md stats
  let agentsBytes = 0;
  let agentsLines = 0;
  try {
    const agentsContent = readFileSync(AGENTS_FILE, 'utf8');
    const agentsStats = statSync(AGENTS_FILE);
    agentsBytes = agentsStats.size;
    agentsLines = countLines(agentsContent);
  } catch {
    console.warn(`Warning: ${AGENTS_FILE} not found`);
  }

  // README.md in rules dir (add to total but not counted as a rulecard)
  try {
    const readmeContent = readFileSync(join(RULES_DIR, 'README.md'), 'utf8');
    const readmeStats = statSync(join(RULES_DIR, 'README.md'));
    totalBytes += readmeStats.size;
    totalLines += countLines(readmeContent);
  } catch {
    // README.md not found, ignore
  }

  // Print report
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                    RULES FOOTPRINT REPORT                     ');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log();

  console.log('📁 Total .cursor/rules/**');
  console.log(`   Files: ${files.length} rulecards + README`);
  console.log(`   Lines: ${totalLines.toLocaleString()}`);
  console.log(`   Bytes: ${formatBytes(totalBytes)}`);
  console.log();

  console.log('⚡ alwaysApply: true (loaded on every prompt)');
  console.log(`   Files: ${alwaysApplyFiles.length}`);
  console.log(`   Lines: ${alwaysApplyLines.toLocaleString()}`);
  console.log(`   Bytes: ${formatBytes(alwaysApplyBytes)}`);
  if (alwaysApplyFiles.length > 0) {
    console.log('   Breakdown:');
    for (const { file, lines, bytes } of alwaysApplyFiles.sort((a, b) => b.lines - a.lines)) {
      console.log(`     - ${file}: ${lines} lines (${formatBytes(bytes)})`);
    }
  }
  console.log();

  console.log('📄 AGENTS.md');
  console.log(`   Lines: ${agentsLines.toLocaleString()}`);
  console.log(`   Bytes: ${formatBytes(agentsBytes)}`);
  console.log();

  console.log('📊 Combined always-loaded context');
  const combinedLines = alwaysApplyLines + agentsLines;
  const combinedBytes = alwaysApplyBytes + agentsBytes;
  console.log(`   Lines: ${combinedLines.toLocaleString()}`);
  console.log(`   Bytes: ${formatBytes(combinedBytes)}`);
  console.log();

  // Check thresholds if in check mode
  if (checkMode) {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('                      THRESHOLD CHECK                          ');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log();

    if (alwaysApplyLines > THRESHOLDS.alwaysApplyLines) {
      violations.push(
        `alwaysApply lines: ${alwaysApplyLines} > ${THRESHOLDS.alwaysApplyLines}`,
      );
    }
    if (alwaysApplyBytes > THRESHOLDS.alwaysApplyBytes) {
      violations.push(
        `alwaysApply bytes: ${formatBytes(alwaysApplyBytes)} > ${formatBytes(THRESHOLDS.alwaysApplyBytes)}`,
      );
    }
    if (agentsLines > THRESHOLDS.agentsLines) {
      violations.push(`AGENTS.md lines: ${agentsLines} > ${THRESHOLDS.agentsLines}`);
    }
    if (agentsBytes > THRESHOLDS.agentsBytes) {
      violations.push(
        `AGENTS.md bytes: ${formatBytes(agentsBytes)} > ${formatBytes(THRESHOLDS.agentsBytes)}`,
      );
    }
    if (totalLines > THRESHOLDS.totalRulesLines) {
      violations.push(
        `Total rules lines: ${totalLines} > ${THRESHOLDS.totalRulesLines}`,
      );
    }
    if (totalBytes > THRESHOLDS.totalRulesBytes) {
      violations.push(
        `Total rules bytes: ${formatBytes(totalBytes)} > ${formatBytes(THRESHOLDS.totalRulesBytes)}`,
      );
    }

    if (violations.length > 0) {
      console.log('❌ THRESHOLDS EXCEEDED:');
      for (const v of violations) {
        console.log(`   - ${v}`);
      }
      console.log();
      console.log('Adjust thresholds in scripts/rules-footprint.mjs if intentional.');
      process.exit(1);
    } else {
      console.log('✅ All thresholds passed');
    }
    console.log();
  }

  // Print current thresholds for reference
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                    CURRENT THRESHOLDS                         ');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`   alwaysApply lines: ${THRESHOLDS.alwaysApplyLines.toLocaleString()}`);
  console.log(`   alwaysApply bytes: ${formatBytes(THRESHOLDS.alwaysApplyBytes)}`);
  console.log(`   AGENTS.md lines:   ${THRESHOLDS.agentsLines.toLocaleString()}`);
  console.log(`   AGENTS.md bytes:   ${formatBytes(THRESHOLDS.agentsBytes)}`);
  console.log(`   Total rules lines: ${THRESHOLDS.totalRulesLines.toLocaleString()}`);
  console.log(`   Total rules bytes: ${formatBytes(THRESHOLDS.totalRulesBytes)}`);
  console.log();
}

main();


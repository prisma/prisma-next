#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const RULES_DIR = '.cursor/rules';
const CURATED_ALWAYS = new Set([
  'use-correct-tools.mdc',
  'no-target-branches.mdc',
  'omit-should-in-tests.mdc',
  'doc-maintenance.mdc',
]);

const REQUIRED = ['description', 'alwaysApply', 'tags', 'appliesTo', 'owner', 'lastUpdated', 'severity'];

let errors = [];

const files = readdirSync(RULES_DIR).filter((f) => !/^README\.md$/i.test(f));

for (const file of files) {
  if (!/\.(md|mdc)$/i.test(file)) continue;
  const full = join(RULES_DIR, file);
  const raw = readFileSync(full, 'utf8');
  const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    errors.push(`${file}: missing frontmatter block`);
    continue;
  }
  const fm = parseFrontmatter(fmMatch[1]);
  // Validate required keys
  for (const key of REQUIRED) {
    if (!(key in fm)) errors.push(`${file}: missing required key '${key}'`);
  }
  // Types
  if (fm.description && typeof fm.description !== 'string') errors.push(`${file}: description must be string`);
  if (fm.alwaysApply !== undefined && typeof fm.alwaysApply !== 'boolean') errors.push(`${file}: alwaysApply must be boolean`);
  if (fm.tags && !Array.isArray(fm.tags)) errors.push(`${file}: tags must be array`);
  if (fm.appliesTo && !Array.isArray(fm.appliesTo)) errors.push(`${file}: appliesTo must be array`);
  if (fm.owner && typeof fm.owner !== 'string') errors.push(`${file}: owner must be string`);
  if (fm.severity && !['info', 'warn', 'error'].includes(String(fm.severity))) errors.push(`${file}: severity must be one of info|warn|error`);
  if (fm.lastUpdated && !/^\d{4}-\d{2}-\d{2}$/.test(String(fm.lastUpdated))) errors.push(`${file}: lastUpdated must be YYYY-MM-DD`);

  // Curated alwaysApply
  if (fm.alwaysApply === true && !CURATED_ALWAYS.has(file)) {
    errors.push(`${file}: alwaysApply=true but not in curated list`);
  }
}

if (errors.length) {
  console.error('Rule validation failed:\n' + errors.map((e) => ` - ${e}`).join('\n'));
  process.exit(1);
} else {
  console.log('All rules passed validation.');
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
    else if (val.startsWith('[') && val.endsWith(']')) {
      // simple array: ["a", "b"] or ['a','b'] or [a, b]
      const inner = val.slice(1, -1).trim();
      obj[key] = inner ? inner.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')) : [];
      continue;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
      // date string
    } else {
      val = val.replace(/^['"]|['"]$/g, '');
    }
    obj[key] = val;
  }
  return obj;
}


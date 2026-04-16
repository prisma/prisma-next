import type { MigrationMeta } from '@prisma-next/migration-tools/migration';
import type { OpFactoryCall } from './op-factory-call';

export function renderTypeScript(
  calls: ReadonlyArray<OpFactoryCall>,
  meta?: MigrationMeta,
): string {
  const factoryNames = collectFactoryNames(calls);
  const imports = buildImports(factoryNames);
  const planBody = calls.map((c) => renderCall(c)).join(',\n');
  const describeMethod = meta ? buildDescribeMethod(meta) : '';

  return [
    imports,
    '',
    'class M extends Migration {',
    describeMethod,
    '  override plan() {',
    '    return [',
    indent(planBody, 6),
    '    ];',
    '  }',
    '}',
    '',
    'export default M;',
    'Migration.run(import.meta.url, M);',
    '',
  ].join('\n');
}

function collectFactoryNames(calls: ReadonlyArray<OpFactoryCall>): string[] {
  const names = new Set<string>();
  for (const call of calls) {
    names.add(call.factory);
  }
  return [...names].sort();
}

function buildImports(factoryNames: string[]): string {
  const lines = ["import { Migration } from '@prisma-next/family-mongo/migration';"];
  if (factoryNames.length > 0) {
    lines.push(`import { ${factoryNames.join(', ')} } from '@prisma-next/target-mongo/migration';`);
  }
  return lines.join('\n');
}

function buildDescribeMethod(meta: MigrationMeta): string {
  const lines: string[] = [];
  lines.push('  override describe() {');
  lines.push('    return {');
  lines.push(`      from: ${JSON.stringify(meta.from)},`);
  lines.push(`      to: ${JSON.stringify(meta.to)},`);
  if (meta.kind) {
    lines.push(`      kind: ${JSON.stringify(meta.kind)},`);
  }
  if (meta.labels && meta.labels.length > 0) {
    lines.push(`      labels: ${renderLiteral(meta.labels)},`);
  }
  lines.push('    };');
  lines.push('  }');
  lines.push('');
  return lines.join('\n');
}

function renderCall(call: OpFactoryCall): string {
  switch (call.factory) {
    case 'createIndex':
      return call.options
        ? `createIndex(${renderLiteral(call.collection)}, ${renderLiteral(call.keys)}, ${renderLiteral(call.options)})`
        : `createIndex(${renderLiteral(call.collection)}, ${renderLiteral(call.keys)})`;
    case 'dropIndex':
      return `dropIndex(${renderLiteral(call.collection)}, ${renderLiteral(call.keys)})`;
    case 'createCollection':
      return call.options
        ? `createCollection(${renderLiteral(call.collection)}, ${renderLiteral(call.options)})`
        : `createCollection(${renderLiteral(call.collection)})`;
    case 'dropCollection':
      return `dropCollection(${renderLiteral(call.collection)})`;
    case 'collMod':
      return call.meta
        ? `collMod(${renderLiteral(call.collection)}, ${renderLiteral(call.options)}, ${renderLiteral(call.meta)})`
        : `collMod(${renderLiteral(call.collection)}, ${renderLiteral(call.options)})`;
  }
}

function renderLiteral(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((v) => renderLiteral(v));
    const singleLine = `[${items.join(', ')}]`;
    if (singleLine.length <= 80) return singleLine;
    return `[\n${items.map((i) => `  ${i}`).join(',\n')},\n]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return '{}';
    const items = entries.map(([k, v]) => `${renderKey(k)}: ${renderLiteral(v)}`);
    const singleLine = `{ ${items.join(', ')} }`;
    if (singleLine.length <= 80) return singleLine;
    return `{\n${items.map((i) => `  ${i}`).join(',\n')},\n}`;
  }
  return String(value);
}

function renderKey(key: string): string {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line.trim() ? `${pad}${line}` : line))
    .join('\n');
}

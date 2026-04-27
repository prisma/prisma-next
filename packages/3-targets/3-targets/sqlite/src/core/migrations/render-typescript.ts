/**
 * Polymorphic TypeScript emitter for the SQLite migration IR. Mirrors the
 * Postgres `render-typescript.ts` — different base-class + factory module
 * specifier, same overall shape.
 */

import { detectScaffoldRuntime, shebangLineFor } from '@prisma-next/migration-tools/migration-ts';
import { type ImportRequirement, jsonToTsSource, renderImports } from '@prisma-next/ts-render';
import type { SqliteOpFactoryCall } from './op-factory-call';

export interface RenderMigrationMeta {
  readonly from: string;
  readonly to: string;
  readonly kind?: string;
  readonly labels?: readonly string[];
}

const BASE_IMPORT: ImportRequirement = {
  moduleSpecifier: '@prisma-next/target-sqlite/migration',
  symbol: 'Migration',
};

export function renderCallsToTypeScript(
  calls: ReadonlyArray<SqliteOpFactoryCall>,
  meta: RenderMigrationMeta,
): string {
  const imports = buildImports(calls);
  const operationsBody = calls.map((c) => c.renderTypeScript()).join(',\n');

  return [
    shebangLineFor(detectScaffoldRuntime()),
    imports,
    '',
    'export default class M extends Migration {',
    buildDescribeMethod(meta),
    '  override get operations() {',
    '    return [',
    indent(operationsBody, 6),
    '    ];',
    '  }',
    '}',
    '',
    'Migration.run(import.meta.url, M);',
    '',
  ].join('\n');
}

function buildImports(calls: ReadonlyArray<SqliteOpFactoryCall>): string {
  const requirements: ImportRequirement[] = [BASE_IMPORT];
  for (const call of calls) {
    for (const req of call.importRequirements()) {
      requirements.push(req);
    }
  }
  return renderImports(requirements);
}

function buildDescribeMethod(meta: RenderMigrationMeta): string {
  const lines: string[] = [];
  lines.push('  override describe() {');
  lines.push('    return {');
  lines.push(`      from: ${JSON.stringify(meta.from)},`);
  lines.push(`      to: ${JSON.stringify(meta.to)},`);
  if (meta.kind) {
    lines.push(`      kind: ${JSON.stringify(meta.kind)},`);
  }
  if (meta.labels && meta.labels.length > 0) {
    lines.push(`      labels: ${jsonToTsSource(meta.labels)},`);
  }
  lines.push('    };');
  lines.push('  }');
  lines.push('');
  return lines.join('\n');
}

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line.trim() ? `${pad}${line}` : line))
    .join('\n');
}

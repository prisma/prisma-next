/**
 * Polymorphic TypeScript emitter for the Postgres class-flow IR.
 *
 * Each `PostgresOpFactoryCall` renders itself via `renderTypeScript()` and
 * declares its own `importRequirements()`; this file just composes the module
 * source around those contributions. The design mirrors the Mongo target's
 * `render-typescript.ts` deliberately — byte-for-byte alignment isn't required
 * (different factory module specifiers, different base-class name) but the
 * shape is, so future consolidation to a framework-level helper is mechanical.
 */

import { detectScaffoldRuntime, shebangLineFor } from '@prisma-next/migration-tools/migration-ts';
import { type ImportRequirement, jsonToTsSource, renderImports } from '@prisma-next/ts-render';
import type { PostgresOpFactoryCall } from './op-factory-call';

export interface RenderMigrationMeta {
  readonly from: string;
  readonly to: string;
  readonly kind?: string;
  readonly labels?: readonly string[];
}

/**
 * Always-present base import — the rendered scaffold always extends
 * `Migration` from the family-sql migration subpath.
 */
const BASE_IMPORT: ImportRequirement = {
  moduleSpecifier: '@prisma-next/family-sql/migration',
  symbol: 'Migration',
};

export function renderCallsToTypeScript(
  calls: ReadonlyArray<PostgresOpFactoryCall>,
  meta: RenderMigrationMeta,
): string {
  const imports = buildImports(calls);
  const operationsBody = calls.map((c) => c.renderTypeScript()).join(',\n');

  return [
    shebangLineFor(detectScaffoldRuntime()),
    imports,
    '',
    'class M extends Migration {',
    buildDescribeMethod(meta),
    '  override get operations() {',
    '    return [',
    indent(operationsBody, 6),
    '    ];',
    '  }',
    '}',
    '',
    'export default M;',
    'Migration.run(import.meta.url, M);',
    '',
  ].join('\n');
}

function buildImports(calls: ReadonlyArray<PostgresOpFactoryCall>): string {
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

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

/**
 * Always-present base imports for the rendered scaffold. Both come from
 * `@prisma-next/target-sqlite/migration` so an authored SQLite
 * `migration.ts` only needs a single dependency for its base class and
 * its CLI entrypoint. Mirrors Postgres's `BASE_IMPORTS`.
 *
 * - `Migration` — the target-owned re-export fixes the `SqlMigration`
 *   generic to `SqlitePlanTargetDetails` and the abstract `targetId` to
 *   `'sqlite'`.
 * - `MigrationCLI` — the migration-file CLI entrypoint, re-exported from
 *   `@prisma-next/cli/migration-cli`. Loads `prisma-next.config.ts`,
 *   assembles a `ControlStack`, and instantiates the migration class.
 */
const BASE_IMPORTS: readonly ImportRequirement[] = [
  { moduleSpecifier: '@prisma-next/target-sqlite/migration', symbol: 'Migration' },
  { moduleSpecifier: '@prisma-next/target-sqlite/migration', symbol: 'MigrationCLI' },
];

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
    'MigrationCLI.run(import.meta.url, M);',
    '',
  ].join('\n');
}

function buildImports(calls: ReadonlyArray<SqliteOpFactoryCall>): string {
  const requirements: ImportRequirement[] = [...BASE_IMPORTS];
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

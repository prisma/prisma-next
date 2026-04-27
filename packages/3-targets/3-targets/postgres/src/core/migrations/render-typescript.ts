/**
 * Polymorphic TypeScript emitter for the Postgres migration IR.
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
 * Always-present base imports for the rendered scaffold. Both come from
 * `@prisma-next/target-postgres/migration` so an authored Postgres
 * `migration.ts` only needs a single dependency for its base class and
 * its CLI entrypoint:
 *
 * - `Migration` — the target-owned re-export fixes the `SqlMigration`
 *   generic to `PostgresPlanTargetDetails` and the abstract `targetId`
 *   to `'postgres'`, so user-authored migrations don't need to thread
 *   target-details or redeclare `targetId`.
 * - `MigrationCLI` — the migration-file CLI entrypoint, re-exported from
 *   `@prisma-next/cli/migration-cli`. Loads `prisma-next.config.ts`,
 *   assembles a `ControlStack`, and instantiates the migration class.
 *   The migration file owns this dependency directly: pulling CLI
 *   machinery in at script run time is acceptable because the script's
 *   whole purpose is to be invoked from the project that owns the
 *   config.
 */
const BASE_IMPORTS: readonly ImportRequirement[] = [
  { moduleSpecifier: '@prisma-next/target-postgres/migration', symbol: 'Migration' },
  { moduleSpecifier: '@prisma-next/target-postgres/migration', symbol: 'MigrationCLI' },
];

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

function buildImports(calls: ReadonlyArray<PostgresOpFactoryCall>): string {
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

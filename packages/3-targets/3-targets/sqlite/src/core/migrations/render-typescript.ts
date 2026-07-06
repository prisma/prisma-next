/**
 * Polymorphic TypeScript emitter for the SQLite migration IR. Mirrors the
 * Postgres `render-typescript.ts` — different base-class + factory module
 * specifier, same overall shape.
 */

import type { OpFactoryCall } from '@prisma-next/framework-components/control';
import { detectScaffoldRuntime, shebangLineFor } from '@prisma-next/migration-tools/migration-ts';
import { type ImportRequirement, renderImports } from '@prisma-next/ts-render';

export interface RenderMigrationMeta {
  readonly from: string | null;
  readonly to: string;
}

/**
 * Always-present base imports for the rendered scaffold. Both come from
 * `@prisma-next/sqlite/migration` so an authored SQLite
 * `migration.ts` only needs a single dependency for its base class and
 * its CLI entrypoint. Mirrors Postgres's `BASE_IMPORTS`.
 *
 * - `Migration` — the facade re-export fixes the `SqlMigration`
 *   generic to `SqlitePlanTargetDetails` and the abstract `targetId` to
 *   `'sqlite'`.
 * - `MigrationCLI` — the migration-file CLI entrypoint, re-exported from
 *   `@prisma-next/cli/migration-cli`. Loads `prisma-next.config.ts`,
 *   assembles a `ControlStack`, and instantiates the migration class.
 */
const BASE_IMPORTS: readonly ImportRequirement[] = [
  { moduleSpecifier: '@prisma-next/sqlite/migration', symbol: 'Migration' },
  { moduleSpecifier: '@prisma-next/sqlite/migration', symbol: 'MigrationCLI' },
];

export function renderCallsToTypeScript(
  calls: ReadonlyArray<OpFactoryCall>,
  meta: RenderMigrationMeta,
): string {
  const imports = buildImports(calls, meta);
  const operationsBody = calls.map((c) => c.renderTypeScript()).join(',\n');
  const hasStart = meta.from !== null;
  const startField = hasStart ? ['  override readonly startContractJson = startContract;'] : [];

  return [
    shebangLineFor(detectScaffoldRuntime()),
    imports,
    '',
    `export default class M extends Migration<${hasStart ? 'Start' : 'never'}, End> {`,
    ...startField,
    '  override readonly endContractJson = endContract;',
    '',
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

function buildImports(calls: ReadonlyArray<OpFactoryCall>, meta: RenderMigrationMeta): string {
  const requirements: ImportRequirement[] = [...BASE_IMPORTS, ...contractImports(meta)];
  for (const call of calls) {
    for (const req of call.importRequirements()) {
      requirements.push(req);
    }
  }
  return renderImports(requirements);
}

/**
 * The committed contract-JSON imports the scaffold reads its from/to identity
 * from. `end-contract.json` is always present; `start-contract.json` is added
 * only for a non-baseline migration (`meta.from !== null`). The matching
 * `Contract` type imports (aliased `Start`/`End`) feed the
 * `Migration<Start, End>` generics. Baseline emits `Migration<never, End>` with
 * no start imports — `never` is the honest "no prior contract" Start.
 */
function contractImports(meta: RenderMigrationMeta): readonly ImportRequirement[] {
  const reqs: ImportRequirement[] = [
    {
      moduleSpecifier: './end-contract.json',
      symbol: 'endContract',
      kind: 'default',
      attributes: { type: 'json' },
    },
    { moduleSpecifier: './end-contract', symbol: 'Contract', alias: 'End', typeOnly: true },
  ];
  if (meta.from !== null) {
    reqs.push({
      moduleSpecifier: './start-contract.json',
      symbol: 'startContract',
      kind: 'default',
      attributes: { type: 'json' },
    });
    reqs.push({
      moduleSpecifier: './start-contract',
      symbol: 'Contract',
      alias: 'Start',
      typeOnly: true,
    });
  }
  return reqs;
}

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line.trim() ? `${pad}${line}` : line))
    .join('\n');
}

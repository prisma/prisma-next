import { detectScaffoldRuntime, shebangLineFor } from '@prisma-next/migration-tools/migration-ts';
import { type ImportRequirement, renderImports } from '@prisma-next/ts-render';
import type { OpFactoryCall } from './op-factory-call';

export interface RenderMigrationMeta {
  readonly from: string | null;
  readonly to: string;
}

/**
 * Always-present base imports for the rendered scaffold:
 *
 * - `Migration` from `@prisma-next/family-mongo/migration` — the
 *   user-facing Mongo `Migration` base; subclasses don't need to
 *   redeclare `targetId` or thread family/target generics.
 * - `MigrationCLI` from `@prisma-next/cli/migration-cli` — the
 *   migration-file CLI entrypoint that loads `prisma-next.config.ts`,
 *   assembles a `ControlStack`, and instantiates the migration class.
 *   The migration file owns this dependency directly: pulling CLI
 *   machinery in at script run time is acceptable because the script's
 *   whole purpose is to be invoked from the project that owns the
 *   config. (Mirrors the postgres facade pattern; pulling `MigrationCLI`
 *   into `@prisma-next/family-mongo/migration` so a Mongo migration only
 *   needs one import is tracked separately as a follow-up.)
 */
const BASE_IMPORTS: readonly ImportRequirement[] = [
  { moduleSpecifier: '@prisma-next/family-mongo/migration', symbol: 'Migration' },
  { moduleSpecifier: '@prisma-next/cli/migration-cli', symbol: 'MigrationCLI' },
];

/**
 * Render a list of Mongo `OpFactoryCall`s as a `migration.ts`
 * source string. The result is shebanged, extends the user-facing
 * `Migration` (i.e. `MongoMigration`) from `@prisma-next/family-mongo`, and
 * implements `operations`.
 *
 * The scaffold does NOT render a `describe()` method. Instead it imports the
 * committed contract JSON (`end-contract.json`, plus `start-contract.json` for a
 * non-baseline migration) and assigns it to the `endContractJson` /
 * `startContractJson` fields; the `Migration` base derives `describe()`'s
 * from/to from those JSONs' `storage.storageHash`. The class is parameterised
 * `Migration<Start, End>` (or `Migration<never, End>` for a baseline, where
 * `meta.from === null` — no start contract). `meta.to` is no longer embedded as
 * a literal (the base reads it from the JSON at runtime); `meta.from` only
 * selects the baseline vs non-baseline shape.
 *
 * The walk is polymorphic: each call node contributes its own
 * `renderTypeScript()` expression and declares its own
 * `importRequirements()`. The top-level renderer aggregates imports
 * across all nodes and emits one `import { … } from "…"` line per module.
 * The `Migration` / `MigrationCLI` base imports and the contract-JSON imports
 * are always emitted — they're structural to the rendered scaffold (extends
 * `Migration`, derives `describe()` from the JSON, calls `MigrationCLI.run`),
 * not driven by any node.
 */
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
    `class M extends Migration<${hasStart ? 'Start' : 'never'}, End> {`,
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
    'export default M;',
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

import { detectScaffoldRuntime, shebangLineFor } from '@prisma-next/migration-tools/migration-ts';
import { type ImportRequirement, jsonToTsSource } from '@prisma-next/ts-render';
import type { OpFactoryCall } from './op-factory-call';

export interface RenderMigrationMeta {
  readonly from: string;
  readonly to: string;
  readonly kind?: string;
  readonly labels?: readonly string[];
}

/**
 * Render a list of Mongo `OpFactoryCall`s as a class-flow `migration.ts`
 * source string. The result is shebanged, extends the user-facing
 * `Migration` (i.e. `MongoMigration`) from `@prisma-next/family-mongo`, and
 * implements the abstract `operations` and `describe` members. `meta` is
 * always rendered — `describe()` is part of the `Migration` contract, so
 * even an empty stub must satisfy it; callers pass empty strings for a
 * migration-new scaffold.
 *
 * The walk is polymorphic: each call node contributes its own
 * `renderTypeScript()` expression and declares its own
 * `importRequirements()`. The top-level renderer aggregates imports
 * across all nodes and emits one `import { … } from "…"` line per module.
 * The `Migration` import from `@prisma-next/family-mongo/migration` is
 * always emitted — it's driven by `meta` (the rendered scaffold always
 * extends `Migration`), not by any node.
 */
export function renderCallsToTypeScript(
  calls: ReadonlyArray<OpFactoryCall>,
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

function buildImports(calls: ReadonlyArray<OpFactoryCall>): string {
  const symbolsByModule = new Map<string, Set<string>>();
  for (const call of calls) {
    for (const req of call.importRequirements()) {
      collectRequirement(symbolsByModule, req);
    }
  }

  const lines = ["import { Migration } from '@prisma-next/family-mongo/migration';"];
  // Maps preserve insertion order. Modules appear in the order the first call
  // requiring them is processed, and we emit symbols sorted within each module.
  for (const [moduleSpecifier, symbolSet] of symbolsByModule) {
    const symbols = [...symbolSet].sort();
    lines.push(`import { ${symbols.join(', ')} } from '${moduleSpecifier}';`);
  }
  return lines.join('\n');
}

function collectRequirement(
  symbolsByModule: Map<string, Set<string>>,
  req: ImportRequirement,
): void {
  let set = symbolsByModule.get(req.moduleSpecifier);
  if (!set) {
    set = new Set();
    symbolsByModule.set(req.moduleSpecifier, set);
  }
  set.add(req.symbol);
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

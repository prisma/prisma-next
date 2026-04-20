import type {
  MigrationScaffoldContext,
  OperationDescriptor,
} from '@prisma-next/framework-components/control';
import { relative } from 'pathe';

/**
 * Postgres's internal plan shape. Happens to be descriptor-shaped today — that
 * is a target-internal choice; the framework has no opinion.
 */
type PostgresPlan = readonly OperationDescriptor[];

function serializeQueryInput(input: unknown): string {
  if (typeof input === 'boolean') return String(input);
  if (typeof input === 'symbol') return 'TODO /* fill in using db.sql.from(...) */';
  if (input === null || input === undefined) return 'null';
  if (Array.isArray(input)) {
    if (input.length === 0) return '[]';
    if (input.every((item) => typeof item === 'symbol'))
      return '[TODO /* fill in using db.sql.from(...) */]';
    return `[${input.map(serializeQueryInput).join(', ')}]`;
  }
  return JSON.stringify(input);
}

function renderDescriptor(desc: OperationDescriptor): string {
  switch (desc.kind) {
    case 'createTable':
      return `createTable(${JSON.stringify(desc['table'])})`;
    case 'dropTable':
      return `dropTable(${JSON.stringify(desc['table'])})`;
    case 'addColumn': {
      const args = [JSON.stringify(desc['table']), JSON.stringify(desc['column'])];
      if (desc['overrides']) {
        args.push(JSON.stringify(desc['overrides']));
      }
      return `addColumn(${args.join(', ')})`;
    }
    case 'dropColumn':
      return `dropColumn(${JSON.stringify(desc['table'])}, ${JSON.stringify(desc['column'])})`;
    case 'alterColumnType': {
      const opts: Record<string, unknown> = {};
      if (desc['using']) opts['using'] = desc['using'];
      if (desc['toType']) opts['toType'] = desc['toType'];
      const hasOpts = Object.keys(opts).length > 0;
      return hasOpts
        ? `alterColumnType(${JSON.stringify(desc['table'])}, ${JSON.stringify(desc['column'])}, ${JSON.stringify(opts)})`
        : `alterColumnType(${JSON.stringify(desc['table'])}, ${JSON.stringify(desc['column'])})`;
    }
    case 'setNotNull':
      return `setNotNull(${JSON.stringify(desc['table'])}, ${JSON.stringify(desc['column'])})`;
    case 'dropNotNull':
      return `dropNotNull(${JSON.stringify(desc['table'])}, ${JSON.stringify(desc['column'])})`;
    case 'setDefault':
      return `setDefault(${JSON.stringify(desc['table'])}, ${JSON.stringify(desc['column'])})`;
    case 'dropDefault':
      return `dropDefault(${JSON.stringify(desc['table'])}, ${JSON.stringify(desc['column'])})`;
    case 'addPrimaryKey':
      return `addPrimaryKey(${JSON.stringify(desc['table'])})`;
    case 'addUnique':
      return `addUnique(${JSON.stringify(desc['table'])}, ${JSON.stringify(desc['columns'])})`;
    case 'addForeignKey':
      return `addForeignKey(${JSON.stringify(desc['table'])}, ${JSON.stringify(desc['columns'])})`;
    case 'dropConstraint':
      return `dropConstraint(${JSON.stringify(desc['table'])}, ${JSON.stringify(desc['constraintName'])})`;
    case 'createIndex':
      return `createIndex(${JSON.stringify(desc['table'])}, ${JSON.stringify(desc['columns'])})`;
    case 'dropIndex':
      return `dropIndex(${JSON.stringify(desc['table'])}, ${JSON.stringify(desc['indexName'])})`;
    case 'createEnumType':
      return desc['values']
        ? `createEnumType(${JSON.stringify(desc['typeName'])}, ${JSON.stringify(desc['values'])})`
        : `createEnumType(${JSON.stringify(desc['typeName'])})`;
    case 'addEnumValues':
      return `addEnumValues(${JSON.stringify(desc['typeName'])}, ${JSON.stringify(desc['values'])})`;
    case 'dropEnumType':
      return `dropEnumType(${JSON.stringify(desc['typeName'])})`;
    case 'renameType':
      return `renameType(${JSON.stringify(desc['fromName'])}, ${JSON.stringify(desc['toName'])})`;
    case 'createDependency':
      return `createDependency(${JSON.stringify(desc['dependencyId'])})`;
    case 'dataTransform':
      return `dataTransform(${JSON.stringify(desc['name'])}, {\n    check: ${serializeQueryInput(desc['check'])},\n    run: ${serializeQueryInput(desc['run'])},\n  })`;
    default:
      throw new Error(`Unknown Postgres descriptor kind: ${desc.kind}`);
  }
}

function renderPreamble(
  plan: PostgresPlan,
  context: MigrationScaffoldContext,
): ReadonlyArray<string> {
  const hasDataTransform = plan.some((d) => d.kind === 'dataTransform');

  if (hasDataTransform && context.contractJsonPath) {
    const relativeContractDts = relative(context.packageDir, context.contractJsonPath).replace(
      /\.json$/,
      '.d',
    );
    const importList = [...new Set(plan.map((d) => d.kind))];
    importList.push('TODO');
    return [
      `import type { Contract } from "${relativeContractDts}"`,
      `import { createBuilders } from "@prisma-next/target-postgres/migration-builders"`,
      '',
      `const { ${importList.join(', ')} } = createBuilders<Contract>()`,
    ];
  }

  const importList = [...new Set(plan.map((d) => d.kind))];
  if (importList.length === 0) {
    importList.push('createTable');
  }
  if (hasDataTransform) {
    importList.push('TODO');
  }
  return [
    `import { ${importList.join(', ')} } from "@prisma-next/target-postgres/migration-builders"`,
  ];
}

/**
 * Render a Postgres descriptor list to a `migration.ts` source string.
 *
 * Internal to the Postgres target — no longer part of the framework SPI.
 * Invoked from two paths:
 *  - the migrations capability's `renderDescriptorTypeScript` hook (called by
 *    the CLI after `planWithDescriptors` to seed an editable authoring
 *    surface, and by `emptyMigration()` to produce the `migration new` stub);
 *  - directly by this package's unit tests.
 */
export function renderDescriptorTypeScript(
  descriptors: readonly OperationDescriptor[],
  context: MigrationScaffoldContext,
): string {
  const preamble = renderPreamble(descriptors, context);
  const calls = descriptors.map((d) => `  ${renderDescriptor(d)},`);
  const body = calls.length > 0 ? `\n${calls.join('\n')}\n` : '';
  return [...preamble, '', `export default () => [${body}]`, ''].join('\n');
}

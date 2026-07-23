/**
 * REPL meta commands: dot commands with psql-style backslash aliases.
 * Pure — takes the parsed schema info and returns text, so the session
 * shell owns all IO.
 */
import { replPalette } from './palette';
import type { ReplSchemaInfo } from './schema-info';

export interface MetaCommandResult {
  readonly handled: boolean;
  readonly output?: string;
  readonly exit?: boolean;
  readonly clear?: boolean;
}

interface MetaCommandSpec {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly args?: string;
  readonly description: string;
}

const META_COMMANDS: readonly MetaCommandSpec[] = [
  { name: '.help', aliases: ['\\?'], description: 'Show this help' },
  { name: '.tables', aliases: ['\\dt'], description: 'List tables' },
  { name: '.schema', aliases: ['\\d'], args: '[table]', description: 'Describe a table' },
  { name: '.models', aliases: [], description: 'List ORM models' },
  { name: '.clear', aliases: [], description: 'Clear the screen' },
  { name: '.exit', aliases: ['.quit', '\\q'], description: 'Exit the repl' },
];

export const META_COMMAND_COMPLETIONS: readonly { label: string; insert: string }[] =
  META_COMMANDS.flatMap((cmd) => [
    { label: cmd.name, insert: cmd.name },
    ...cmd.aliases.map((alias) => ({ label: alias, insert: alias })),
  ]);

const NOT_HANDLED: MetaCommandResult = { handled: false };

/**
 * Dot input is claimed as a meta command only when it looks like one: a dot
 * followed by a bare word (optionally with arguments). Leading-dot
 * JavaScript — number literals like `.5 + 1` or pasted chain-continuation
 * lines like `.select('id')` — falls through to the evaluator.
 */
const META_SHAPE = /^\.[A-Za-z]+(?:\s|$)/;

function renderHelp(color: boolean): string {
  const p = replPalette(color);
  const lines = META_COMMANDS.map((cmd) => {
    const invocation = [cmd.name, ...(cmd.args ? [cmd.args] : [])].join(' ');
    const aliases = cmd.aliases.length > 0 ? ` (${cmd.aliases.join(', ')})` : '';
    return `  ${p.cyan(invocation.padEnd(16))}${cmd.description}${p.dim(aliases)}`;
  });
  const tips = [
    '',
    `  ${p.bold('Queries auto-execute:')} builders and plans run on submit.`,
    `  ${p.cyan('Tab')} completes tables, columns, and methods. ${p.cyan('→')} accepts inline suggestions.`,
  ];
  return [...lines, ...tips].join('\n');
}

function renderTables(schema: ReplSchemaInfo, color: boolean): string {
  const p = replPalette(color);
  const lines: string[] = [];
  for (const [nsId, ns] of Object.entries(schema.namespaces)) {
    for (const [tableName, table] of Object.entries(ns.tables)) {
      lines.push(
        `  ${p.dim(nsId)}.${p.cyan(tableName)}  ${p.dim(`${table.columns.length} columns`)}`,
      );
    }
  }
  return lines.length > 0 ? lines.join('\n') : '  (no tables)';
}

function renderTableSchema(schema: ReplSchemaInfo, tableName: string, color: boolean): string {
  const p = replPalette(color);
  for (const [nsId, ns] of Object.entries(schema.namespaces)) {
    const table = ns.tables[tableName];
    if (!table) continue;
    const header = `  ${p.bold(`${nsId}.${tableName}`)}`;
    const width = Math.max(...table.columns.map((c) => c.name.length), 4);
    const rows = table.columns.map((col) => {
      const flags = [col.isPrimaryKey ? 'pk' : null, col.nullable ? 'nullable' : 'not null']
        .filter((f): f is string => f !== null)
        .join(', ');
      return `    ${p.cyan(col.name.padEnd(width + 2))}${col.nativeType.padEnd(14)}${p.dim(flags)}`;
    });
    return [header, ...rows].join('\n');
  }
  return `  Unknown table: ${tableName} — try .tables`;
}

function renderAllTableSchemas(schema: ReplSchemaInfo, color: boolean): string {
  const sections: string[] = [];
  for (const ns of Object.values(schema.namespaces)) {
    for (const tableName of Object.keys(ns.tables)) {
      sections.push(renderTableSchema(schema, tableName, color));
    }
  }
  return sections.length > 0 ? sections.join('\n\n') : '  (no tables)';
}

function renderModels(schema: ReplSchemaInfo, color: boolean): string {
  const p = replPalette(color);
  const lines: string[] = [];
  for (const [nsId, ns] of Object.entries(schema.namespaces)) {
    for (const [modelName, model] of Object.entries(ns.models)) {
      const relations = model.relations.length > 0 ? ` → ${model.relations.join(', ')}` : '';
      lines.push(
        `  ${p.dim(nsId)}.${p.cyan(modelName)}  ${p.dim(`table ${model.table} · ${model.fields.length} fields${relations}`)}`,
      );
    }
  }
  return lines.length > 0 ? lines.join('\n') : '  (no models)';
}

export function runMetaCommand(
  input: string,
  schema: ReplSchemaInfo,
  opts: { readonly color: boolean },
): MetaCommandResult {
  const trimmed = input.trim();
  const isMetaShaped = trimmed.startsWith('\\') || META_SHAPE.test(trimmed);
  if (!isMetaShaped) return NOT_HANDLED;
  const [command = '', ...args] = trimmed.split(/\s+/);

  switch (command) {
    case '.help':
    case '\\?':
      return { handled: true, output: renderHelp(opts.color) };
    case '.tables':
    case '\\dt':
      return { handled: true, output: renderTables(schema, opts.color) };
    case '.schema':
    case '\\d': {
      const table = args[0];
      return {
        handled: true,
        output: table
          ? renderTableSchema(schema, table, opts.color)
          : renderAllTableSchemas(schema, opts.color),
      };
    }
    case '.models':
      return { handled: true, output: renderModels(schema, opts.color) };
    case '.clear':
      return { handled: true, clear: true };
    case '.exit':
    case '.quit':
    case '\\q':
      return { handled: true, exit: true };
    default:
      return {
        handled: true,
        output: `  Unknown command: ${command} — type .help for available commands`,
      };
  }
}

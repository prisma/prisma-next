/**
 * REPL meta commands: dot commands with psql-style backslash aliases.
 * Pure — takes the parsed schema info and returns text, so the session
 * shell owns all IO.
 */
import { createColors } from 'colorette';

// `color` option is authoritative; see highlight.ts for why NO_COLOR is bypassed.
const { bold, cyan, dim } = createColors({ useColor: true });

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

function style(text: string, fn: (s: string) => string, color: boolean): string {
  return color ? fn(text) : text;
}

function renderHelp(color: boolean): string {
  const lines = META_COMMANDS.map((cmd) => {
    const invocation = [cmd.name, ...(cmd.args ? [cmd.args] : [])].join(' ');
    const aliases = cmd.aliases.length > 0 ? ` (${cmd.aliases.join(', ')})` : '';
    return `  ${style(invocation.padEnd(16), cyan, color)}${cmd.description}${style(aliases, dim, color)}`;
  });
  const tips = [
    '',
    `  ${style('Queries auto-execute:', bold, color)} builders and plans run on submit.`,
    `  ${style('Tab', cyan, color)} completes tables, columns, and methods. ${style('→', cyan, color)} accepts inline suggestions.`,
  ];
  return [...lines, ...tips].join('\n');
}

function renderTables(schema: ReplSchemaInfo, color: boolean): string {
  const lines: string[] = [];
  for (const [nsId, ns] of Object.entries(schema.namespaces)) {
    for (const [tableName, table] of Object.entries(ns.tables)) {
      lines.push(
        `  ${style(nsId, dim, color)}.${style(tableName, cyan, color)}  ${style(`${table.columns.length} columns`, dim, color)}`,
      );
    }
  }
  return lines.length > 0 ? lines.join('\n') : '  (no tables)';
}

function renderTableSchema(schema: ReplSchemaInfo, tableName: string, color: boolean): string {
  for (const [nsId, ns] of Object.entries(schema.namespaces)) {
    const table = ns.tables[tableName];
    if (!table) continue;
    const header = `  ${style(`${nsId}.${tableName}`, bold, color)}`;
    const width = Math.max(...table.columns.map((c) => c.name.length), 4);
    const rows = table.columns.map((col) => {
      const flags = [col.isPrimaryKey ? 'pk' : null, col.nullable ? 'nullable' : 'not null']
        .filter((f): f is string => f !== null)
        .join(', ');
      return `    ${style(col.name.padEnd(width + 2), cyan, color)}${col.nativeType.padEnd(14)}${style(flags, dim, color)}`;
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
  const lines: string[] = [];
  for (const [nsId, ns] of Object.entries(schema.namespaces)) {
    for (const [modelName, model] of Object.entries(ns.models)) {
      const relations = model.relations.length > 0 ? ` → ${model.relations.join(', ')}` : '';
      lines.push(
        `  ${style(nsId, dim, color)}.${style(modelName, cyan, color)}  ${style(`table ${model.table} · ${model.fields.length} fields${relations}`, dim, color)}`,
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
  if (!trimmed.startsWith('.') && !trimmed.startsWith('\\')) return NOT_HANDLED;
  // Member chains like `db.sql` also reach here only when the line *starts*
  // with a dot, so a leading-dot identifier check keeps expressions untouched.
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

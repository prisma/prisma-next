/**
 * Context-sensitive completion engine for the REPL.
 *
 * Pure and synchronous: given a buffer, a cursor position, and the
 * contract-derived {@link ReplSchemaInfo}, it returns completion items plus
 * the buffer index the completion replaces from. The line editor renders the
 * same result as a dropdown menu (pgcli style) and as inline ghost text
 * (fish style); the non-interactive paths never call it.
 *
 * The engine understands both query lanes:
 * - `db.sql.<ns>.<table>` chains — tables, columns in string args,
 *   builder methods, `(f, fns) =>` lambda params.
 * - `db.orm.<ns>.<Model>` chains — models, fields/relations in string args,
 *   collection methods, `(u) => u.field.eq(...)` lambda params.
 */
import { META_COMMAND_COMPLETIONS } from './meta-commands';
import type { ReplModelInfo, ReplSchemaInfo, ReplTableInfo } from './schema-info';

export type CompletionKind =
  | 'namespace'
  | 'table'
  | 'column'
  | 'model'
  | 'field'
  | 'relation'
  | 'method'
  | 'property'
  | 'enum'
  | 'global'
  | 'meta';

export interface CompletionItem {
  readonly label: string;
  readonly insert: string;
  readonly kind: CompletionKind;
  readonly detail?: string;
}

export interface CompletionResult {
  readonly items: readonly CompletionItem[];
  readonly from: number;
}

const EMPTY: CompletionResult = { items: [], from: 0 };

const DB_MEMBERS: readonly CompletionItem[] = [
  { label: 'sql', insert: 'sql', kind: 'property', detail: 'SQL query builder lane' },
  { label: 'orm', insert: 'orm', kind: 'property', detail: 'ORM collections lane' },
  { label: 'enums', insert: 'enums', kind: 'property', detail: 'contract enums' },
  { label: 'raw', insert: 'raw', kind: 'property', detail: 'raw SQL tag' },
  { label: 'runtime', insert: 'runtime', kind: 'method', detail: 'runtime() → execute plans' },
  { label: 'transaction', insert: 'transaction', kind: 'method', detail: 'run in a transaction' },
  { label: 'prepare', insert: 'prepare', kind: 'method', detail: 'prepared statement' },
  { label: 'contract', insert: 'contract', kind: 'property', detail: 'loaded contract' },
  { label: 'connect', insert: 'connect', kind: 'method', detail: 'connect explicitly' },
  { label: 'close', insert: 'close', kind: 'method', detail: 'close the client' },
];

function methods(names: readonly string[]): CompletionItem[] {
  return names.map((name) => ({ label: name, insert: name, kind: 'method' as const }));
}

const TABLE_METHODS = methods(['select', 'insert', 'update', 'delete', 'as', 'join', 'leftJoin']);
const SELECT_CHAIN_METHODS = methods([
  'select',
  'where',
  'orderBy',
  'groupBy',
  'distinctOn',
  'limit',
  'offset',
  'join',
  'leftJoin',
  'annotate',
  'build',
]);
const INSERT_CHAIN_METHODS = methods(['returning', 'annotate', 'build']);
const UPDATE_DELETE_CHAIN_METHODS = methods(['where', 'returning', 'annotate', 'build']);
const RETURNING_CHAIN_METHODS = methods(['annotate', 'build']);

const COLLECTION_ROOT_METHODS = methods([
  'where',
  'select',
  'include',
  'orderBy',
  'take',
  'skip',
  'cursor',
  'all',
  'first',
  'count',
  'aggregate',
  'groupBy',
  'variant',
  'create',
  'createAll',
  'update',
  'updateAll',
  'upsert',
  'delete',
  'deleteAll',
]);
const COLLECTION_CHAIN_METHODS = methods([
  'where',
  'select',
  'include',
  'orderBy',
  'take',
  'skip',
  'cursor',
  'all',
  'first',
  'count',
  'aggregate',
  'groupBy',
  'variant',
]);

const SQL_FNS = methods([
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'and',
  'or',
  'in',
  'notIn',
  'exists',
  'notExists',
  'count',
  'sum',
  'avg',
  'min',
  'max',
  'raw',
]);

const ORM_COMPARISONS = methods([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'like',
  'ilike',
  'in',
  'notIn',
  'isNull',
  'isNotNull',
  'asc',
  'desc',
]);

const RELATION_PREDICATES = methods(['some', 'every', 'none']);

const ENUM_ACCESSOR_MEMBERS: readonly CompletionItem[] = [
  { label: 'values', insert: 'values', kind: 'property', detail: 'declared values' },
  { label: 'members', insert: 'members', kind: 'property', detail: 'name → member map' },
  { label: 'hasName', insert: 'hasName', kind: 'method', detail: 'narrow a member name' },
];

const DEFAULT_GLOBALS = ['db', 'console', 'JSON', 'Math', 'Date'];

/** Methods whose string arguments name columns/fields of the chain subject. */
const SQL_COLUMN_ARG_METHODS = new Set(['select', 'orderBy', 'groupBy', 'distinctOn', 'returning']);
const ORM_FIELD_ARG_METHODS = new Set(['select', 'orderBy', 'returning']);
const ORM_RELATION_ARG_METHODS = new Set(['include']);
/** Methods whose callback params expose fields (and fns for SQL). */
const LAMBDA_METHODS = new Set(['where', 'orderBy', 'groupBy', 'distinctOn', 'update', 'include']);

interface ChainSegment {
  readonly name: string;
  readonly called: boolean;
}

interface OpenFrame {
  /** Index of the unmatched '(' in the scanned text. */
  readonly openIndex: number;
}

interface ScanState {
  readonly inString: { readonly quote: string; readonly contentStart: number } | null;
  /** Unmatched '(' positions, outermost first. */
  readonly openFrames: readonly OpenFrame[];
  /** For every index, whether it sits inside a string literal (quotes included). */
  readonly stringMask: readonly boolean[];
}

function scanSource(text: string): ScanState {
  const stringMask = new Array<boolean>(text.length).fill(false);
  const frames: OpenFrame[] = [];
  let quote: string | null = null;
  let contentStart = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote !== null) {
      stringMask[i] = true;
      if (ch === '\\') {
        if (i + 1 < text.length) stringMask[i + 1] = true;
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      contentStart = i + 1;
      stringMask[i] = true;
      continue;
    }
    if (ch === '(') {
      frames.push({ openIndex: i });
    } else if (ch === ')') {
      frames.pop();
    }
  }

  return {
    inString: quote !== null ? { quote, contentStart } : null,
    openFrames: frames,
    stringMask,
  };
}

function isIdentChar(ch: string): boolean {
  return /[\w$]/.test(ch);
}

/**
 * Extracts the dotted member chain that ends right before `index`, walking
 * backward over identifiers, dots, and balanced call parentheses. Returns
 * segments in source order; empty when `index` is not preceded by a chain.
 */
function chainBeforeIndex(text: string, index: number, mask: readonly boolean[]): ChainSegment[] {
  const segments: ChainSegment[] = [];
  let i = index;

  while (i > 0) {
    let called = false;
    while (i > 0 && /\s/.test(text[i - 1]!)) i--;
    if (i > 0 && text[i - 1] === ')') {
      let depth = 0;
      let j = i - 1;
      for (; j >= 0; j--) {
        if (mask[j]) continue;
        if (text[j] === ')') depth++;
        else if (text[j] === '(') {
          depth--;
          if (depth === 0) break;
        }
      }
      if (j < 0 || depth !== 0) return [];
      called = true;
      i = j;
      while (i > 0 && /\s/.test(text[i - 1]!)) i--;
    }
    const end = i;
    while (i > 0 && isIdentChar(text[i - 1]!)) i--;
    if (i === end) return [];
    segments.unshift({ name: text.slice(i, end), called });
    while (i > 0 && /\s/.test(text[i - 1]!)) i--;
    if (i > 0 && text[i - 1] === '.') {
      i--;
      continue;
    }
    break;
  }

  return segments;
}

interface ChainSubject {
  readonly kind: 'sqlTable' | 'ormModel';
  readonly namespace: string;
  readonly name: string;
  /** Name of the call the chain ends in (e.g. `select` for `…user.select(`). */
  readonly method: string | null;
}

/** Resolves a chain like `db.sql.public.user.select` to its schema subject. */
function resolveSubject(
  segments: readonly ChainSegment[],
  schema: ReplSchemaInfo,
): ChainSubject | null {
  if (segments.length < 4 || segments[0]?.name !== 'db') return null;
  const lane = segments[1]?.name;
  const namespace = segments[2]?.name ?? '';
  const ns = schema.namespaces[namespace];
  if (!ns) return null;
  const name = segments[3]?.name ?? '';
  const method = segments.length > 4 ? (segments[segments.length - 1]?.name ?? null) : null;
  if (lane === 'sql' && ns.tables[name]) {
    return { kind: 'sqlTable', namespace, name, method };
  }
  if (lane === 'orm' && ns.models[name]) {
    return { kind: 'ormModel', namespace, name, method };
  }
  return null;
}

function tableColumns(table: ReplTableInfo): CompletionItem[] {
  return table.columns.map((col) => ({
    label: col.name,
    insert: col.name,
    kind: 'column' as const,
    detail: `${col.nativeType}${col.isPrimaryKey ? ' · pk' : col.nullable ? ' · nullable' : ''}`,
  }));
}

function modelFields(model: ReplModelInfo): CompletionItem[] {
  return model.fields.map((field) => ({ label: field, insert: field, kind: 'field' as const }));
}

function modelRelations(model: ReplModelInfo): CompletionItem[] {
  return model.relations.map((rel) => ({ label: rel, insert: rel, kind: 'relation' as const }));
}

function subjectMembers(subject: ChainSubject, schema: ReplSchemaInfo): CompletionItem[] {
  const ns = schema.namespaces[subject.namespace];
  if (!ns) return [];
  if (subject.kind === 'sqlTable') {
    const table = ns.tables[subject.name];
    return table ? tableColumns(table) : [];
  }
  const model = ns.models[subject.name];
  return model ? [...modelFields(model), ...modelRelations(model)] : [];
}

function namespaceItems(schema: ReplSchemaInfo): CompletionItem[] {
  return Object.keys(schema.namespaces).map((ns) => ({
    label: ns,
    insert: ns,
    kind: 'namespace' as const,
  }));
}

function sqlChainMethods(subjectMethod: string | null): readonly CompletionItem[] {
  if (subjectMethod === null) return TABLE_METHODS;
  if (subjectMethod === 'insert') return INSERT_CHAIN_METHODS;
  if (subjectMethod === 'update' || subjectMethod === 'delete') return UPDATE_DELETE_CHAIN_METHODS;
  if (subjectMethod === 'returning') return RETURNING_CHAIN_METHODS;
  return SELECT_CHAIN_METHODS;
}

/**
 * Finds lambda parameters declared inside the innermost open call frames.
 * Returns a map from parameter name to its position (0 = fields proxy,
 * 1 = fns helper) and the frame's resolved subject.
 */
function lambdaParams(
  text: string,
  frames: readonly OpenFrame[],
  mask: readonly boolean[],
  schema: ReplSchemaInfo,
): Map<string, { subject: ChainSubject; position: number }> {
  const params = new Map<string, { subject: ChainSubject; position: number }>();
  for (const frame of frames) {
    const chain = chainBeforeIndex(text, frame.openIndex, mask);
    const subject = resolveSubject(chain, schema);
    if (!subject) continue;
    const methodName = chain[chain.length - 1]?.name ?? '';
    if (!LAMBDA_METHODS.has(methodName)) continue;
    const argText = text.slice(frame.openIndex + 1);
    const arrowMatches = [...argText.matchAll(/(?:\(([^()]*)\)|([A-Za-z_$][\w$]*))\s*=>/g)];
    const arrow = arrowMatches[arrowMatches.length - 1];
    if (!arrow) continue;
    const paramList = arrow[1] ?? arrow[2] ?? '';
    const names = paramList
      .split(',')
      .map((p) => p.trim())
      .filter((p) => /^[A-Za-z_$][\w$]*$/.test(p));
    names.forEach((name, position) => {
      if (!params.has(name)) {
        params.set(name, { subject: { ...subject, method: methodName }, position });
      }
    });
  }
  return params;
}

function filterItems(items: readonly CompletionItem[], partial: string): CompletionItem[] {
  if (partial === '') return [...items];
  const lower = partial.toLowerCase();
  const prefix = items.filter((item) => item.label.toLowerCase().startsWith(lower));
  if (prefix.length > 0) return prefix;
  return items.filter((item) => item.label.toLowerCase().includes(lower));
}

function completeMeta(text: string, cursor: number): CompletionResult | null {
  const match = text.match(/^\s*([.\\][\w?]*)$/);
  if (!match) return null;
  const partial = match[1]!;
  const from = cursor - partial.length;
  const items = META_COMMAND_COMPLETIONS.filter((item) => item.label.startsWith(partial)).map(
    (item): CompletionItem => ({ ...item, kind: 'meta' }),
  );
  return { items, from };
}

function completeInString(
  text: string,
  cursor: number,
  scan: ScanState,
  schema: ReplSchemaInfo,
): CompletionResult {
  const inString = scan.inString;
  if (!inString) return EMPTY;
  const frame = scan.openFrames[scan.openFrames.length - 1];
  if (!frame) return EMPTY;
  const chain = chainBeforeIndex(text, frame.openIndex, scan.stringMask);
  const subject = resolveSubject(chain, schema);
  if (!subject) return EMPTY;
  const methodName = chain[chain.length - 1]?.name ?? '';
  const ns = schema.namespaces[subject.namespace];
  if (!ns) return EMPTY;

  let items: CompletionItem[] = [];
  if (subject.kind === 'sqlTable' && SQL_COLUMN_ARG_METHODS.has(methodName)) {
    const table = ns.tables[subject.name];
    items = table ? tableColumns(table) : [];
  } else if (subject.kind === 'ormModel' && ORM_FIELD_ARG_METHODS.has(methodName)) {
    const model = ns.models[subject.name];
    items = model ? modelFields(model) : [];
  } else if (subject.kind === 'ormModel' && ORM_RELATION_ARG_METHODS.has(methodName)) {
    const model = ns.models[subject.name];
    items = model ? modelRelations(model) : [];
  } else {
    return EMPTY;
  }

  const partial = text.slice(inString.contentStart, cursor);
  return { items: filterItems(items, partial), from: cursor - partial.length };
}

function completeChain(
  segments: readonly ChainSegment[],
  schema: ReplSchemaInfo,
  params: Map<string, { subject: ChainSubject; position: number }>,
): readonly CompletionItem[] {
  const root = segments[0]?.name ?? '';

  if (root === 'db') {
    if (segments.length === 1) return DB_MEMBERS;
    const lane = segments[1]?.name;
    if (lane === 'sql' || lane === 'orm' || lane === 'enums') {
      if (segments.length === 2) return namespaceItems(schema);
      const ns = schema.namespaces[segments[2]?.name ?? ''];
      if (!ns) return [];
      if (segments.length === 3) {
        if (lane === 'sql') {
          return Object.entries(ns.tables).map(([name, table]) => ({
            label: name,
            insert: name,
            kind: 'table' as const,
            detail: `${table.columns.length} columns`,
          }));
        }
        if (lane === 'orm') {
          return Object.entries(ns.models).map(([name, model]) => ({
            label: name,
            insert: name,
            kind: 'model' as const,
            detail: `table ${model.table}`,
          }));
        }
        return Object.keys(ns.enums).map((name) => ({
          label: name,
          insert: name,
          kind: 'enum' as const,
        }));
      }
      if (lane === 'enums') {
        return segments.length === 4 ? ENUM_ACCESSOR_MEMBERS : [];
      }
      const subject = resolveSubject(segments, schema);
      if (!subject) return [];
      if (subject.kind === 'sqlTable') return sqlChainMethods(subject.method);
      return subject.method === null ? COLLECTION_ROOT_METHODS : COLLECTION_CHAIN_METHODS;
    }
    return [];
  }

  const param = params.get(root);
  if (param) {
    if (param.subject.kind === 'sqlTable') {
      if (param.position === 1) return segments.length === 1 ? SQL_FNS : [];
      return segments.length === 1 ? subjectMembers(param.subject, schema) : [];
    }
    if (segments.length === 1) return subjectMembers(param.subject, schema);
    if (segments.length === 2) {
      const model = schema.namespaces[param.subject.namespace]?.models[param.subject.name];
      const memberName = segments[1]?.name ?? '';
      if (model?.relations.includes(memberName)) return RELATION_PREDICATES;
      return ORM_COMPARISONS;
    }
    return [];
  }

  return [];
}

export function complete(
  buffer: string,
  cursor: number,
  schema: ReplSchemaInfo,
  extraGlobals: readonly string[] = [],
): CompletionResult {
  const text = buffer.slice(0, cursor);

  const meta = completeMeta(text, cursor);
  if (meta) return meta;

  const scan = scanSource(text);
  if (scan.inString) {
    return completeInString(text, cursor, scan, schema);
  }

  const partialMatch = text.match(/[A-Za-z_$][\w$]*$/);
  const partial = partialMatch?.[0] ?? '';
  const from = cursor - partial.length;
  const beforePartial = from;

  let dotIndex = beforePartial;
  while (dotIndex > 0 && /\s/.test(text[dotIndex - 1]!)) dotIndex--;
  const hasDot = dotIndex > 0 && text[dotIndex - 1] === '.';

  if (hasDot) {
    const segments = chainBeforeIndex(text, dotIndex - 1, scan.stringMask);
    if (segments.length === 0) return EMPTY;
    const params = lambdaParams(text, scan.openFrames, scan.stringMask, schema);
    const items = completeChain(segments, schema, params);
    return { items: filterItems(items, partial), from };
  }

  const globals = new Set([...DEFAULT_GLOBALS, ...extraGlobals]);
  const items: CompletionItem[] = [...globals].map((name) => ({
    label: name,
    insert: name,
    kind: 'global' as const,
  }));
  return { items: filterItems(items, partial), from };
}

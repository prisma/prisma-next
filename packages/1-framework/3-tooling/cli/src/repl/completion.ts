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
 *   collection methods, `(u) => u.field.eq(...)` lambda params, and nested
 *   callbacks (`include('posts', (p) => …)`, `u.posts.some((p) => …)`)
 *   resolved to the relation's target model.
 */
import { META_COMMAND_COMPLETIONS } from './meta-commands';
import { type OpenFrame, type SourceScan, scanSource } from './scan';
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
  'distinct',
  'distinctOn',
  'limit',
  'offset',
  'join',
  'leftJoin',
  'annotate',
  'build',
]);
const GROUPED_CHAIN_METHODS = methods([
  'having',
  'groupBy',
  'orderBy',
  'distinct',
  'distinctOn',
  'limit',
  'offset',
  'as',
  'annotate',
  'build',
]);
const INSERT_CHAIN_METHODS = methods(['returning', 'annotate', 'build']);
const UPDATE_DELETE_CHAIN_METHODS = methods(['where', 'returning', 'annotate', 'build']);
const RETURNING_CHAIN_METHODS = methods(['annotate', 'build']);

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
const COLLECTION_WRITE_METHODS = methods([
  'create',
  'createAll',
  'update',
  'updateAll',
  'upsert',
  'delete',
  'deleteAll',
]);
const COLLECTION_ROOT_METHODS = [...COLLECTION_CHAIN_METHODS, ...COLLECTION_WRITE_METHODS];
/** Methods available on an include-callback collection param. */
const INCLUDE_BUILDER_METHODS = methods([
  'select',
  'where',
  'include',
  'orderBy',
  'take',
  'skip',
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
const RELATION_PREDICATE_NAMES = new Set(['some', 'every', 'none']);

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
const SQL_LAMBDA_METHODS = new Set(['where', 'orderBy', 'groupBy', 'distinctOn', 'update']);
const ORM_LAMBDA_METHODS = new Set(['where', 'orderBy']);

interface ChainSegment {
  readonly name: string;
  readonly called: boolean;
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

/** What a lambda parameter name stands for at the cursor. */
type ParamBinding =
  | { readonly kind: 'sqlFields'; readonly namespace: string; readonly table: string }
  | { readonly kind: 'sqlFns' }
  | { readonly kind: 'ormFields'; readonly namespace: string; readonly model: string }
  | { readonly kind: 'ormCollection'; readonly namespace: string; readonly model: string };

type ParamMap = Map<string, ParamBinding>;

/** Resolved subject of a member chain (frame callee or cursor chain). */
type ChainContext =
  | {
      readonly kind: 'sqlTable';
      readonly namespace: string;
      readonly table: string;
      readonly method: string | null;
    }
  | {
      readonly kind: 'ormModel';
      readonly namespace: string;
      readonly model: string;
      readonly method: string | null;
    };

function modelInfo(
  schema: ReplSchemaInfo,
  namespace: string,
  model: string,
): ReplModelInfo | undefined {
  return schema.namespaces[namespace]?.models[model];
}

/**
 * Resolves the subject a chain acts on: `db.sql/orm` roots, or a lambda
 * param bound by an enclosing frame (collection params chain further;
 * fields params resolve through relation predicates).
 */
function resolveChainContext(
  segments: readonly ChainSegment[],
  schema: ReplSchemaInfo,
  params: ParamMap,
): ChainContext | null {
  const root = segments[0]?.name ?? '';

  if (root === 'db') {
    if (segments.length < 4) return null;
    const lane = segments[1]?.name;
    const namespace = segments[2]?.name ?? '';
    const ns = schema.namespaces[namespace];
    if (!ns) return null;
    const name = segments[3]?.name ?? '';
    const method = segments.length > 4 ? (segments[segments.length - 1]?.name ?? null) : null;
    if (lane === 'sql' && ns.tables[name]) {
      return { kind: 'sqlTable', namespace, table: name, method };
    }
    if (lane === 'orm' && ns.models[name]) {
      return { kind: 'ormModel', namespace, model: name, method };
    }
    return null;
  }

  const binding = params.get(root);
  if (!binding) return null;

  if (binding.kind === 'ormCollection') {
    const method = segments.length > 1 ? (segments[segments.length - 1]?.name ?? null) : null;
    return { kind: 'ormModel', namespace: binding.namespace, model: binding.model, method };
  }

  if (binding.kind === 'ormFields' && segments.length >= 3) {
    // `u.posts.some` — a relation predicate frame on the relation's target.
    const relation = segments[1]?.name ?? '';
    const predicate = segments[segments.length - 1]?.name ?? '';
    const model = modelInfo(schema, binding.namespace, binding.model);
    const target = model?.relationTargets[relation];
    if (target !== undefined && RELATION_PREDICATE_NAMES.has(predicate)) {
      return {
        kind: 'ormModel',
        namespace: target.namespace,
        model: target.model,
        method: predicate,
      };
    }
  }

  return null;
}

/** First quoted string inside a call's argument text, if any. */
function firstStringArg(argText: string): string | null {
  const match = argText.match(/['"]([\w$]+)['"]/);
  return match?.[1] ?? null;
}

/**
 * Binds lambda parameter names declared inside open call frames, outermost
 * first so inner callbacks shadow outer ones. Each frame's argument text is
 * clipped at the next frame's opening paren so an outer `where(` does not
 * claim the arrow of a nested callback.
 */
function lambdaParams(
  text: string,
  frames: readonly OpenFrame[],
  mask: readonly boolean[],
  schema: ReplSchemaInfo,
): ParamMap {
  const params: ParamMap = new Map();

  frames.forEach((frame, frameIndex) => {
    const chain = chainBeforeIndex(text, frame.openIndex, mask);
    const context = resolveChainContext(chain, schema, params);
    if (!context || context.method === null) return;

    const argEnd = frames[frameIndex + 1]?.openIndex ?? text.length;
    const argText = text.slice(frame.openIndex + 1, argEnd);
    const arrowMatches = [...argText.matchAll(/(?:\(([^()]*)\)|([A-Za-z_$][\w$]*))\s*=>/g)];
    const arrow = arrowMatches[arrowMatches.length - 1];
    if (!arrow) return;
    const names = (arrow[1] ?? arrow[2] ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter((p) => /^[A-Za-z_$][\w$]*$/.test(p));
    if (names.length === 0) return;

    if (context.kind === 'sqlTable' && SQL_LAMBDA_METHODS.has(context.method)) {
      const [fields, fns] = names;
      if (fields !== undefined) {
        params.set(fields, {
          kind: 'sqlFields',
          namespace: context.namespace,
          table: context.table,
        });
      }
      if (fns !== undefined) {
        params.set(fns, { kind: 'sqlFns' });
      }
      return;
    }

    if (context.kind !== 'ormModel') return;
    const param = names[0];
    if (param === undefined) return;

    if (ORM_LAMBDA_METHODS.has(context.method) || RELATION_PREDICATE_NAMES.has(context.method)) {
      params.set(param, {
        kind: 'ormFields',
        namespace: context.namespace,
        model: context.model,
      });
      return;
    }

    if (context.method === 'include') {
      const relation = firstStringArg(argText);
      const target =
        relation !== null
          ? modelInfo(schema, context.namespace, context.model)?.relationTargets[relation]
          : undefined;
      if (target !== undefined) {
        params.set(param, {
          kind: 'ormCollection',
          namespace: target.namespace,
          model: target.model,
        });
      }
    }
  });

  return params;
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
  if (subjectMethod === 'groupBy' || subjectMethod === 'having') return GROUPED_CHAIN_METHODS;
  return SELECT_CHAIN_METHODS;
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
  scan: SourceScan,
  schema: ReplSchemaInfo,
): CompletionResult {
  const inString = scan.inString;
  if (!inString) return EMPTY;
  const frame = scan.openFrames[scan.openFrames.length - 1];
  if (!frame) return EMPTY;
  const params = lambdaParams(text, scan.openFrames, scan.mask, schema);
  const chain = chainBeforeIndex(text, frame.openIndex, scan.mask);
  const context = resolveChainContext(chain, schema, params);
  if (!context || context.method === null) return EMPTY;
  const ns = schema.namespaces[context.namespace];
  if (!ns) return EMPTY;

  let items: CompletionItem[] = [];
  if (context.kind === 'sqlTable' && SQL_COLUMN_ARG_METHODS.has(context.method)) {
    const table = ns.tables[context.table];
    items = table ? tableColumns(table) : [];
  } else if (context.kind === 'ormModel' && ORM_FIELD_ARG_METHODS.has(context.method)) {
    const model = ns.models[context.model];
    items = model ? modelFields(model) : [];
  } else if (context.kind === 'ormModel' && ORM_RELATION_ARG_METHODS.has(context.method)) {
    const model = ns.models[context.model];
    items = model ? modelRelations(model) : [];
  } else {
    return EMPTY;
  }

  const partial = text.slice(inString.contentStart, cursor);
  return { items: filterItems(items, partial), from: cursor - partial.length };
}

function completeParamChain(
  segments: readonly ChainSegment[],
  binding: ParamBinding,
  schema: ReplSchemaInfo,
): readonly CompletionItem[] {
  switch (binding.kind) {
    case 'sqlFns':
      return segments.length === 1 ? SQL_FNS : [];
    case 'sqlFields': {
      if (segments.length !== 1) return [];
      const table = schema.namespaces[binding.namespace]?.tables[binding.table];
      return table ? tableColumns(table) : [];
    }
    case 'ormCollection':
      return INCLUDE_BUILDER_METHODS;
    case 'ormFields': {
      const model = modelInfo(schema, binding.namespace, binding.model);
      if (!model) return [];
      if (segments.length === 1) return [...modelFields(model), ...modelRelations(model)];
      if (segments.length === 2) {
        const memberName = segments[1]?.name ?? '';
        return model.relations.includes(memberName) ? RELATION_PREDICATES : ORM_COMPARISONS;
      }
      return [];
    }
  }
}

function completeChain(
  segments: readonly ChainSegment[],
  schema: ReplSchemaInfo,
  params: ParamMap,
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
      const context = resolveChainContext(segments, schema, params);
      if (!context) return [];
      if (context.kind === 'sqlTable') return sqlChainMethods(context.method);
      return context.method === null ? COLLECTION_ROOT_METHODS : COLLECTION_CHAIN_METHODS;
    }
    return [];
  }

  const binding = params.get(root);
  if (binding) return completeParamChain(segments, binding, schema);

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

  let dotIndex = from;
  while (dotIndex > 0 && /\s/.test(text[dotIndex - 1]!)) dotIndex--;
  const hasDot = dotIndex > 0 && text[dotIndex - 1] === '.';

  if (hasDot) {
    const segments = chainBeforeIndex(text, dotIndex - 1, scan.mask);
    if (segments.length === 0) return EMPTY;
    const params = lambdaParams(text, scan.openFrames, scan.mask, schema);
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

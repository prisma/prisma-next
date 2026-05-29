import type { ImportRequirement } from './ts-expression';

/**
 * Render an aggregated `import` block from a flat list of
 * `ImportRequirement`s. Each target's migration renderer collects
 * requirements polymorphically from its call nodes and pipes them here.
 *
 * The emitter invariants:
 *
 * - **One line per module specifier.** Named imports are aggregated and
 *   emitted sorted; a single default symbol is combined onto the same line
 *   when attributes agree (`import def, { a, b } from "m";`). Aliased symbols
 *   render `symbol as alias`. When every symbol for a module is `typeOnly`,
 *   the statement collapses to `import type { … }`; a module mixing value
 *   and type symbols prefixes the type-only ones (`import { type T, v }`).
 *   Exception: a fully type-only statement that has both a default and one or
 *   more named bindings splits to two lines (`import type D from "m";` then
 *   `import type { N } from "m";`) because TypeScript rejects
 *   `import type D, { N } from "m"` (TS1363).
 * - **At most one default symbol per module.** Two conflicting default
 *   symbols on the same specifier throw — the user's renderer can't
 *   guess which one they meant.
 * - **Attribute unanimity per module.** All requirements for the same
 *   module specifier must carry the same (or no) `attributes` map.
 *   Divergent attribute maps throw — they can't collapse to one line
 *   and there's no user-resolvable recovery at this layer.
 * - **Distinct (symbol, alias) pairs are distinct bindings.** TypeScript
 *   permits importing the same export under multiple local names, so
 *   `{ A }` + `{ A as B }` renders as `import { A, A as B } from "m"` and
 *   `{ A as B }` + `{ A as C }` renders as `import { A as B, A as C } from "m"`.
 *   Truly identical `(symbol, alias)` pairs still collapse to one binding,
 *   merging `typeOnly` by AND.
 * - **Deterministic ordering.** Modules are emitted sorted by specifier;
 *   within a module, named bindings are emitted sorted by `(symbol, alias)`
 *   using JavaScript code-unit comparison, with the un-aliased form (no
 *   alias) treated as alias `""` so it sorts before any aliased form of the
 *   same symbol.
 *
 * Returns a string containing one import line per module, joined by `\n`
 * (no trailing newline). An empty requirement list returns `""`.
 */
export function renderImports(requirements: readonly ImportRequirement[]): string {
  const byModule = aggregateByModule(requirements);
  const entries = [...byModule.entries()].sort(([a], [b]) => a.localeCompare(b));
  return entries
    .map(([moduleSpecifier, group]) => renderModuleImport(moduleSpecifier, group))
    .join('\n');
}

interface NamedBinding {
  symbol: string;
  alias: string | null;
  typeOnly: boolean;
}

interface ModuleImportGroup {
  readonly named: Map<string, NamedBinding>;
  defaultSymbol: string | null;
  defaultTypeOnly: boolean;
  attributes: Readonly<Record<string, string>> | null;
  attributesSet: boolean;
}

function aggregateByModule(
  requirements: readonly ImportRequirement[],
): Map<string, ModuleImportGroup> {
  const byModule = new Map<string, ModuleImportGroup>();
  for (const req of requirements) {
    let group = byModule.get(req.moduleSpecifier);
    if (!group) {
      group = {
        named: new Map(),
        defaultSymbol: null,
        defaultTypeOnly: true,
        attributes: null,
        attributesSet: false,
      };
      byModule.set(req.moduleSpecifier, group);
    }
    mergeRequirementIntoGroup(req, group);
  }
  return byModule;
}

function mergeRequirementIntoGroup(req: ImportRequirement, group: ModuleImportGroup): void {
  const kind = req.kind ?? 'named';
  const typeOnly = req.typeOnly === true;
  if (kind === 'default') {
    if (group.defaultSymbol !== null && group.defaultSymbol !== req.symbol) {
      throw new Error(
        `Conflicting default imports for module "${req.moduleSpecifier}": ` +
          `"${group.defaultSymbol}" and "${req.symbol}". Only one default symbol is allowed per module.`,
      );
    }
    group.defaultSymbol = req.symbol;
    group.defaultTypeOnly = group.defaultTypeOnly && typeOnly;
  } else {
    const alias = req.alias && req.alias !== req.symbol ? req.alias : null;
    const key = namedBindingKey(req.symbol, alias);
    const existing = group.named.get(key);
    if (existing) {
      existing.typeOnly = existing.typeOnly && typeOnly;
    } else {
      group.named.set(key, { symbol: req.symbol, alias, typeOnly });
    }
  }
  mergeAttributes(req, group);
}

function mergeAttributes(req: ImportRequirement, group: ModuleImportGroup): void {
  const incoming = req.attributes ?? null;
  if (!group.attributesSet) {
    group.attributes = incoming;
    group.attributesSet = true;
    return;
  }
  if (!attributesEqual(group.attributes, incoming)) {
    throw new Error(
      `Conflicting import attributes for module "${req.moduleSpecifier}": ` +
        `${stringifyAttributes(group.attributes)} vs ${stringifyAttributes(incoming)}.`,
    );
  }
}

function attributesEqual(
  a: Readonly<Record<string, string>> | null,
  b: Readonly<Record<string, string>> | null,
): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i++) {
    const key = aKeys[i];
    if (key !== bKeys[i]) return false;
    if (a[key as string] !== b[key as string]) return false;
  }
  return true;
}

function stringifyAttributes(attrs: Readonly<Record<string, string>> | null): string {
  if (attrs === null) return '(none)';
  const entries = Object.entries(attrs)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return `{ ${entries.join(', ')} }`;
}

function renderModuleImport(moduleSpecifier: string, group: ModuleImportGroup): string {
  const typeOnlyStatement = isStatementTypeOnly(group);
  const attrs = buildAttributesClause(group.attributes);
  const hasDefault = group.defaultSymbol !== null;
  const hasNamed = group.named.size > 0;
  if (typeOnlyStatement && hasDefault && hasNamed) {
    const defaultLine = `import type ${group.defaultSymbol} from '${moduleSpecifier}'${attrs};`;
    const namedClause = renderNamedBindingsList(group, true);
    const namedLine = `import type { ${namedClause} } from '${moduleSpecifier}'${attrs};`;
    return `${defaultLine}\n${namedLine}`;
  }
  const keyword = typeOnlyStatement ? 'import type' : 'import';
  const clause = buildImportClause(group, typeOnlyStatement);
  return `${keyword} ${clause} from '${moduleSpecifier}'${attrs};`;
}

function isStatementTypeOnly(group: ModuleImportGroup): boolean {
  const hasDefault = group.defaultSymbol !== null;
  const hasNamed = group.named.size > 0;
  if (!hasDefault && !hasNamed) return false;
  if (hasDefault && !group.defaultTypeOnly) return false;
  for (const binding of group.named.values()) {
    if (!binding.typeOnly) return false;
  }
  return true;
}

function buildImportClause(group: ModuleImportGroup, statementTypeOnly: boolean): string {
  const hasNamed = group.named.size > 0;
  const hasDefault = group.defaultSymbol !== null;
  const namedClause = hasNamed ? renderNamedBindingsList(group, statementTypeOnly) : '';
  if (hasDefault && hasNamed) {
    return `${group.defaultSymbol}, { ${namedClause} }`;
  }
  if (hasDefault) {
    return group.defaultSymbol as string;
  }
  return `{ ${namedClause} }`;
}

function renderNamedBindingsList(group: ModuleImportGroup, statementTypeOnly: boolean): string {
  return [...group.named.values()]
    .sort(compareNamedBindings)
    .map((binding) => renderNamedBinding(binding, statementTypeOnly))
    .join(', ');
}

function compareNamedBindings(a: NamedBinding, b: NamedBinding): number {
  if (a.symbol !== b.symbol) return a.symbol < b.symbol ? -1 : 1;
  const aAlias = a.alias ?? '';
  const bAlias = b.alias ?? '';
  if (aAlias === bAlias) return 0;
  return aAlias < bAlias ? -1 : 1;
}

function namedBindingKey(symbol: string, alias: string | null): string {
  return `${symbol}\x00${alias ?? ''}`;
}

function renderNamedBinding(binding: NamedBinding, statementTypeOnly: boolean): string {
  const prefix = !statementTypeOnly && binding.typeOnly ? 'type ' : '';
  const aliasClause = binding.alias !== null ? ` as ${binding.alias}` : '';
  return `${prefix}${binding.symbol}${aliasClause}`;
}

function buildAttributesClause(attrs: Readonly<Record<string, string>> | null): string {
  if (attrs === null) return '';
  const entries = Object.entries(attrs)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  if (entries.length === 0) return '';
  return ` with { ${entries.join(', ')} }`;
}

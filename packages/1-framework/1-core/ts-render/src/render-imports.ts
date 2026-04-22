import type { ImportRequirement } from './ts-expression';

/**
 * Render an aggregated `import` block from a flat list of
 * `ImportRequirement`s. Each target's class-flow renderer collects
 * requirements polymorphically from its call nodes and pipes them here.
 *
 * The emitter invariants:
 *
 * - **One line per module specifier.** Named imports are aggregated and
 *   emitted sorted alphabetically; a single default symbol is combined
 *   onto the same line when attributes agree (`import def, { a, b } from "m";`).
 * - **At most one default symbol per module.** Two conflicting default
 *   symbols on the same specifier throw — the user's renderer can't
 *   guess which one they meant.
 * - **Attribute unanimity per module.** All requirements for the same
 *   module specifier must carry the same (or no) `attributes` map.
 *   Divergent attribute maps throw — they can't collapse to one line
 *   and there's no user-resolvable recovery at this layer.
 * - **Deterministic ordering.** Modules are emitted sorted by specifier;
 *   within a module, named symbols are emitted sorted alphabetically.
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

interface ModuleImportGroup {
  readonly named: Set<string>;
  defaultSymbol: string | null;
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
      group = { named: new Set(), defaultSymbol: null, attributes: null, attributesSet: false };
      byModule.set(req.moduleSpecifier, group);
    }
    mergeRequirementIntoGroup(req, group);
  }
  return byModule;
}

function mergeRequirementIntoGroup(req: ImportRequirement, group: ModuleImportGroup): void {
  const kind = req.kind ?? 'named';
  if (kind === 'default') {
    if (group.defaultSymbol !== null && group.defaultSymbol !== req.symbol) {
      throw new Error(
        `Conflicting default imports for module "${req.moduleSpecifier}": ` +
          `"${group.defaultSymbol}" and "${req.symbol}". Only one default symbol is allowed per module.`,
      );
    }
    group.defaultSymbol = req.symbol;
  } else {
    group.named.add(req.symbol);
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
  const clause = buildImportClause(group);
  const attrs = buildAttributesClause(group.attributes);
  return `import ${clause} from '${moduleSpecifier}'${attrs};`;
}

function buildImportClause(group: ModuleImportGroup): string {
  const named = [...group.named].sort();
  const hasNamed = named.length > 0;
  const hasDefault = group.defaultSymbol !== null;
  if (hasDefault && hasNamed) {
    return `${group.defaultSymbol}, { ${named.join(', ')} }`;
  }
  if (hasDefault) {
    return group.defaultSymbol as string;
  }
  return `{ ${named.join(', ')} }`;
}

function buildAttributesClause(attrs: Readonly<Record<string, string>> | null): string {
  if (attrs === null) return '';
  const entries = Object.entries(attrs)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  if (entries.length === 0) return '';
  return ` with { ${entries.join(', ')} }`;
}

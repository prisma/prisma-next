import { UNSPECIFIED_PSL_NAMESPACE_ID } from '@prisma-next/framework-components/psl-ast';
import type { Resolver, TypeTarget } from './resolve';
import {
  CompositeTypeDeclarationAst,
  type DocumentAst,
  GenericBlockDeclarationAst,
  ModelDeclarationAst,
  type NamedTypeDeclarationAst,
  NamespaceDeclarationAst,
  TypesBlockAst,
} from './syntax/ast/declarations';
import type { SyntaxNode } from './syntax/red';

/**
 * One declared name in a namespace's scope: a kind-ful declaration (a model or
 * composite type) or a named generic block (carrying the keyword that defined
 * it). Named types live in the document-level {@link NameTable.namedTypes} set,
 * not in a scope. A block and a same-named model collide like two models would —
 * a name maps to exactly one symbol, first-declaration-wins.
 */
export type ScopeSymbol =
  | { readonly kind: 'model'; readonly node: ModelDeclarationAst }
  | { readonly kind: 'compositeType'; readonly node: CompositeTypeDeclarationAst }
  | { readonly kind: 'block'; readonly keyword: string; readonly node: GenericBlockDeclarationAst };

/**
 * The names visible while binding a written type reference to a target. A bare
 * (unqualified) name resolves in, and only in: scalars ∪ document-level named
 * types ∪ the current namespace's scope ∪ the top-level / unspecified namespace
 * ({@link UNSPECIFIED_PSL_NAMESPACE_ID}, which is ambient — it has no prefix to
 * qualify with). A declaration that lives only in some other *named* namespace
 * must be referenced fully-qualified (`ns.Name`); a bare name found in none of
 * the allowed scopes is `unresolved`. A qualified `ns.Type` reference resolves
 * against the named namespace's scope exactly.
 *
 * Each scope is one source-ordered, first-wins {@link ScopeSymbol} map — the same
 * map the resolver reads to classify a reference (model/composite → `ref`, block →
 * `block`) and `buildNamespace` reads to emit the resolved entities, so the name
 * table and the resolved document can never disagree on what a name is.
 *
 * The live SQL interpreter's bare-name path is instead flat document-wide
 * last-wins, so a bare name shared across namespaces resolves differently there.
 * That divergence is deliberate: cross-namespace bare references the legacy path
 * accepted now require qualification under this resolver, to be reconciled when
 * the interpreter migrates onto it.
 */
export interface NameTable {
  readonly scopes: ReadonlyMap<string, ReadonlyMap<string, ScopeSymbol>>;
  readonly namedTypes: ReadonlySet<string>;
}

/**
 * A namespace's scope under construction: a source-ordered, first-wins
 * {@link ScopeSymbol} table plus every generic block in declaration order. The
 * symbols back both type resolution and `buildNamespace`, so the two can never
 * disagree on what a name is. `genericBlocks` keeps *every* block — named or
 * anonymous, collision winner or loser — because extension-block validation runs
 * over all of them, independent of the declaration name-space.
 */
export interface MutableScope {
  readonly id: string;
  readonly syntax?: NamespaceDeclarationAst;
  readonly symbols: Map<string, ScopeSymbol>;
  readonly genericBlocks: GenericBlockDeclarationAst[];
}

/** What name-table construction hands back to the resolve orchestration: the
 * read-only {@link NameTable}, plus the per-namespace {@link MutableScope}s and
 * their source order needed to build resolved namespaces, and the collected
 * named-type declarations needed for the named-type pass. */
export interface NameTableBuild {
  readonly nameTable: NameTable;
  readonly scopes: Map<string, MutableScope>;
  readonly scopeOrder: string[];
  readonly namedTypeDecls: NamedTypeDeclarationAst[];
}

/**
 * Walks the parsed {@link DocumentAst} once to build the document's
 * {@link NameTable}: every namespace scope (source-ordered, first-declaration-wins)
 * plus the document-level named-type names. Duplicate declarations — within a
 * scope or among named types — are reported via `resolver.diagnostic` on the later
 * occurrence and otherwise dropped, so the resulting table holds exactly the
 * winning symbols.
 */
export function buildNameTable(document: DocumentAst, resolver: Resolver): NameTableBuild {
  const collector = new ScopeCollector(resolver);
  const namedTypeDecls = collectDeclarations(document, collector);
  const namedTypeNames = collectNamedTypeNames(namedTypeDecls, resolver);
  const nameTable: NameTable = {
    scopes: projectScopeSymbols(collector.scopes),
    namedTypes: namedTypeNames,
  };

  return { nameTable, scopes: collector.scopes, scopeOrder: collector.scopeOrder, namedTypeDecls };
}

function reportDuplicateDeclaration(resolver: Resolver, name: string, syntax: SyntaxNode): void {
  resolver.diagnostic(
    'PSL_DUPLICATE_DECLARATION',
    `Duplicate declaration "${name}" in this scope; the first declaration is used`,
    syntax,
  );
}

/** Owns the per-namespace {@link MutableScope}s and their source order, and
 * inserts declarations first-declaration-wins. */
class ScopeCollector {
  readonly scopes = new Map<string, MutableScope>();
  readonly scopeOrder: string[] = [];

  constructor(private readonly resolver: Resolver) {}

  getScope(id: string, syntax?: NamespaceDeclarationAst): MutableScope {
    const existing = this.scopes.get(id);
    if (existing) return existing;
    const scope: MutableScope = {
      id,
      ...(syntax ? { syntax } : {}),
      symbols: new Map(),
      genericBlocks: [],
    };
    this.scopes.set(id, scope);
    this.scopeOrder.push(id);
    return scope;
  }

  // Insert a declaration into a scope, first-declaration-wins: a name already
  // taken (by any kind, in source order) yields a duplicate-declaration
  // diagnostic on the later occurrence and is otherwise ignored.
  declare(scope: MutableScope, name: string | undefined, symbol: ScopeSymbol): void {
    if (name === undefined) return;
    if (scope.symbols.has(name)) {
      reportDuplicateDeclaration(this.resolver, name, symbol.node.syntax);
      return;
    }
    scope.symbols.set(name, symbol);
  }

  collectMember(scope: MutableScope, member: SyntaxNode): void {
    const model = ModelDeclarationAst.cast(member);
    if (model) {
      this.declare(scope, model.name()?.name(), { kind: 'model', node: model });
      return;
    }
    const composite = CompositeTypeDeclarationAst.cast(member);
    if (composite) {
      this.declare(scope, composite.name()?.name(), { kind: 'compositeType', node: composite });
      return;
    }
    const block = GenericBlockDeclarationAst.cast(member);
    if (block) {
      scope.genericBlocks.push(block);
      const keyword = block.keyword()?.text;
      if (keyword !== undefined) {
        this.declare(scope, block.name()?.name(), { kind: 'block', keyword, node: block });
      }
    }
  }
}

/** Walks the document once, routing namespace declarations and top-level members
 * into the collector's scopes and accumulating types-block named declarations. */
function collectDeclarations(
  document: DocumentAst,
  collector: ScopeCollector,
): NamedTypeDeclarationAst[] {
  const namedTypeDecls: NamedTypeDeclarationAst[] = [];
  for (const declaration of document.declarations()) {
    const namespaceDecl = NamespaceDeclarationAst.cast(declaration.syntax);
    if (namespaceDecl) {
      const id = namespaceDecl.name()?.name();
      if (id === undefined) continue;
      const scope = collector.getScope(id, namespaceDecl);
      for (const member of namespaceDecl.declarations()) {
        collector.collectMember(scope, member.syntax);
      }
      continue;
    }
    const typesBlock = TypesBlockAst.cast(declaration.syntax);
    if (typesBlock) {
      for (const named of typesBlock.declarations()) {
        namedTypeDecls.push(named);
      }
      continue;
    }
    collector.collectMember(collector.getScope(UNSPECIFIED_PSL_NAMESPACE_ID), declaration.syntax);
  }
  return namedTypeDecls;
}

/** Document-level named-type names, first-declaration-wins: a duplicate name
 * yields a diagnostic on the later occurrence and is otherwise dropped. */
function collectNamedTypeNames(
  namedTypeDecls: NamedTypeDeclarationAst[],
  resolver: Resolver,
): Set<string> {
  const namedTypeNames = new Set<string>();
  for (const declaration of namedTypeDecls) {
    const name = declaration.name()?.name();
    if (name === undefined) continue;
    if (namedTypeNames.has(name)) {
      reportDuplicateDeclaration(resolver, name, declaration.syntax);
      continue;
    }
    namedTypeNames.add(name);
  }
  return namedTypeNames;
}

/** The read-only scope-symbols view of the collected scopes the {@link NameTable}
 * exposes. */
function projectScopeSymbols(
  scopes: Map<string, MutableScope>,
): Map<string, ReadonlyMap<string, ScopeSymbol>> {
  const scopeSymbols = new Map<string, ReadonlyMap<string, ScopeSymbol>>();
  for (const [id, scope] of scopes) scopeSymbols.set(id, scope.symbols);
  return scopeSymbols;
}

/** A scope symbol as a resolved {@link TypeTarget}: a block becomes a `block`
 * target, any kind-ful declaration a `ref` carrying its `DeclKind`. */
export function symbolTarget(symbol: ScopeSymbol, namespaceId: string, name: string): TypeTarget {
  return symbol.kind === 'block'
    ? { kind: 'block', namespaceId, name }
    : { kind: 'ref', coord: { kind: symbol.kind, namespaceId, name } };
}

/**
 * Message for a bare name that resolves in none of the allowed scopes. When the
 * name is declared in exactly one *other named* namespace, the message carries a
 * "did you mean `ns.Name`?" hint pointing at the qualification it now requires;
 * otherwise it is the plain unresolved message.
 */
export function unresolvedBareNameMessage(
  typeName: string,
  currentNamespaceId: string,
  nameTable: NameTable,
): string {
  const otherNamespaces: string[] = [];
  for (const [namespaceId, scope] of nameTable.scopes) {
    if (namespaceId === currentNamespaceId || namespaceId === UNSPECIFIED_PSL_NAMESPACE_ID)
      continue;
    if (scope.has(typeName)) otherNamespaces.push(namespaceId);
  }
  const base = `Type "${typeName}" does not resolve to a known declaration`;
  return otherNamespaces.length === 1
    ? `${base}; did you mean "${otherNamespaces[0]}.${typeName}"?`
    : base;
}

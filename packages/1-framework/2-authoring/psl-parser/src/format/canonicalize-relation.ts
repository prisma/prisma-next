import type { GreenElement, GreenNode, GreenToken } from '../syntax/green';
import { greenNode, greenToken } from '../syntax/green';
import type { SyntaxKind } from '../syntax/syntax-kind';
import type { TokenKind } from '../tokenizer';

const RELATION_KEYWORD_RENAMES: ReadonlyMap<string, string> = new Map([
  ['fields', 'from'],
  ['references', 'to'],
]);

/**
 * Rewrites legacy `@relation` argument keys (`fields`→`from`, `references`→`to`)
 * to the canonical directional vocabulary, touching the key token only.
 * Argument values, brackets, the `name:` argument, and all trivia are carried by
 * reference, so comments and column alignment survive the rewrite untouched.
 */
export function canonicalizeRelationKeywords(document: GreenNode): GreenNode {
  return rewriteNode(document);
}

function rewriteNode(node: GreenNode): GreenNode {
  if (isRelationAttribute(node)) {
    return rebuildChildren(node, (child) =>
      child.type === 'node' && child.kind === 'AttributeArgList'
        ? rewriteArgList(child)
        : passthrough(child),
    );
  }
  return rebuildChildren(node, passthrough);
}

function rewriteArgList(argList: GreenNode): GreenNode {
  return rebuildChildren(argList, (child) =>
    child.type === 'node' && child.kind === 'AttributeArg' ? rewriteArg(child) : passthrough(child),
  );
}

/**
 * Rewrites the key of a single `AttributeArg`. A key exists only when the arg
 * carries a `Colon`; the key `Identifier` is then the first `Identifier` child,
 * by the grammar (`Ident Colon value`). The first identifier is the only one
 * considered, so a bare-identifier value spelled `fields`/`references` in the
 * value position is carried through untouched.
 */
function rewriteArg(arg: GreenNode): GreenNode {
  if (!hasChildToken(arg, 'Colon')) return rebuildChildren(arg, passthrough);
  let keySeen = false;
  return rebuildChildren(arg, (child) => {
    if (keySeen || child.type !== 'node' || child.kind !== 'Identifier') {
      return passthrough(child);
    }
    keySeen = true;
    return renameKeyIdentifier(child);
  });
}

function renameKeyIdentifier(identifier: GreenNode): GreenNode {
  const identToken = firstIdentToken(identifier);
  if (identToken === undefined) return identifier;
  const replacement = RELATION_KEYWORD_RENAMES.get(identToken.text);
  if (replacement === undefined) return identifier;
  return rebuildChildren(identifier, (child) =>
    child === identToken ? greenToken('Ident', replacement) : passthrough(child),
  );
}

function passthrough(child: GreenElement): GreenElement {
  return child.type === 'node' ? rewriteNode(child) : child;
}

/**
 * Rebuilds a node by mapping each child, returning the original node by
 * reference when nothing changed so untouched subtrees keep their identity.
 */
function rebuildChildren(node: GreenNode, map: (child: GreenElement) => GreenElement): GreenNode {
  let changed = false;
  const children: GreenElement[] = [];
  for (const child of node.children) {
    const next = map(child);
    if (next !== child) changed = true;
    children.push(next);
  }
  return changed ? greenNode(node.kind, children) : node;
}

/** Whether the node is a `@relation` / `@@relation` attribute, by its name token. */
function isRelationAttribute(node: GreenNode): boolean {
  if (node.kind !== 'FieldAttribute' && node.kind !== 'ModelAttribute') return false;
  const name = attributeName(node);
  return name === 'relation';
}

/**
 * The attribute's bare name — the single identifier segment of its
 * `QualifiedName`. A namespace-qualified attribute (more than one segment) is
 * not the built-in `@relation`, so it reports `undefined`.
 */
function attributeName(attribute: GreenNode): string | undefined {
  const qualified = firstChildNode(attribute, 'QualifiedName');
  if (qualified === undefined) return undefined;
  const segments = childNodes(qualified, 'Identifier');
  if (segments.length !== 1) return undefined;
  return firstIdentToken(segments[0])?.text;
}

function firstChildNode(node: GreenNode, kind: SyntaxKind): GreenNode | undefined {
  for (const child of node.children) {
    if (child.type === 'node' && child.kind === kind) return child;
  }
  return undefined;
}

function childNodes(node: GreenNode, kind: SyntaxKind): GreenNode[] {
  const out: GreenNode[] = [];
  for (const child of node.children) {
    if (child.type === 'node' && child.kind === kind) out.push(child);
  }
  return out;
}

function firstIdentToken(node: GreenNode | undefined): GreenToken | undefined {
  if (node === undefined) return undefined;
  for (const child of node.children) {
    if (child.type === 'token' && child.kind === 'Ident') return child;
  }
  return undefined;
}

/** Whether the node has a direct token child of the given kind. */
function hasChildToken(node: GreenNode, kind: TokenKind): boolean {
  for (const child of node.children) {
    if (child.type === 'token' && child.kind === kind) return true;
  }
  return false;
}

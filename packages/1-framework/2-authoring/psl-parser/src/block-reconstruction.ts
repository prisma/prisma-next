import type { AuthoringPslBlockDescriptor } from '@prisma-next/framework-components/authoring';
import type {
  PslBlockParam,
  PslExtensionBlock,
  PslExtensionBlockAttribute,
  PslExtensionBlockParamValue,
  PslSpan,
} from '@prisma-next/framework-components/psl-ast';
import type { ParseDiagnostic } from './parse';
import { nodePslSpan } from './resolve';
import type { SourceFile } from './source-file';
import type { GenericBlockDeclarationAst, KeyValuePairAst } from './syntax/ast/declarations';
import { ArrayLiteralAst, type ExpressionAst } from './syntax/ast/expressions';
import { printSyntax } from './syntax/ast-helpers';

/**
 * Reconstruct a descriptor-driven {@link PslExtensionBlock} from a CST
 * `GenericBlockDeclarationAst` (a `BlockSymbol.node`).
 *
 * When a {@link AuthoringPslBlockDescriptor} is supplied, each `key = value`
 * member is classified into its declared `ref` / `option` / `value` / `list`
 * shape and `kind` is the descriptor's discriminator. When no descriptor is
 * registered for the block's keyword (`descriptor === undefined`), the block is
 * reconstructed descriptor-free: `kind` is the raw keyword and every member is a
 * `bare`/`value` stub — matching the legacy descriptor-free variadic-block path.
 * Members not declared by a present descriptor likewise fall back to `value`
 * stubs so the validator's unknown-parameter detection still fires.
 *
 * First occurrence of a duplicate member name wins; each later occurrence is
 * dropped and flagged with `PSL_EXTENSION_DUPLICATE_PARAMETER` into the supplied
 * diagnostics sink (parity with the legacy descriptor-driven parser). Never
 * throws.
 */
export function reconstructExtensionBlock(
  node: GenericBlockDeclarationAst,
  descriptor: AuthoringPslBlockDescriptor | undefined,
  sourceFile: SourceFile,
  diagnostics: ParseDiagnostic[],
): PslExtensionBlock {
  const keyword = node.keyword()?.text ?? '';
  const blockName = node.name()?.name() ?? '';

  const blockAttributes: PslExtensionBlockAttribute[] = [];
  for (const attribute of node.attributes()) {
    const name = attribute.name()?.path().join('.') ?? '';
    const args = Array.from(attribute.argList()?.args() ?? [], (arg) => {
      const value = arg.value();
      return {
        kind: 'positional' as const,
        value: value === undefined ? '' : printSyntax(value.syntax).trim(),
        span: nodePslSpan(arg.syntax, sourceFile),
      };
    });
    blockAttributes.push({
      name,
      args,
      span: nodePslSpan(attribute.syntax, sourceFile),
    });
  }

  const parameters: Record<string, PslExtensionBlockParamValue> = {};
  for (const entry of node.entries()) {
    const key = entry.key()?.name();
    if (key === undefined) continue;
    const span = nodePslSpan(entry.syntax, sourceFile);
    if (Object.hasOwn(parameters, key)) {
      diagnostics.push({
        code: 'PSL_EXTENSION_DUPLICATE_PARAMETER',
        message: `Duplicate parameter "${key}" in "${keyword}" block "${blockName}"; first occurrence wins`,
        range: {
          start: sourceFile.positionAt(entry.syntax.offset),
          end: sourceFile.positionAt(entry.syntax.offset + entry.syntax.green.textLength),
        },
      });
      continue;
    }
    parameters[key] = reconstructParamValue(entry, descriptor?.parameters[key], span, sourceFile);
  }

  return {
    kind: descriptor?.discriminator ?? keyword,
    name: blockName,
    parameters,
    blockAttributes,
    span: nodePslSpan(node.syntax, sourceFile),
  };
}

function reconstructParamValue(
  entry: KeyValuePairAst,
  param: PslBlockParam | undefined,
  span: PslSpan,
  sourceFile: SourceFile,
): PslExtensionBlockParamValue {
  const value = entry.value();
  if (value === undefined) {
    return { kind: 'bare', span };
  }
  return reconstructFromExpression(value, param, span, sourceFile);
}

function reconstructFromExpression(
  value: ExpressionAst,
  param: PslBlockParam | undefined,
  span: PslSpan,
  sourceFile: SourceFile,
): PslExtensionBlockParamValue {
  if (param?.kind === 'list') {
    const array = ArrayLiteralAst.cast(value.syntax);
    const items: PslExtensionBlockParamValue[] = [];
    if (array) {
      for (const element of array.elements()) {
        items.push(
          reconstructFromExpression(
            element,
            param.of,
            nodePslSpan(element.syntax, sourceFile),
            sourceFile,
          ),
        );
      }
    }
    return { kind: 'list', items, span };
  }

  const raw = printSyntax(value.syntax).trim();
  switch (param?.kind) {
    case 'ref':
      return { kind: 'ref', identifier: raw, span };
    case 'option':
      return { kind: 'option', token: raw, span };
    default:
      // `value`-kind parameters and members absent from the descriptor both
      // become `value` stubs: the descriptor-free fallback keeps the validator's
      // unknown-parameter detection (key-set difference) working unchanged.
      return { kind: 'value', raw, span };
  }
}

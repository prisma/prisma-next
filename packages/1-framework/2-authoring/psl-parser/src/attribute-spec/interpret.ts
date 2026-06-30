import type {
  PslDiagnostic,
  PslDiagnosticCode,
  PslSpan,
} from '@prisma-next/framework-components/psl-ast';
import { blindCast } from '@prisma-next/utils/casts';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { nodePslSpan } from '../resolve';
import type { FieldAttributeAst, ModelAttributeAst } from '../syntax/ast/attributes';
import type { AttributeArgAst } from '../syntax/ast/expressions';
import type { ArgType, AttributeSpec, InterpretCtx, OptionalArgType, Param } from './types';

const DEFAULT_STRUCTURAL_CODE: PslDiagnosticCode = 'PSL_INVALID_ATTRIBUTE_SYNTAX';

/**
 * Interprets an attribute node against its spec: binds positional arguments in
 * order and named arguments by key into one flat output keyspace, honours the
 * positional-or-named alias, rejects unknown named arguments, applies optional
 * defaults, then runs `refine`. Returns the spec-inferred output or diagnostics.
 */
export function interpretAttribute<Out>(
  attrNode: FieldAttributeAst | ModelAttributeAst,
  spec: AttributeSpec<Out>,
  ctx: InterpretCtx,
): Result<Out, readonly PslDiagnostic[]> {
  const diagnostics: PslDiagnostic[] = [];
  const code = spec.diagnosticCode ?? DEFAULT_STRUCTURAL_CODE;
  const leafCtx: InterpretCtx = { ...ctx, diagnosticCode: code };
  const attributeSpan = nodePslSpan(attrNode.syntax, ctx.sourceFile);

  const positionalArgs: AttributeArgAst[] = [];
  const namedArgs: AttributeArgAst[] = [];
  for (const arg of attrNode.argList()?.args() ?? []) {
    if (arg.name() === undefined) positionalArgs.push(arg);
    else namedArgs.push(arg);
  }

  const namedSeen = new Set<string>();
  const namedParsed = new Map<string, unknown>();
  for (const arg of namedArgs) {
    const key = arg.name()?.name();
    if (key === undefined) continue;
    const param = Object.hasOwn(spec.named, key) ? spec.named[key] : undefined;
    if (param === undefined) {
      diagnostics.push(
        diagnostic(
          code,
          `Attribute "${spec.name}" received unknown argument "${key}"`,
          ctx,
          nodePslSpan(arg.syntax, ctx.sourceFile),
        ),
      );
      continue;
    }
    if (namedSeen.has(key)) {
      diagnostics.push(
        diagnostic(
          code,
          `Attribute "${spec.name}" received duplicate argument "${key}"`,
          ctx,
          nodePslSpan(arg.syntax, ctx.sourceFile),
        ),
      );
      continue;
    }
    namedSeen.add(key);
    const result = parseArgValue(arg, param, leafCtx, diagnostics, code);
    if (result.ok) namedParsed.set(key, result.value);
  }

  const positionalSeen = new Set<string>();
  const positionalParsed = new Map<string, unknown>();
  let index = 0;
  for (const param of spec.positional) {
    const arg = positionalArgs[index];
    if (arg === undefined) continue;
    index += 1;
    positionalSeen.add(param.key);
    const result = parseArgValue(arg, param.type, leafCtx, diagnostics, code);
    if (result.ok) positionalParsed.set(param.key, result.value);
  }
  if (index < positionalArgs.length) {
    diagnostics.push(
      diagnostic(
        code,
        `Attribute "${spec.name}" received too many positional arguments`,
        ctx,
        attributeSpan,
      ),
    );
  }

  const output: Record<string, unknown> = {};
  const handled = new Set<string>();
  const resolveKey = (
    key: string,
    positionalParam: Param<unknown> | undefined,
    namedParam: Param<unknown> | undefined,
  ): void => {
    if (handled.has(key)) return;
    handled.add(key);
    const fromPositional = positionalSeen.has(key);
    const fromNamed = namedSeen.has(key);

    if (fromPositional && fromNamed) {
      diagnostics.push(
        diagnostic(
          code,
          `Attribute "${spec.name}" received duplicate values for "${key}" both positionally and by name`,
          ctx,
          attributeSpan,
        ),
      );
      return;
    }
    if (fromNamed) {
      if (namedParsed.has(key)) output[key] = namedParsed.get(key);
      return;
    }
    if (fromPositional) {
      if (positionalParsed.has(key)) output[key] = positionalParsed.get(key);
      return;
    }

    const effective = namedParam ?? positionalParam;
    if (effective === undefined) return;
    if (isOptionalArgType(effective)) {
      if (effective.hasDefault) output[key] = effective.defaultValue;
      return;
    }
    diagnostics.push(
      diagnostic(
        code,
        `Attribute "${spec.name}" is missing required argument "${key}"`,
        ctx,
        attributeSpan,
      ),
    );
  };

  for (const param of spec.positional) {
    const namedParam = Object.hasOwn(spec.named, param.key) ? spec.named[param.key] : undefined;
    resolveKey(param.key, param.type, namedParam);
  }
  for (const key of Object.keys(spec.named)) {
    resolveKey(key, undefined, spec.named[key]);
  }

  if (diagnostics.length > 0) {
    return notOk<readonly PslDiagnostic[]>(diagnostics);
  }

  const value = blindCast<
    Out,
    'The engine builds the output object structurally from the spec; TypeScript cannot relate the dynamically-keyed record to the spec-inferred output type.'
  >(output);
  if (spec.refine !== undefined) {
    const refineDiagnostics = spec.refine(value, leafCtx);
    if (refineDiagnostics.length > 0) {
      return notOk<readonly PslDiagnostic[]>(refineDiagnostics);
    }
  }
  return ok(value);
}

function parseArgValue(
  arg: AttributeArgAst,
  argType: ArgType<unknown>,
  ctx: InterpretCtx,
  diagnostics: PslDiagnostic[],
  code: PslDiagnosticCode,
): Result<unknown, readonly PslDiagnostic[]> {
  const value = arg.value();
  if (value === undefined) {
    const missing = diagnostic(
      code,
      'Attribute argument is missing a value',
      ctx,
      nodePslSpan(arg.syntax, ctx.sourceFile),
    );
    diagnostics.push(missing);
    return notOk<readonly PslDiagnostic[]>([missing]);
  }
  const result = argType.parse(value, ctx);
  if (!result.ok) {
    for (const failure of result.failure) diagnostics.push(failure);
  }
  return result;
}

function isOptionalArgType(param: Param<unknown>): param is OptionalArgType<unknown> {
  return 'optional' in param && param.optional === true;
}

function diagnostic(
  code: PslDiagnosticCode,
  message: string,
  ctx: InterpretCtx,
  span: PslSpan,
): PslDiagnostic {
  return { code, message, sourceId: ctx.sourceId, span };
}

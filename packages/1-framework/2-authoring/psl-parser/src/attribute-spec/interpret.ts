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
import type { ArgType, AttributeSpec, InterpretCtx, OptionalParam, Param } from './types';

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
    if (namedSeen.has(key)) continue;
    namedSeen.add(key);
    const result = parseArgValue(arg, argTypeOf(param), leafCtx, diagnostics, code);
    if (result.ok) namedParsed.set(key, result.value);
  }

  const positionalSeen = new Set<string>();
  const positionalParsed = new Map<string, unknown>();
  let index = 0;
  for (const param of spec.positional) {
    if (param.variadic) {
      const collected: unknown[] = [];
      for (; index < positionalArgs.length; index++) {
        const arg = positionalArgs[index];
        if (arg === undefined) continue;
        const result = parseArgValue(arg, argTypeOf(param.type), leafCtx, diagnostics, code);
        if (result.ok) collected.push(result.value);
      }
      positionalSeen.add(param.key);
      positionalParsed.set(param.key, collected);
      continue;
    }
    const arg = positionalArgs[index];
    if (arg === undefined) continue;
    index += 1;
    positionalSeen.add(param.key);
    const result = parseArgValue(arg, argTypeOf(param.type), leafCtx, diagnostics, code);
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
      const hasPositional = positionalParsed.has(key);
      const hasNamed = namedParsed.has(key);
      if (
        hasPositional &&
        hasNamed &&
        !argValuesEqual(positionalParsed.get(key), namedParsed.get(key))
      ) {
        diagnostics.push(
          diagnostic(
            code,
            `Attribute "${spec.name}" has conflicting positional and named values for "${key}"`,
            ctx,
            attributeSpan,
          ),
        );
      }
      if (hasNamed) output[key] = namedParsed.get(key);
      else if (hasPositional) output[key] = positionalParsed.get(key);
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
    if (isOptionalParam(effective)) {
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

function isOptionalParam(param: Param<unknown>): param is OptionalParam<unknown> {
  return 'optional' in param && param.optional === true;
}

function argTypeOf(param: Param<unknown>): ArgType<unknown> {
  return isOptionalParam(param) ? param.type : param;
}

function diagnostic(
  code: PslDiagnosticCode,
  message: string,
  ctx: InterpretCtx,
  span: PslSpan,
): PslDiagnostic {
  return { code, message, sourceId: ctx.sourceId, span };
}

function argValuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((element, i) => argValuesEqual(element, b[i]));
  }
  if (isPlainRecord(a) && isPlainRecord(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    return (
      aKeys.length === bKeys.length &&
      aKeys.every((key) => Object.hasOwn(b, key) && argValuesEqual(a[key], b[key]))
    );
  }
  return false;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

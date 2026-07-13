import type { PslDiagnostic, PslSpan } from '@prisma-next/framework-components/psl-ast';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { nodePslSpan } from '../../resolve';
import type { ExpressionAst } from '../../syntax/ast/expressions';
import { FunctionCallAst } from '../../syntax/ast/expressions';
import { interpretArgs } from '../interpret';
import type { ArgType, InterpretCtx, Param, PositionalParam } from '../types';
import { leafDiagnostic } from './diagnostic';

// The argument signature of a pinned function call. Each positional slot / named param is a
// combinator, exactly as an attribute spec declares its args; omitted groups default to
// empty so a nullary call needs neither key.
export interface FuncCallSig {
  readonly positional?: readonly PositionalParam<unknown>[];
  readonly named?: Readonly<Record<string, Param<unknown>>>;
}

// The typed record a signed call binds to: the `fn` discriminant, the call-site span, and the
// parsed argument record produced by `interpretArgs`.
export interface TypedFuncCall {
  readonly fn: string;
  readonly span: PslSpan;
  readonly args: Readonly<Record<string, unknown>>;
}

// A name-pinned function-call argument (`funcCall('now', {})` matches `now()`). Pins the callee
// `name`, parses the call's arguments through `sig`, and binds them into a typed `{ fn, span, args }`
// record.
export function funcCall(name: string, sig: FuncCallSig): ArgType<TypedFuncCall> {
  return {
    kind: 'funcCall',
    label: 'function call',
    parse: (arg, ctx): Result<TypedFuncCall, readonly PslDiagnostic[]> => {
      const guard = matchCallee(arg, name, ctx);
      if (!guard.ok) return guard;
      const span = nodePslSpan(guard.value.syntax, ctx.sourceFile);
      const bound = interpretArgs(
        guard.value.args(),
        { name, positional: sig.positional ?? [], named: sig.named ?? {} },
        ctx,
        span,
      );
      if (!bound.ok) return notOk<readonly PslDiagnostic[]>(bound.failure);
      return ok({ fn: name, span, args: bound.value });
    },
  };
}

function matchCallee(
  arg: ExpressionAst,
  name: string,
  ctx: InterpretCtx,
): Result<FunctionCallAst, readonly PslDiagnostic[]> {
  if (!(arg instanceof FunctionCallAst)) {
    return notOk([leafDiagnostic(ctx, arg, 'Expected a function call')]);
  }
  const qname = arg.name();
  if (qname === undefined || qname.dot() !== undefined || qname.colon() !== undefined) {
    return notOk([leafDiagnostic(ctx, arg, 'Expected a function call')]);
  }
  const calleeName = qname.identifier()?.token()?.text;
  if (calleeName === undefined) {
    return notOk([leafDiagnostic(ctx, arg, 'Expected a function call')]);
  }
  if (calleeName !== name) {
    return notOk([leafDiagnostic(ctx, arg, `Expected ${name}()`)]);
  }
  return ok(arg);
}

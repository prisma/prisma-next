import type { ParsedDefaultFunctionCall } from '@prisma-next/framework-components/control';
import type { PslDiagnostic } from '@prisma-next/framework-components/psl-ast';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { nodePslSpan } from '../../resolve';
import { FunctionCallAst } from '../../syntax/ast/expressions';
import { printSyntax } from '../../syntax/ast-helpers';
import type { ArgType } from '../types';
import { leafDiagnostic } from './diagnostic';

// A name-pinned function-call argument (`funcCall('now')` matches `now()`) parsed into the
// framework `ParsedDefaultFunctionCall` shape. The callee must be an unqualified identifier
// equal to `name`; each argument is captured as verbatim source text — the downstream default
// registry re-parses those strings (`dbgenerated` needs the quotes preserved).
export function funcCall(name: string): ArgType<ParsedDefaultFunctionCall> {
  return {
    kind: 'funcCall',
    label: 'function call',
    parse: (arg, ctx): Result<ParsedDefaultFunctionCall, readonly PslDiagnostic[]> => {
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
      const args = Array.from(arg.args(), (argument) => {
        const node = argument.value() ?? argument;
        return {
          raw: printSyntax(node.syntax).trim(),
          span: nodePslSpan(node.syntax, ctx.sourceFile),
        };
      });
      return ok({
        name: calleeName,
        raw: printSyntax(arg.syntax).trim(),
        args,
        span: nodePslSpan(arg.syntax, ctx.sourceFile),
      });
    },
  };
}

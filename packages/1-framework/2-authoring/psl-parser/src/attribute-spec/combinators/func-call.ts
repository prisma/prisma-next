import type { ParsedDefaultFunctionCall } from '@prisma-next/framework-components/control';
import type { PslDiagnostic } from '@prisma-next/framework-components/psl-ast';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { nodePslSpan } from '../../resolve';
import { FunctionCallAst } from '../../syntax/ast/expressions';
import { printSyntax } from '../../syntax/ast-helpers';
import type { ArgType } from '../types';
import { leafDiagnostic } from './diagnostic';

// A function-call argument (`now()`, `dbgenerated("...")`) parsed into the framework
// `ParsedDefaultFunctionCall` shape. Registry-agnostic: the callee name is not validated
// here, and each argument is captured as verbatim source text — the SQL default registry
// re-parses those strings downstream (`dbgenerated` needs the quotes preserved).
export function funcCall(): ArgType<ParsedDefaultFunctionCall> {
  return {
    kind: 'funcCall',
    label: 'function call',
    parse: (arg, ctx): Result<ParsedDefaultFunctionCall, readonly PslDiagnostic[]> => {
      if (!(arg instanceof FunctionCallAst)) {
        return notOk([leafDiagnostic(ctx, arg, 'Expected a function call')]);
      }
      const name = arg.name()?.identifier()?.token()?.text;
      if (name === undefined) {
        return notOk([leafDiagnostic(ctx, arg, 'Expected a function call')]);
      }
      const args = Array.from(arg.args(), (argument) => {
        const node = argument.value() ?? argument;
        return {
          raw: printSyntax(node.syntax).trim(),
          span: nodePslSpan(node.syntax, ctx.sourceFile),
        };
      });
      return ok({
        name,
        raw: printSyntax(arg.syntax).trim(),
        args,
        span: nodePslSpan(arg.syntax, ctx.sourceFile),
      });
    },
  };
}

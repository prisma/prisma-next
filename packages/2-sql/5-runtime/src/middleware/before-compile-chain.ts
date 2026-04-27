import type { ParamDescriptor, PlanMeta } from '@prisma-next/contract/types';
import type { AnyQueryAst } from '@prisma-next/sql-relational-core/ast';
import type { DraftPlan, SqlMiddleware, SqlMiddlewareContext } from './sql-middleware';

export async function runBeforeCompileChain(
  middleware: readonly SqlMiddleware[],
  initial: DraftPlan,
  ctx: SqlMiddlewareContext,
): Promise<DraftPlan> {
  let current = initial;
  for (const mw of middleware) {
    if (!mw.beforeCompile) {
      continue;
    }
    const result = await mw.beforeCompile(current, ctx);
    if (result === undefined) {
      continue;
    }
    if (result.ast === current.ast) {
      continue;
    }
    ctx.log.debug?.({
      event: 'middleware.rewrite',
      middleware: mw.name,
      lane: current.meta.lane,
    });
    current = result;
  }

  if (current.ast === initial.ast) {
    return current;
  }

  // The rewritten AST may have introduced, removed, or replaced ParamRefs, so
  // the descriptors collected at lane build time no longer line up with what
  // the adapter will emit when it walks the new AST. Re-derive descriptors
  // from the rewritten AST so `params` and `paramDescriptors` stay in lockstep
  // by the time `encodeParams` runs.
  const paramDescriptors = deriveParamDescriptorsFromAst(current.ast);
  const meta: PlanMeta = { ...current.meta, paramDescriptors };
  return { ast: current.ast, meta };
}

function deriveParamDescriptorsFromAst(ast: AnyQueryAst): ReadonlyArray<ParamDescriptor> {
  const refs = ast.collectParamRefs();
  const seen = new Set<unknown>();
  const descriptors: ParamDescriptor[] = [];
  for (const ref of refs) {
    if (seen.has(ref)) continue;
    seen.add(ref);
    descriptors.push({
      index: descriptors.length + 1,
      ...(ref.name !== undefined ? { name: ref.name } : {}),
      source: 'dsl',
      ...(ref.codecId !== undefined ? { codecId: ref.codecId } : {}),
    });
  }
  return descriptors;
}

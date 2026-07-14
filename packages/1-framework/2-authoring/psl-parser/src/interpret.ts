import type {
  ContractSourceContext,
  ContractSourceDiagnostic,
  ContractSourceDiagnostics,
  ContractSourceProvider,
  PslContractSourceProvider,
} from '@prisma-next/config/config-types';
import type { Contract } from '@prisma-next/contract/types';
import { notOk, type Result } from '@prisma-next/utils/result';
import type { SourceFile } from './source-file';
import type { SymbolTable } from './symbol-table';
import type { DocumentAst } from './syntax/ast/declarations';

/**
 * Lets editor tooling that already parses incrementally (e.g. the language
 * server) hand cached artifacts to the interpreter instead of forcing a
 * disk re-parse.
 */
export interface PslInterpretInput {
  readonly document: DocumentAst;
  readonly sourceFile: SourceFile;
  readonly symbolTable: SymbolTable;
  readonly sourceId: string;
}

/**
 * Declared here — the authoring layer that owns `DocumentAst` / `SourceFile` /
 * `SymbolTable` — because `@prisma-next/config` (core) cannot name authoring
 * types.
 */
export interface PslInterpretCapable extends PslContractSourceProvider {
  interpret(
    input: PslInterpretInput,
    context: ContractSourceContext,
  ): Result<Contract, ContractSourceDiagnostics>;
}

/**
 * Merges caller-side diagnostics (e.g. parse / symbol-table findings) into an
 * interpretation result. The authored headline is deliberately uniform — it
 * reports how many errors the schema has, never which pipeline stage found
 * them.
 */
export function withSeedDiagnostics(
  result: Result<Contract, ContractSourceDiagnostics>,
  seedDiagnostics: readonly ContractSourceDiagnostic[],
): Result<Contract, ContractSourceDiagnostics> {
  if (seedDiagnostics.length === 0) {
    return result;
  }
  const diagnostics = result.ok
    ? seedDiagnostics
    : [...seedDiagnostics, ...result.failure.diagnostics];
  return notOk({
    summary: `Schema has ${diagnostics.length} error${diagnostics.length === 1 ? '' : 's'}`,
    diagnostics,
    ...(result.ok || result.failure.meta === undefined ? {} : { meta: result.failure.meta }),
  });
}

/** The single seam that narrows a contract source to the interpret capability. */
export function hasPslInterpreter(source: ContractSourceProvider): source is PslInterpretCapable {
  return (
    source.sourceFormat === 'psl' && 'interpret' in source && typeof source.interpret === 'function'
  );
}

import type {
  ContractSourceContext,
  ContractSourceDiagnostic,
  ContractSourceProvider,
  PslContractSourceProvider,
} from '@prisma-next/config/config-types';
import type { SourceFile } from './source-file';
import type { SymbolTable } from './symbol-table';
import type { DocumentAst } from './syntax/ast/declarations';

/**
 * Parser artifacts a caller hands to a PSL-interpret-capable contract source.
 * Editor tooling that already parses incrementally (e.g. the language server)
 * passes its cached artifacts here instead of forcing a disk re-parse.
 */
export interface PslInterpretInput {
  readonly document: DocumentAst;
  readonly sourceFile: SourceFile;
  readonly symbolTable: SymbolTable;
  readonly sourceId: string;
}

/**
 * Capability a PSL contract source provider may implement to interpret
 * pre-parsed artifacts into diagnostics without loading from disk.
 *
 * The capability vocabulary lives here — in the authoring layer that owns
 * `DocumentAst` / `SourceFile` / `SymbolTable` — because `@prisma-next/config`
 * (core) must not name authoring types.
 */
export interface PslInterpretCapable extends PslContractSourceProvider {
  interpret(
    input: PslInterpretInput,
    context: ContractSourceContext,
  ): readonly ContractSourceDiagnostic[];
}

/**
 * Runtime-evidence guard and the single seam that narrows
 * `ContractSourceProvider` to the interpret capability: the `sourceFormat`
 * discriminant alone never narrows the union (the opaque member's open
 * `string` overlaps `'psl'`), and the discriminant alone is no proof the
 * method exists.
 */
export function hasPslInterpreter(source: ContractSourceProvider): source is PslInterpretCapable {
  return (
    source.sourceFormat === 'psl' && 'interpret' in source && typeof source.interpret === 'function'
  );
}

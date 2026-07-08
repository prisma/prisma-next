import type { AuthoringPslBlockDescriptorNamespace } from '@prisma-next/framework-components/authoring';
import { buildSymbolTable, type SymbolTable } from '@prisma-next/psl-parser';
import {
  type DocumentAst,
  type ParseDiagnostic,
  parse,
  type SourceFile,
} from '@prisma-next/psl-parser/syntax';
import { type LspDiagnostic, mapParseDiagnostics } from './diagnostic-mapping';

/**
 * `pslBlockDescriptors` is kept complete on the live path so extension-block
 * validation matches the build; the structural diagnostics (duplicate
 * declaration, invalid qualified type) hold even without descriptors.
 */
export interface PipelineInputs {
  readonly scalarTypes: readonly string[];
  readonly pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace;
}

export interface PipelineResult {
  readonly document: DocumentAst;
  readonly sourceFile: SourceFile;
  readonly symbolTable: SymbolTable;
  readonly diagnostics: readonly LspDiagnostic[];
}

/**
 * Composes the stages exactly as the contract-psl provider does, so the editor
 * and the build agree: `parse` then `buildSymbolTable`, parse diagnostics ahead
 * of symbol-table diagnostics. Never throws on malformed input — `parse`
 * recovers and `buildSymbolTable` is documented not to throw.
 */
export function runPipeline(text: string, inputs: PipelineInputs): PipelineResult {
  const { document, sourceFile, diagnostics: parseDiagnostics } = parse(text);
  const { symbolTable, symbolTableDiagnostics } = runSymbolTableStage(document, sourceFile, inputs);

  return {
    document,
    sourceFile,
    symbolTable,
    diagnostics: mapParseDiagnostics([...parseDiagnostics, ...symbolTableDiagnostics]),
  };
}

/** The pipeline's second stage, reusable against already-parsed artifacts. */
export function runSymbolTableStage(
  document: DocumentAst,
  sourceFile: SourceFile,
  inputs: PipelineInputs,
): { symbolTable: SymbolTable; symbolTableDiagnostics: readonly ParseDiagnostic[] } {
  const { table: symbolTable, diagnostics: symbolTableDiagnostics } = buildSymbolTable({
    document,
    sourceFile,
    scalarTypes: inputs.scalarTypes,
    pslBlockDescriptors: inputs.pslBlockDescriptors,
  });
  return { symbolTable, symbolTableDiagnostics };
}

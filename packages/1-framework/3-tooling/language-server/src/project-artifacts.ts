import { buildSymbolTable, type SymbolTable } from '@prisma-next/psl-parser';
import { type DocumentAst, parse, type SourceFile } from '@prisma-next/psl-parser/syntax';
import type { LspDiagnostic } from './diagnostic-mapping';
import { computeDocumentDiagnostics } from './document-diagnostics';
import type { PipelineInputs } from './pipeline';
import type { SchemaInputSet } from './schema-inputs';

export interface DocumentArtifacts {
  readonly document: DocumentAst;
  readonly sourceFile: SourceFile;
  readonly diagnostics: readonly LspDiagnostic[];
}

export interface ProjectArtifactsOptions {
  readonly inputs: SchemaInputSet;
  readonly controlStack: PipelineInputs;
  readonly getText: (uri: string) => string | undefined;
}

/**
 * Reads can never observe stale artifacts: the vscode-languageserver runtime
 * dispatches messages in order and the server raises `documentChanged` /
 * `documentClosed` synchronously against the already-updated text mirror, so
 * every mutation that could affect a read lands before that read runs. A
 * config reload replaces the store wholesale.
 */
export interface ProjectArtifacts {
  /**
   * `undefined` when the document is not open in the text mirror or is not
   * one of the project's configured inputs.
   */
  document(uri: string): DocumentArtifacts | undefined;
  symbolTable(): SymbolTable;
  documentChanged(uri: string): void;
  documentClosed(uri: string): void;
}

// Doubles as the unset-slot sentinel and the type-totality safety net for
// `symbolTable()`: unreachable as a returned value while the server drops a
// project once its last open input closes (a live project always has an open
// input for the walk to read). Kept total instead of throwing — this is not a
// designed state.
const emptySymbolTable: SymbolTable = (() => {
  const { document, sourceFile } = parse('');
  return buildSymbolTable({ document, sourceFile, scalarTypes: [], pslBlockDescriptors: {} }).table;
})();

export function createProjectArtifacts(options: ProjectArtifactsOptions): ProjectArtifacts {
  const { inputs, controlStack, getText } = options;
  const documents = new Map<string, DocumentArtifacts>();
  let symbolTable = emptySymbolTable;

  function drop(uri: string): void {
    if (documents.delete(uri)) {
      symbolTable = emptySymbolTable;
    }
  }

  function readDocument(uri: string): DocumentArtifacts | undefined {
    const existing = documents.get(uri);
    if (existing !== undefined) {
      return existing;
    }
    const text = getText(uri);
    if (text === undefined) {
      return undefined;
    }
    const computed = computeDocumentDiagnostics(uri, text, inputs, controlStack);
    if (computed === null) {
      return undefined;
    }
    const artifacts: DocumentArtifacts = {
      document: computed.document,
      sourceFile: computed.sourceFile,
      diagnostics: computed.diagnostics,
    };
    documents.set(uri, artifacts);
    // Single-input by design: the project table is rebuilt from the one open
    // configured input; merging multiple inputs (and reading unopened ones
    // from disk) is deferred cross-file work.
    symbolTable = computed.symbolTable;
    return artifacts;
  }

  return {
    document: readDocument,
    symbolTable: () => {
      if (symbolTable === emptySymbolTable) {
        for (const uri of inputs.uris()) {
          if (readDocument(uri) !== undefined) {
            break;
          }
        }
      }
      return symbolTable;
    },
    documentChanged: drop,
    documentClosed: drop,
  };
}

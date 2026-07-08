import type { SymbolTable } from '@prisma-next/psl-parser';
import type { DocumentAst, SourceFile } from '@prisma-next/psl-parser/syntax';
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
  /** `undefined` only when no configured input is open in the text mirror. */
  symbolTable(): SymbolTable | undefined;
  documentChanged(uri: string): void;
  documentClosed(uri: string): void;
}

export function createProjectArtifacts(options: ProjectArtifactsOptions): ProjectArtifacts {
  const { inputs, controlStack, getText } = options;
  const documents = new Map<string, DocumentArtifacts>();
  let symbolTable: SymbolTable | undefined;

  function drop(uri: string): void {
    if (documents.delete(uri)) {
      symbolTable = undefined;
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
      if (symbolTable !== undefined) {
        return symbolTable;
      }
      for (const uri of inputs.uris()) {
        if (readDocument(uri) !== undefined) {
          break;
        }
      }
      return symbolTable;
    },
    documentChanged: drop,
    documentClosed: drop,
  };
}

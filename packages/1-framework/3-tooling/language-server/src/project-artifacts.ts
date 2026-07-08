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
  /** Reads the live buffer from the server's text mirror. */
  readonly getText: (uri: string) => string | undefined;
}

/**
 * Owns all derived parse state for one project load. Reads (`document`,
 * `symbolTable`) are synchronous and parse internally when needed; the only
 * things that can change what a read returns are the domain events
 * (`documentChanged`, `documentClosed`) and replacing the whole store on a
 * config reload — nothing else can trigger a reparse.
 *
 * Correctness of caching internally: LSP messages are dispatched in order and
 * the server raises the events synchronously against the already-updated text
 * mirror, so by the time any read runs, every event that could change its
 * result has already been applied — cached artifacts are always current.
 */
export interface ProjectArtifacts {
  document(uri: string): DocumentArtifacts | undefined;
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

  return {
    document: (uri) => {
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
      // One symbol table per project. Single-input reality: it is (re)built
      // from the one open configured input whenever that input reparses.
      // Merging several open inputs into one project table — and reading
      // unopened `inputs` from disk — is the deferred cross-file work;
      // `buildSymbolTable`'s single-document signature is left untouched for it.
      symbolTable = computed.symbolTable;
      return artifacts;
    },
    symbolTable: () => symbolTable,
    documentChanged: drop,
    documentClosed: drop,
  };
}

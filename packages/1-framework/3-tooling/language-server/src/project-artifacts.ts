import type { SymbolTable } from '@prisma-next/psl-parser';
import type { DocumentAst, SourceFile } from '@prisma-next/psl-parser/syntax';
import type { LspDiagnostic } from './diagnostic-mapping';
import { computeDocumentDiagnostics } from './document-diagnostics';
import type { PipelineInputs } from './pipeline';
import type { SchemaInputSet } from './schema-inputs';

export interface CachedDocument {
  readonly document: DocumentAst;
  readonly sourceFile: SourceFile;
  readonly diagnostics: readonly LspDiagnostic[];
}

/**
 * Presence in the store is currency: every event that could change what a
 * parse produces evicts first (`remove` for a document edit or close, `clear`
 * for a config reload), so `materialize` trusts an existing entry untouched
 * and only parses on a miss.
 */
export interface ProjectArtifacts {
  getDocument(uri: string): CachedDocument | undefined;
  getSymbolTable(): SymbolTable | undefined;
  materialize(
    uri: string,
    text: string,
    inputs: SchemaInputSet,
    controlStack: PipelineInputs,
  ): readonly LspDiagnostic[] | null;
  clear(): void;
  remove(uri: string): void;
}

export function createProjectArtifacts(): ProjectArtifacts {
  const documents = new Map<string, CachedDocument>();
  let symbolTable: SymbolTable | undefined;

  return {
    getDocument: (uri) => documents.get(uri),
    getSymbolTable: () => symbolTable,
    materialize: (uri, text, inputs, controlStack) => {
      const cached = documents.get(uri);
      if (cached !== undefined) {
        return cached.diagnostics;
      }
      const computed = computeDocumentDiagnostics(uri, text, inputs, controlStack);
      if (computed === null) {
        return null;
      }
      documents.set(uri, {
        document: computed.document,
        sourceFile: computed.sourceFile,
        diagnostics: computed.diagnostics,
      });
      // One symbol table per project. Single-input reality: it is (re)built from
      // the one open configured input whenever that input rematerializes. Merging
      // several open inputs into one project table — and reading unopened
      // `inputs` from disk — is the deferred cross-file work; `buildSymbolTable`'s
      // single-document signature is left untouched for it.
      symbolTable = computed.symbolTable;
      return computed.diagnostics;
    },
    clear: () => {
      documents.clear();
      symbolTable = undefined;
    },
    remove: (uri) => {
      if (documents.delete(uri)) {
        symbolTable = undefined;
      }
    },
  };
}

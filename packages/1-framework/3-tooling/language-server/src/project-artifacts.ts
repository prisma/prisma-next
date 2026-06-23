import type { SymbolTable } from '@prisma-next/psl-parser';
import type { DocumentAst, SourceFile } from '@prisma-next/psl-parser/syntax';
import type { LspDiagnostic } from './diagnostic-mapping';
import { computeDocumentDiagnostics } from './document-diagnostics';
import type { PipelineInputs } from './pipeline';
import type { SchemaInputSet } from './schema-inputs';

export interface CachedDocument {
  readonly document: DocumentAst;
  readonly sourceFile: SourceFile;
}

export interface ProjectArtifacts {
  getDocument(uri: string): CachedDocument | undefined;
  getSymbolTable(): SymbolTable | undefined;
  update(
    uri: string,
    text: string,
    inputs: SchemaInputSet,
    controlStack: PipelineInputs,
  ): readonly LspDiagnostic[] | null;
  remove(uri: string): void;
}

export function createProjectArtifacts(): ProjectArtifacts {
  const documents = new Map<string, CachedDocument>();
  let symbolTable: SymbolTable | undefined;

  return {
    getDocument: (uri) => documents.get(uri),
    getSymbolTable: () => symbolTable,
    update: (uri, text, inputs, controlStack) => {
      const computed = computeDocumentDiagnostics(uri, text, inputs, controlStack);
      if (computed === null) {
        if (documents.delete(uri)) {
          symbolTable = undefined;
        }
        return null;
      }
      documents.set(uri, {
        document: computed.document,
        sourceFile: computed.sourceFile,
      });
      // One symbol table per project. Single-input reality: it is (re)built from
      // the one open configured input on every edit. Merging several open inputs
      // into one project table — and reading unopened `inputs` from disk — is the
      // deferred cross-file work; `buildSymbolTable`'s single-document signature
      // is left untouched for it.
      symbolTable = computed.symbolTable;
      return computed.diagnostics;
    },
    remove: (uri) => {
      if (documents.delete(uri)) {
        symbolTable = undefined;
      }
    },
  };
}

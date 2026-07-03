import type { SymbolTable } from '@prisma-next/psl-parser';
import type { DocumentAst, SourceFile } from '@prisma-next/psl-parser/syntax';
import type { LspDiagnostic } from './diagnostic-mapping';
import { computeDocumentDiagnostics } from './document-diagnostics';
import type { PipelineInputs } from './pipeline';
import type { SchemaInputSet } from './schema-inputs';

export interface CachedDocument {
  readonly document: DocumentAst;
  readonly sourceFile: SourceFile;
  /** The `TextDocument.version` the artifacts were parsed from. */
  readonly version: number;
  readonly diagnostics: readonly LspDiagnostic[];
}

export interface ProjectArtifacts {
  getDocument(uri: string): CachedDocument | undefined;
  getSymbolTable(): SymbolTable | undefined;
  update(
    uri: string,
    text: string,
    version: number,
    inputs: SchemaInputSet,
    controlStack: PipelineInputs,
  ): readonly LspDiagnostic[] | null;
  /**
   * Marks every cached entry stale so the next `update` recomputes even at an
   * unchanged document version — required after a config reload, where the
   * inputs or control stack may have changed underneath the cache.
   */
  invalidate(): void;
  remove(uri: string): void;
}

// LSP document versions only increase, so this never matches a live version.
const invalidatedVersion = -1;

export function createProjectArtifacts(): ProjectArtifacts {
  const documents = new Map<string, CachedDocument>();
  let symbolTable: SymbolTable | undefined;

  return {
    getDocument: (uri) => documents.get(uri),
    getSymbolTable: () => symbolTable,
    update: (uri, text, version, inputs, controlStack) => {
      const cached = documents.get(uri);
      if (cached !== undefined && cached.version === version) {
        return cached.diagnostics;
      }
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
        version,
        diagnostics: computed.diagnostics,
      });
      // One symbol table per project. Single-input reality: it is (re)built from
      // the one open configured input on every edit. Merging several open inputs
      // into one project table — and reading unopened `inputs` from disk — is the
      // deferred cross-file work; `buildSymbolTable`'s single-document signature
      // is left untouched for it.
      symbolTable = computed.symbolTable;
      return computed.diagnostics;
    },
    invalidate: () => {
      for (const [uri, cached] of documents) {
        documents.set(uri, { ...cached, version: invalidatedVersion });
      }
    },
    remove: (uri) => {
      if (documents.delete(uri)) {
        symbolTable = undefined;
      }
    },
  };
}

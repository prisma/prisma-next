import { pathToFileURL } from 'node:url';
import { buildSymbolTable } from '@prisma-next/psl-parser';
import { parse } from '@prisma-next/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { mapParseDiagnostics } from '../src/diagnostic-mapping';
import type { PipelineInputs } from '../src/pipeline';
import { createProjectArtifacts, type ProjectArtifacts } from '../src/project-artifacts';
import { resolveSchemaInputs } from '../src/schema-inputs';

const schemaUri = pathToFileURL('/abs/schema.psl').toString();
const inputs = resolveSchemaInputs({
  contract: { source: { sourceFormat: 'psl', inputs: ['/abs/schema.psl'] } },
});

const controlStack: PipelineInputs = {
  scalarTypes: ['String', 'Int', 'Boolean', 'DateTime'],
  pslBlockDescriptors: {},
};

const cleanSource = 'model User {\n  id Int @id\n}\n';
const twoModelSource = 'model User {\n  id Int @id\n}\n\nmodel Post {\n  id Int @id\n}\n';

function projectWithMirror(): {
  readonly texts: Map<string, string>;
  readonly store: ProjectArtifacts;
} {
  const texts = new Map<string, string>();
  const store = createProjectArtifacts({
    inputs,
    controlStack,
    getText: (uri) => texts.get(uri),
  });
  return { texts, store };
}

describe('createProjectArtifacts', () => {
  it('parses the mirrored text on first read', () => {
    const { texts, store } = projectWithMirror();
    texts.set(schemaUri, cleanSource);

    const artifacts = store.document(schemaUri);
    expect(artifacts?.document).toBeDefined();
    expect(artifacts?.sourceFile).toBeDefined();
    expect(artifacts?.diagnostics).toEqual([]);
  });

  it('returns the same artifacts for repeated reads without an intervening event', () => {
    const { texts, store } = projectWithMirror();
    texts.set(schemaUri, cleanSource);
    const first = store.document(schemaUri);

    texts.set(schemaUri, twoModelSource);

    expect(store.document(schemaUri)).toBe(first);
  });

  it('reflects the latest mirrored text on the read after documentChanged', () => {
    const { texts, store } = projectWithMirror();
    texts.set(schemaUri, cleanSource);
    const first = store.document(schemaUri);

    texts.set(schemaUri, twoModelSource);
    store.documentChanged(schemaUri);

    const second = store.document(schemaUri);
    expect(second?.document).not.toBe(first?.document);
    expect(Object.keys(store.symbolTable()?.topLevel.models ?? {})).toEqual(
      expect.arrayContaining(['User', 'Post']),
    );
  });

  it('returns undefined for documents without mirrored text', () => {
    const { store } = projectWithMirror();
    expect(store.document(schemaUri)).toBeUndefined();
    expect(store.symbolTable()).toBeUndefined();
  });

  it('returns undefined for documents that are not configured inputs', () => {
    const { texts, store } = projectWithMirror();
    const otherUri = pathToFileURL('/abs/not-a-schema.psl').toString();
    texts.set(otherUri, cleanSource);

    expect(store.document(otherUri)).toBeUndefined();
    expect(store.symbolTable()).toBeUndefined();
  });

  it('builds one project symbol table from the open configured input', () => {
    const { texts, store } = projectWithMirror();
    texts.set(schemaUri, cleanSource);
    store.document(schemaUri);

    expect(Object.keys(store.symbolTable()?.topLevel.models ?? {})).toContain('User');
  });

  it('reading the symbol table alone does not parse', () => {
    const { texts, store } = projectWithMirror();
    texts.set(schemaUri, cleanSource);

    expect(store.symbolTable()).toBeUndefined();
  });

  it('drops the artifacts and symbol table on documentClosed', () => {
    const { texts, store } = projectWithMirror();
    texts.set(schemaUri, cleanSource);
    store.document(schemaUri);

    texts.delete(schemaUri);
    store.documentClosed(schemaUri);

    expect(store.document(schemaUri)).toBeUndefined();
    expect(store.symbolTable()).toBeUndefined();
  });

  it('returns diagnostics with parity to parse + buildSymbolTable for the same inputs', () => {
    const { texts, store } = projectWithMirror();
    const source = ['model Profile {', '  user a.b.c', '}'].join('\n');
    texts.set(schemaUri, source);
    const { document, sourceFile, diagnostics: parseDiagnostics } = parse(source);
    const { diagnostics: symbolTableDiagnostics } = buildSymbolTable({
      document,
      sourceFile,
      scalarTypes: controlStack.scalarTypes,
      pslBlockDescriptors: controlStack.pslBlockDescriptors,
    });

    expect(store.document(schemaUri)?.diagnostics).toEqual(
      mapParseDiagnostics([...parseDiagnostics, ...symbolTableDiagnostics]),
    );
  });

  it('does not throw on a malformed, half-typed buffer', () => {
    const { texts, store } = projectWithMirror();
    texts.set(schemaUri, 'model User {\n  id ');
    expect(() => store.document(schemaUri)).not.toThrow();
  });
});

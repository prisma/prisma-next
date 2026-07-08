import { pathToFileURL } from 'node:url';
import { buildSymbolTable } from '@prisma-next/psl-parser';
import { parse } from '@prisma-next/psl-parser/syntax';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mapParseDiagnostics } from '../src/diagnostic-mapping';
import type { PipelineInputs } from '../src/pipeline';
import { createProjectArtifacts, type ProjectArtifacts } from '../src/project-artifacts';
import { resolveSchemaInputs } from '../src/schema-inputs';

const pipelineMock = vi.hoisted(() => ({
  runPipeline: vi.fn<typeof import('../src/pipeline')['runPipeline']>(),
}));

// Pass-through spy on the parse seam so tests can count parses.
vi.mock('../src/pipeline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/pipeline')>();
  pipelineMock.runPipeline.mockImplementation(actual.runPipeline);
  return { ...actual, runPipeline: pipelineMock.runPipeline };
});

afterEach(() => {
  pipelineMock.runPipeline.mockClear();
});

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
    expect(Object.keys(second?.symbolTable.topLevel.models ?? {})).toEqual(
      expect.arrayContaining(['User', 'Post']),
    );
  });

  it('returns undefined for documents without mirrored text', () => {
    const { store } = projectWithMirror();
    expect(store.document(schemaUri)).toBeUndefined();
    expect(pipelineMock.runPipeline).not.toHaveBeenCalled();
  });

  it('returns undefined for documents that are not configured inputs', () => {
    const { texts, store } = projectWithMirror();
    const otherUri = pathToFileURL('/abs/not-a-schema.psl').toString();
    texts.set(otherUri, cleanSource);

    expect(store.document(otherUri)).toBeUndefined();
    expect(pipelineMock.runPipeline).not.toHaveBeenCalled();
  });

  it('one parse yields the document artifacts and their symbol table together', () => {
    const { texts, store } = projectWithMirror();
    texts.set(schemaUri, cleanSource);

    const artifacts = store.document(schemaUri);
    expect(Object.keys(artifacts?.symbolTable.topLevel.models ?? {})).toContain('User');
    expect(pipelineMock.runPipeline).toHaveBeenCalledTimes(1);
  });

  it('a second consumer of the same artifacts causes no reparse', () => {
    const { texts, store } = projectWithMirror();
    texts.set(schemaUri, cleanSource);

    const first = store.document(schemaUri);
    const second = store.document(schemaUri);
    expect(second?.symbolTable).toBe(first?.symbolTable);
    expect(pipelineMock.runPipeline).toHaveBeenCalledTimes(1);
  });

  it('drops the artifacts on documentClosed', () => {
    const { texts, store } = projectWithMirror();
    texts.set(schemaUri, cleanSource);
    store.document(schemaUri);

    texts.delete(schemaUri);
    store.documentClosed(schemaUri);

    expect(store.document(schemaUri)).toBeUndefined();
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

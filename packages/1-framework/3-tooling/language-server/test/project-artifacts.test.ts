import { pathToFileURL } from 'node:url';
import { buildSymbolTable } from '@prisma-next/psl-parser';
import { parse } from '@prisma-next/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { mapParseDiagnostics } from '../src/diagnostic-mapping';
import type { PipelineInputs } from '../src/pipeline';
import { createProjectArtifacts } from '../src/project-artifacts';
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

describe('createProjectArtifacts', () => {
  it('caches the parsed AST per URI', () => {
    const store = createProjectArtifacts();
    store.update(schemaUri, cleanSource, inputs, controlStack);

    const cached = store.getDocument(schemaUri);
    expect(cached?.document).toBeDefined();
    expect(cached?.sourceFile).toBeDefined();
  });

  it('replaces the AST entry on a later edit of the same URI', () => {
    const store = createProjectArtifacts();
    store.update(schemaUri, cleanSource, inputs, controlStack);
    const first = store.getDocument(schemaUri);

    store.update(schemaUri, twoModelSource, inputs, controlStack);
    const second = store.getDocument(schemaUri);

    expect(second?.document).not.toBe(first?.document);
  });

  it('builds one project symbol table from the open configured input', () => {
    const store = createProjectArtifacts();
    store.update(schemaUri, cleanSource, inputs, controlStack);

    expect(Object.keys(store.getSymbolTable()?.topLevel.models ?? {})).toContain('User');
  });

  it('rebuilds the project symbol table to reflect the latest edit', () => {
    const store = createProjectArtifacts();
    store.update(schemaUri, cleanSource, inputs, controlStack);
    store.update(schemaUri, twoModelSource, inputs, controlStack);

    expect(Object.keys(store.getSymbolTable()?.topLevel.models ?? {})).toEqual(
      expect.arrayContaining(['User', 'Post']),
    );
  });

  it('drops the AST and clears the symbol table when the document is removed', () => {
    const store = createProjectArtifacts();
    store.update(schemaUri, cleanSource, inputs, controlStack);

    store.remove(schemaUri);

    expect(store.getDocument(schemaUri)).toBeUndefined();
    expect(store.getSymbolTable()).toBeUndefined();
  });

  it('returns null and caches nothing for a document that is not a configured input', () => {
    const store = createProjectArtifacts();
    const otherUri = pathToFileURL('/abs/not-a-schema.psl').toString();

    expect(store.update(otherUri, cleanSource, inputs, controlStack)).toBeNull();
    expect(store.getDocument(otherUri)).toBeUndefined();
  });

  it('drops a cached input when a config change removes it as an input', () => {
    const store = createProjectArtifacts();
    store.update(schemaUri, cleanSource, inputs, controlStack);

    const emptyInputs = resolveSchemaInputs({});
    expect(store.update(schemaUri, cleanSource, emptyInputs, controlStack)).toBeNull();
    expect(store.getDocument(schemaUri)).toBeUndefined();
    expect(store.getSymbolTable()).toBeUndefined();
  });

  it('returns diagnostics with parity to parse + buildSymbolTable for the same inputs', () => {
    const store = createProjectArtifacts();
    const source = ['model Profile {', '  user a.b.c', '}'].join('\n');
    const { document, sourceFile, diagnostics: parseDiagnostics } = parse(source);
    const { diagnostics: symbolTableDiagnostics } = buildSymbolTable({
      document,
      sourceFile,
      scalarTypes: controlStack.scalarTypes,
      pslBlockDescriptors: controlStack.pslBlockDescriptors,
    });

    const diagnostics = store.update(schemaUri, source, inputs, controlStack);

    expect(diagnostics).toEqual(
      mapParseDiagnostics([...parseDiagnostics, ...symbolTableDiagnostics]),
    );
  });

  it('does not throw on a malformed, half-typed buffer', () => {
    const store = createProjectArtifacts();
    expect(() =>
      store.update(schemaUri, 'model User {\n  id ', inputs, controlStack),
    ).not.toThrow();
  });
});

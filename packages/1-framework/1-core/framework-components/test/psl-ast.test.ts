import { describe, expect, it } from 'vitest';
import type { PslExtensionBlock, PslModel, PslSpan } from '../src/control/psl-ast';
import {
  BUILTIN_PSL_KIND_KEYS,
  makePslNamespace,
  makePslNamespaceEntries,
  namespacePslExtensionBlocks,
} from '../src/control/psl-ast';

const SPAN: PslSpan = {
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 0, line: 1, column: 1 },
};

function makeModel(name: string): PslModel {
  return { kind: 'model', name, fields: [], attributes: [], span: SPAN };
}

function makeExtensionBlock(discriminator: string, name: string): PslExtensionBlock {
  return { kind: discriminator, name, parameters: {}, span: SPAN };
}

describe('makePslNamespace / makePslNamespaceEntries', () => {
  describe('entries structure', () => {
    it('groups built-in models under entries["model"]', () => {
      const user = makeModel('User');
      const post = makeModel('Post');
      const ns = makePslNamespace({
        kind: 'namespace',
        name: 'public',
        entries: makePslNamespaceEntries([user, post], [], [], []),
        span: SPAN,
      });

      expect(ns.entries['model']?.['User']).toBe(user);
      expect(ns.entries['model']?.['Post']).toBe(post);
    });

    it('groups extension-contributed blocks under entries[discriminator]', () => {
      const block = makeExtensionBlock('policy_select', 'ReadPosts');
      const ns = makePslNamespace({
        kind: 'namespace',
        name: 'public',
        entries: makePslNamespaceEntries([], [], [], [block]),
        span: SPAN,
      });

      expect(ns.entries['policy_select']?.['ReadPosts']).toBe(block);
    });

    it('addresses a built-in kind and an extension-contributed kind through the same entries[kind][name] expression', () => {
      const user = makeModel('User');
      const policy = makeExtensionBlock('policy_select', 'ReadUsers');
      const ns = makePslNamespace({
        kind: 'namespace',
        name: 'public',
        entries: makePslNamespaceEntries([user], [], [], [policy]),
        span: SPAN,
      });

      // Both resolve via the uniform coordinate path entries[kind][name].
      const builtInResult = ns.entries['model']?.['User'];
      const extensionResult = ns.entries['policy_select']?.['ReadUsers'];

      expect(builtInResult).toBe(user);
      expect(extensionResult).toBe(policy);
      // Confirm both expressions share the same shape (kind + name on the node).
      expect(builtInResult?.kind).toBe('model');
      expect(builtInResult?.name).toBe('User');
      expect(extensionResult?.kind).toBe('policy_select');
      expect(extensionResult?.name).toBe('ReadUsers');
    });
  });

  describe('derived accessors', () => {
    it('models accessor returns models from entries', () => {
      const user = makeModel('User');
      const ns = makePslNamespace({
        kind: 'namespace',
        name: 'public',
        entries: makePslNamespaceEntries([user], [], [], []),
        span: SPAN,
      });

      expect(ns.models).toEqual([user]);
    });

    it('models/enums/compositeTypes are non-enumerable on the namespace object', () => {
      const ns = makePslNamespace({
        kind: 'namespace',
        name: 'public',
        entries: makePslNamespaceEntries([makeModel('User')], [], [], []),
        span: SPAN,
      });

      const ownKeys = Object.keys(ns);
      expect(ownKeys).not.toContain('models');
      expect(ownKeys).not.toContain('enums');
      expect(ownKeys).not.toContain('compositeTypes');
      // Only the stored fields are enumerable.
      expect(ownKeys).toContain('kind');
      expect(ownKeys).toContain('name');
      expect(ownKeys).toContain('entries');
      expect(ownKeys).toContain('span');
    });

    it('spreading the namespace does not duplicate entity data alongside entries', () => {
      const user = makeModel('User');
      const ns = makePslNamespace({
        kind: 'namespace',
        name: 'public',
        entries: makePslNamespaceEntries([user], [], [], []),
        span: SPAN,
      });

      const spread = { ...ns };
      expect(Object.hasOwn(spread, 'models')).toBe(false);
      expect(Object.hasOwn(spread, 'enums')).toBe(false);
      expect(Object.hasOwn(spread, 'compositeTypes')).toBe(false);
    });
  });

  describe('BUILTIN_PSL_KIND_KEYS and namespacePslExtensionBlocks', () => {
    it('BUILTIN_PSL_KIND_KEYS contains the three reserved kind strings', () => {
      expect(BUILTIN_PSL_KIND_KEYS.has('model')).toBe(true);
      expect(BUILTIN_PSL_KIND_KEYS.has('enum')).toBe(true);
      expect(BUILTIN_PSL_KIND_KEYS.has('compositeType')).toBe(true);
    });

    it('namespacePslExtensionBlocks returns only extension blocks, not built-ins', () => {
      const user = makeModel('User');
      const policy = makeExtensionBlock('policy_select', 'ReadUsers');
      const ns = makePslNamespace({
        kind: 'namespace',
        name: 'public',
        entries: makePslNamespaceEntries([user], [], [], [policy]),
        span: SPAN,
      });

      const extBlocks = namespacePslExtensionBlocks(ns);
      expect(extBlocks).toHaveLength(1);
      expect(extBlocks[0]).toBe(policy);
    });
  });
});

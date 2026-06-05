/**
 * End-to-end round-trip pin for the extension-contributed-PSL-blocks
 * mechanism. A test-only fixture extension registers a `pslBlocks`
 * descriptor (carrying both parser + printer) and a matching
 * `entityTypes` factory for one made-up RLS-shaped keyword and
 * exercises the path:
 *
 *   text → parse → AST.extensionBlocks → entityTypes factory → IR class
 *        → JSON.stringify → JSON.parse → IR class (hydrated)
 *        → print → text → parse → AST.extensionBlocks (equivalent)
 *
 * The fixture lives at `./fixtures/fake-target-pack.ts`. Downstream
 * projects (RLS, roles, custom Postgres types) follow this shape as
 * the canonical example of an extension-contributed top-level block.
 *
 * Ref: TML-2804.
 */

import { assembleAuthoringContributions } from '@prisma-next/framework-components/control';
import { UNSPECIFIED_PSL_NAMESPACE_ID } from '@prisma-next/framework-components/psl-ast';
import { parsePslDocument } from '@prisma-next/psl-parser';
import { describe, expect, it } from 'vitest';
import { printPslFromAst } from '../src/print-psl';
import {
  FakePolicyIr,
  fakeTargetPackContributions,
  hydrateFakePolicyIrFromJson,
  isFakePolicyAst,
} from './fixtures/fake-target-pack';

const assembled = assembleAuthoringContributions([{ authoring: fakeTargetPackContributions }]);

describe('fake-target-pack round-trip', () => {
  describe('given a PSL document with a single fake_policy block at the top level', () => {
    const source = `fake_policy ProfilesSelect {
  target = Profile
  using = "auth.uid() = user_id"
}
`;

    it('parses the block into a PslExtensionBlock with the contributed kind', () => {
      const parsed = parsePslDocument({
        schema: source,
        sourceId: 'r1',
        pslBlocks: assembled.pslBlocks,
      });

      expect(parsed.diagnostics).toEqual([]);
      const namespace = parsed.ast.namespaces.find(
        (ns) => ns.name === UNSPECIFIED_PSL_NAMESPACE_ID,
      );
      expect(namespace?.extensionBlocks).toHaveLength(1);
      const block = namespace?.extensionBlocks[0];
      expect(block).toBeDefined();
      if (!block || !isFakePolicyAst(block)) {
        throw new Error('expected one fake-policy block');
      }
      expect(block.name).toBe('ProfilesSelect');
      expect(block.target).toBe('Profile');
      expect(block.using).toBe('auth.uid() = user_id');
    });

    it('round-trips parse → print → parse to an equivalent AST', () => {
      const parsed1 = parsePslDocument({
        schema: source,
        sourceId: 'r1',
        pslBlocks: assembled.pslBlocks,
      });
      expect(parsed1.diagnostics).toEqual([]);

      const printed = printPslFromAst(parsed1.ast, { pslBlocks: assembled.pslBlocks });
      const parsed2 = parsePslDocument({
        schema: printed,
        sourceId: 'r2',
        pslBlocks: assembled.pslBlocks,
      });
      expect(parsed2.diagnostics).toEqual([]);

      expect(projectFirstFakePolicy(parsed2.ast)).toEqual(projectFirstFakePolicy(parsed1.ast));
    });
  });

  describe('given a parsed fake_policy AST node', () => {
    it('lowers via the entityTypes factory to a frozen FakePolicyIr instance', () => {
      const parsed = parsePslDocument({
        schema: 'fake_policy AllAllowed {\n  target = Doc\n  using = "true"\n}\n',
        sourceId: 'r',
        pslBlocks: assembled.pslBlocks,
      });
      const block = parsed.ast.namespaces[0]?.extensionBlocks[0];
      if (!block || !isFakePolicyAst(block)) {
        throw new Error('expected one fake-policy block');
      }

      const factoryEntry = assembled.entityTypes['fake_policy'];
      if (factoryEntry === undefined || !('output' in factoryEntry)) {
        throw new Error('expected entityTypes.fake_policy descriptor');
      }
      const output = factoryEntry.output;
      if (!('factory' in output) || typeof output.factory !== 'function') {
        throw new Error('expected entityTypes.fake_policy.output.factory function');
      }
      const ir = output.factory(block, { family: 'fake-fixture', target: 'fake-fixture' });
      expect(ir).toBeInstanceOf(FakePolicyIr);
      expect(Object.isFrozen(ir)).toBe(true);
      expect(ir).toMatchObject({
        kind: 'fake-policy',
        name: 'AllAllowed',
        target: 'Doc',
        using: 'true',
      });
    });
  });

  describe('given a FakePolicyIr instance', () => {
    it('serializes and re-hydrates via JSON without losing fields', () => {
      const original = new FakePolicyIr({
        name: 'AllAllowed',
        target: 'Doc',
        using: 'auth.role() = "admin"',
      });

      const serialized = JSON.stringify(original);
      const parsed: unknown = JSON.parse(serialized);
      const hydrated = hydrateFakePolicyIrFromJson(parsed);

      expect(hydrated).toBeInstanceOf(FakePolicyIr);
      expect(Object.isFrozen(hydrated)).toBe(true);
      expect(JSON.stringify(hydrated)).toBe(serialized);
      expect({ ...hydrated }).toEqual({ ...original });
    });
  });

  describe('given a PSL document mixing a framework model and a fake_policy block', () => {
    it('round-trips both kinds through parse → print → parse to equivalent AST', () => {
      const source = `model User {
  id Int @id
  email String
}

fake_policy AdminsOnly {
  target = User
  using = "role = \\"admin\\""
}
`;

      const parsed1 = parsePslDocument({
        schema: source,
        sourceId: 'r1',
        pslBlocks: assembled.pslBlocks,
      });
      expect(parsed1.diagnostics).toEqual([]);

      const printed = printPslFromAst(parsed1.ast, { pslBlocks: assembled.pslBlocks });
      const parsed2 = parsePslDocument({
        schema: printed,
        sourceId: 'r2',
        pslBlocks: assembled.pslBlocks,
      });
      expect(parsed2.diagnostics).toEqual([]);

      const ns1 = parsed1.ast.namespaces.find((n) => n.name === UNSPECIFIED_PSL_NAMESPACE_ID);
      const ns2 = parsed2.ast.namespaces.find((n) => n.name === UNSPECIFIED_PSL_NAMESPACE_ID);
      expect(ns2?.models.map((m) => m.name)).toEqual(ns1?.models.map((m) => m.name));
      expect(projectFirstFakePolicy(parsed2.ast)).toEqual(projectFirstFakePolicy(parsed1.ast));
    });
  });

  describe('given a PSL document with a fake_policy block but no pslBlocks contribution in scope', () => {
    it('surfaces the existing unsupported-top-level-block diagnostic naming the keyword', () => {
      const parsed = parsePslDocument({
        schema: 'fake_policy Foo {\n  target = X\n  using = "true"\n}\n',
        sourceId: 'r',
      });

      expect(parsed.ok).toBe(false);
      expect(parsed.diagnostics[0]).toMatchObject({
        code: 'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK',
        message: expect.stringContaining('fake_policy'),
      });
    });
  });
});

function projectFirstFakePolicy(ast: ReturnType<typeof parsePslDocument>['ast']): {
  kind: string;
  name: string;
  target: string;
  using: string;
} {
  const ns = ast.namespaces.find((n) => n.name === UNSPECIFIED_PSL_NAMESPACE_ID);
  const block = ns?.extensionBlocks[0];
  if (!block || !isFakePolicyAst(block)) {
    throw new Error('expected one fake-policy block');
  }
  return {
    kind: block.kind,
    name: block.name,
    target: block.target,
    using: block.using,
  };
}

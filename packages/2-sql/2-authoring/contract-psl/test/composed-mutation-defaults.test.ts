import { parsePslDocument } from '@prisma-next/psl-parser';
import { describe, expect, it } from 'vitest';
import type {
  DefaultFunctionLoweringContext,
  ParsedDefaultFunctionCall,
} from '../src/default-function-registry';
import { interpretPslDocumentToSqlContractIR } from '../src/interpreter';

describe('composed mutation default registries', () => {
  it('rejects known default functions when no components contribute handlers', () => {
    const document = parsePslDocument({
      schema: `model User {
  id Int @id
  externalId String @default(uuid())
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractIR({ document });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNKNOWN_DEFAULT_FUNCTION',
          message: expect.stringContaining('uuid'),
        }),
      ]),
    );
  });

  it('accepts a function contributed through component composition', () => {
    const document = parsePslDocument({
      schema: `model User {
  id Int @id
  slug String @default(slugid())
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractIR({
      document,
      controlMutationDefaults: {
        defaultFunctionRegistry: new Map([
          [
            'slugid',
            (input: {
              call: ParsedDefaultFunctionCall;
              context: DefaultFunctionLoweringContext;
            }) => {
              void input;
              return {
                ok: true as const,
                value: {
                  kind: 'execution' as const,
                  generated: {
                    kind: 'generator' as const,
                    id: 'slugid',
                  },
                },
              };
            },
          ],
        ]),
        generatorDescriptors: [{ id: 'slugid', applicableCodecIds: ['pg/text@1'] }],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.execution?.mutations.defaults).toEqual([
      {
        ref: { table: 'user', column: 'slug' },
        onCreate: { kind: 'generator', id: 'slugid' },
      },
    ]);
  });

  it('emits applicability diagnostics for incompatible generator codec ids', () => {
    const document = parsePslDocument({
      schema: `model User {
  id Int @id @default(slugid())
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractIR({
      document,
      controlMutationDefaults: {
        defaultFunctionRegistry: new Map([
          [
            'slugid',
            () => ({
              ok: true as const,
              value: {
                kind: 'execution' as const,
                generated: {
                  kind: 'generator' as const,
                  id: 'slugid',
                },
              },
            }),
          ],
        ]),
        generatorDescriptors: [{ id: 'slugid', applicableCodecIds: ['pg/text@1'] }],
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_DEFAULT_APPLICABILITY',
          message: expect.stringContaining('slugid'),
        }),
      ]),
    );
  });
});

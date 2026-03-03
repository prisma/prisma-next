import { parsePslDocument } from '@prisma-next/psl-parser';
import { describe, expect, it } from 'vitest';
import type {
  DefaultFunctionLoweringContext,
  ParsedDefaultFunctionCall,
} from '../src/default-function-registry';
import {
  type InterpretPslDocumentToSqlContractIRInput,
  interpretPslDocumentToSqlContractIR as interpretPslDocumentToSqlContractIRInternal,
} from '../src/interpreter';
import { postgresScalarTypeDescriptors, postgresTarget } from './fixtures';

describe('composed mutation default registries', () => {
  const interpretPslDocumentToSqlContractIR = (
    input: Omit<InterpretPslDocumentToSqlContractIRInput, 'target' | 'scalarTypeDescriptors'>,
  ) =>
    interpretPslDocumentToSqlContractIRInternal({
      target: postgresTarget,
      scalarTypeDescriptors: postgresScalarTypeDescriptors,
      ...input,
    });

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
            {
              lower: (input: {
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
              usageSignatures: ['slugid()'],
            },
          ],
        ]),
        generatorDescriptors: [{ id: 'slugid', applicableCodecIds: ['pg/text@1'] }],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toMatchObject({
      execution: {
        mutations: {
          defaults: [
            {
              ref: { table: 'user', column: 'slug' },
              onCreate: { kind: 'generator', id: 'slugid' },
            },
          ],
        },
      },
    });
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
            {
              lower: () => ({
                ok: true as const,
                value: {
                  kind: 'execution' as const,
                  generated: {
                    kind: 'generator' as const,
                    id: 'slugid',
                  },
                },
              }),
              usageSignatures: ['slugid()'],
            },
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

import type { SqlControlExtensionDescriptor } from '@prisma-next/family-sql/control';
import type { DefaultFunctionLoweringHandler } from '@prisma-next/sql-contract-psl';

const slugidDefaultHandler: DefaultFunctionLoweringHandler = ({ call, context }) => {
  if (call.args.length > 0) {
    return {
      ok: false,
      diagnostic: {
        code: 'PSL_INVALID_DEFAULT_FUNCTION_ARGUMENT',
        message: `Default function "${call.name}" for field "${context.modelName}.${context.fieldName}" does not accept arguments.`,
        sourceId: context.sourceId,
        span: call.span,
      },
    };
  }

  return {
    ok: true,
    value: {
      kind: 'execution',
      generated: {
        kind: 'generator',
        id: 'slugid',
      },
    },
  };
};

const slugidDefaultsPack: SqlControlExtensionDescriptor<'postgres'> = {
  kind: 'extension',
  id: 'slugid-defaults',
  version: '0.0.1',
  familyId: 'sql',
  targetId: 'postgres',
  operationSignatures: () => [],
  controlMutationDefaults: () => ({
    defaultFunctionRegistry: new Map([
      ['slugid', { lower: slugidDefaultHandler, usageSignatures: ['slugid()'] }],
    ]),
    generatorDescriptors: [{ id: 'slugid', applicableCodecIds: ['pg/text@1'] }],
  }),
  create() {
    return {
      familyId: 'sql',
      targetId: 'postgres',
    };
  },
};

export const extensionPacks = [slugidDefaultsPack] as const;

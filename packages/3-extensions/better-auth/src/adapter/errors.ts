export type PrismaNextAdapterErrorCode =
  | 'UNKNOWN_MODEL'
  | 'UNKNOWN_FIELD'
  | 'UNSUPPORTED_OPERATOR'
  | 'UNSUPPORTED_WHERE_MODE'
  | 'INVALID_OPERATOR_VALUE'
  | 'UNKNOWN_JOIN_RELATION';

/**
 * Typed error surface of the BetterAuth adapter. Every rejection names the
 * offending surface (model / field / operator) so a misconfigured consumer
 * fails fast with an actionable message instead of leaking a stringly-typed
 * query into SQL.
 */
export class PrismaNextAdapterError extends Error {
  readonly code: PrismaNextAdapterErrorCode;
  readonly model: string | undefined;
  readonly field: string | undefined;
  readonly operator: string | undefined;

  constructor(
    code: PrismaNextAdapterErrorCode,
    message: string,
    surface: { model?: string; field?: string; operator?: string } = {},
  ) {
    super(message);
    this.name = 'PrismaNextAdapterError';
    this.code = code;
    this.model = surface.model;
    this.field = surface.field;
    this.operator = surface.operator;
  }
}

export function unknownModel(
  model: string,
  knownModels: readonly string[],
): PrismaNextAdapterError {
  return new PrismaNextAdapterError(
    'UNKNOWN_MODEL',
    `Unknown BetterAuth model "${model}". The better-auth contract space defines: ${knownModels.join(', ')}. Plugin tables and custom models are not supported by this adapter.`,
    { model },
  );
}

export function unknownField(model: string, field: string): PrismaNextAdapterError {
  return new PrismaNextAdapterError(
    'UNKNOWN_FIELD',
    `Unknown field "${field}" on BetterAuth model "${model}". The better-auth contract space does not define it; additionalFields are not supported by this adapter.`,
    { model, field },
  );
}

export function unsupportedOperator(
  model: string,
  field: string,
  operator: string,
): PrismaNextAdapterError {
  return new PrismaNextAdapterError(
    'UNSUPPORTED_OPERATOR',
    `Operator "${operator}" is not supported for field "${field}" on model "${model}".`,
    { model, field, operator },
  );
}

export function unsupportedWhereMode(
  model: string,
  field: string,
  operator: string,
): PrismaNextAdapterError {
  return new PrismaNextAdapterError(
    'UNSUPPORTED_WHERE_MODE',
    `Case-insensitive comparison (mode: "insensitive") is not supported for field "${field}" on model "${model}" (operator "${operator}").`,
    { model, field, operator },
  );
}

export function unknownJoinRelation(
  model: string,
  joinModel: string,
  on: { from: string; to: string },
): PrismaNextAdapterError {
  return new PrismaNextAdapterError(
    'UNKNOWN_JOIN_RELATION',
    `No contract relation on model "${model}" joins "${joinModel}" via ${model}.${on.from} → ${joinModel}.${on.to}. The better-auth contract space declares no such navigable relation.`,
    { model, field: on.from },
  );
}

export function invalidOperatorValue(
  model: string,
  field: string,
  operator: string,
  expected: string,
): PrismaNextAdapterError {
  return new PrismaNextAdapterError(
    'INVALID_OPERATOR_VALUE',
    `Operator "${operator}" on "${model}"."${field}" expects ${expected}.`,
    { model, field, operator },
  );
}

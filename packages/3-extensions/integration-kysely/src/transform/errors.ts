export const KYSELY_TRANSFORM_ERROR_CODES = {
  UNSUPPORTED_NODE: 'KYSELY_TRANSFORM_UNSUPPORTED_NODE',
  INVALID_REF: 'KYSELY_TRANSFORM_INVALID_REF',
  CONTRACT_VALIDATION: 'KYSELY_TRANSFORM_CONTRACT_VALIDATION',
} as const;

export type KyselyTransformErrorCode =
  (typeof KYSELY_TRANSFORM_ERROR_CODES)[keyof typeof KYSELY_TRANSFORM_ERROR_CODES];

export interface KyselyTransformErrorDetails {
  readonly nodeKind?: string;
  readonly table?: string;
  readonly column?: string;
  readonly path?: string;
  readonly [key: string]: unknown;
}

export class KyselyTransformError extends Error {
  static readonly ERROR_NAME = 'KyselyTransformError' as const;
  readonly code: KyselyTransformErrorCode;
  readonly details: KyselyTransformErrorDetails;

  constructor(
    message: string,
    code: KyselyTransformErrorCode,
    details: KyselyTransformErrorDetails = {},
  ) {
    super(message);
    this.name = KyselyTransformError.ERROR_NAME;
    this.code = code;
    this.details = Object.freeze({ ...details });
  }

  static is(error: unknown): error is KyselyTransformError {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as KyselyTransformError).name === KyselyTransformError.ERROR_NAME
    );
  }
}

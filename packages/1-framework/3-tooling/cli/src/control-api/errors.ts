export class ContractValidationError extends Error {
  readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'ContractValidationError';
    this.cause = cause;
  }
}

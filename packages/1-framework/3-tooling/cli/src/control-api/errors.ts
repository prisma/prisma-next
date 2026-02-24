export class ContractValidationError extends Error {
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'ContractValidationError';
    this.cause = cause;
  }
}

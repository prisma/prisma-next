export class ConfigValidationError extends Error {
  readonly field: string;
  readonly why: string;

  constructor(field: string, why?: string) {
    super(why ?? `Config must have a "${field}" field`);
    this.name = 'ConfigValidationError';
    this.field = field;
    this.why = why ?? `Config must have a "${field}" field`;
  }
}

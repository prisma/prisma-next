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

export class ConfigFileNotFoundError extends Error {
  readonly configPath?: string;
  readonly why?: string;

  constructor(configPath?: string, why?: string) {
    super(why ?? (configPath ? `Config file not found: ${configPath}` : 'Config file not found'));
    this.name = 'ConfigFileNotFoundError';
    if (configPath !== undefined) {
      this.configPath = configPath;
    }
    if (why !== undefined) {
      this.why = why;
    }
  }
}

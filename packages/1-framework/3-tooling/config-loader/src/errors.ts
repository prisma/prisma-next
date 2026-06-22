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

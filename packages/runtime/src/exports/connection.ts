// Database connection functionality
import { DatabaseConnection, ConnectionConfig } from '../connection';

export function connect(config: ConnectionConfig): DatabaseConnection {
  return new DatabaseConnection(config);
}

export { DatabaseConnection, ConnectionConfig };

import { validateSchema } from './schema';

/**
 * Parses and validates Intermediate Representation (IR) from JSON data
 * 
 * @param jsonData - Raw JSON data (string or parsed object)
 * @returns Validated IR object
 * @throws Error if JSON is invalid or IR validation fails
 */
export function parseIR(jsonData: string | unknown) {
  try {
    const parsed = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
    return validateSchema(parsed);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in IR data: ${error.message}`);
    }
    throw new Error(`Failed to parse IR: ${error}`);
  }
}

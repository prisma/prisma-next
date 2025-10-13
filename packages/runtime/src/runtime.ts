import { Schema } from '@prisma/relational-ir';
import { Plan } from '@prisma/sql';
import { DatabaseConnection } from './connection';
import { RuntimePlugin, RuntimeConfig, QueryResult, QueryMetrics } from './plugin';

export class Runtime {
  private plugins: RuntimePlugin[] = [];
  private driver: DatabaseConnection;
  private ir: Schema;
  private config: RuntimeConfig;

  constructor(options: {
    ir: Schema;
    driver: DatabaseConnection;
    config?: RuntimeConfig;
    plugins?: RuntimePlugin[];
  }) {
    this.ir = options.ir;
    this.driver = options.driver;
    this.config = options.config || {};
    if (options.plugins) {
      options.plugins.forEach((p) => this.use(p));
    }
  }

  use(plugin: RuntimePlugin): this {
    this.plugins.push(plugin);
    return this;
  }

  async execute<TResult>(plan: Plan<TResult>): Promise<TResult[]> {
    // beforeExecute hooks
    for (const plugin of this.plugins) {
      if (plugin.beforeExecute) {
        await plugin.beforeExecute({ plan, ir: this.ir, config: this.config, driver: this.driver });
      }
    }

    try {
      const start = performance.now();
      const result = await this.driver.execute(plan);
      const durationMs = performance.now() - start;

      const queryResult: QueryResult = { rows: result, rowCount: result.length };
      const metrics: QueryMetrics = { durationMs, rowCount: result.length };

      // afterExecute hooks
      for (const plugin of this.plugins) {
        if (plugin.afterExecute) {
          await plugin.afterExecute({ plan, result: queryResult, metrics, ir: this.ir });
        }
      }

      return result as TResult[];
    } catch (error) {
      // onError hooks
      for (const plugin of this.plugins) {
        if (plugin.onError) {
          await plugin.onError({ plan, error, ir: this.ir });
        }
      }
      throw error;
    }
  }
}

export function createRuntime(options: {
  ir: Schema;
  driver: DatabaseConnection;
  config?: RuntimeConfig;
  plugins?: RuntimePlugin[];
}): Runtime {
  return new Runtime(options);
}

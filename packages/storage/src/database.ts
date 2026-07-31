import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import { migrations } from "./schema.js";

export interface DatabaseOptions {
  path?: string;
}

export class AppDatabase {
  readonly raw: DatabaseSync;
  private transactionDepth = 0;

  constructor(options: DatabaseOptions = {}) {
    this.raw = new DatabaseSync(options.path ?? ":memory:", {
      enableForeignKeyConstraints: true,
    });
    this.raw.exec("PRAGMA foreign_keys = ON;");
    this.raw.exec("PRAGMA busy_timeout = 5000;");
    this.raw.exec("PRAGMA journal_mode = WAL;");
    this.raw.exec("PRAGMA synchronous = NORMAL;");
    this.migrate();
  }

  close(): void {
    this.raw.close();
  }

  transaction<T>(work: () => T): T {
    if (this.transactionDepth > 0) {
      const savepoint = `nested_${this.transactionDepth}`;
      this.raw.exec(`SAVEPOINT ${savepoint}`);
      this.transactionDepth += 1;
      try {
        const result = work();
        this.raw.exec(`RELEASE SAVEPOINT ${savepoint}`);
        return result;
      } catch (error) {
        this.raw.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        this.raw.exec(`RELEASE SAVEPOINT ${savepoint}`);
        throw error;
      } finally {
        this.transactionDepth -= 1;
      }
    }

    this.raw.exec("BEGIN IMMEDIATE");
    this.transactionDepth = 1;
    try {
      const result = work();
      this.raw.exec("COMMIT");
      return result;
    } catch (error) {
      this.raw.exec("ROLLBACK");
      throw error;
    } finally {
      this.transactionDepth = 0;
    }
  }

  run(sql: string, ...params: SQLInputValue[]): void {
    this.raw.prepare(sql).run(...params);
  }

  get<T extends object>(
    sql: string,
    ...params: SQLInputValue[]
  ): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }

  all<T extends object>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }

  private migrate(): void {
    this.raw.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
    const applied = new Set(
      this.all<{ version: number }>(
        "SELECT version FROM schema_migrations",
      ).map((row) => row.version),
    );
    for (const migration of migrations) {
      if (applied.has(migration.version)) {
        continue;
      }
      this.transaction(() => {
        this.raw.exec(migration.sql);
        this.run(
          "INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)",
          migration.version,
          migration.name,
          new Date().toISOString(),
        );
      });
    }
  }
}

import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type * as schema from './schema.ts';

export type AppDatabase = PgDatabase<any, typeof schema>;

export async function runMigrations(
  database: AppDatabase,
  rawExec?: (sqlText: string) => Promise<void>
): Promise<void> {
  await database.execute(sql`
    CREATE TABLE IF NOT EXISTS "__habitflow_migrations" (
      "id" serial PRIMARY KEY,
      "tag" text NOT NULL UNIQUE,
      "applied_at" timestamp with time zone DEFAULT now() NOT NULL
    );
  `);

  const drizzleDir = path.resolve(process.cwd(), 'drizzle');
  if (!fs.existsSync(drizzleDir)) {
    return;
  }

  const files = fs
    .readdirSync(drizzleDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const existing = await database.execute(
      sql`SELECT tag FROM "__habitflow_migrations" WHERE tag = ${file} LIMIT 1`
    );
    const rows = Array.isArray((existing as any).rows) ? (existing as any).rows : (existing as any);
    if (rows && rows.length > 0) {
      continue;
    }

    const migrationSql = fs.readFileSync(path.join(drizzleDir, file), 'utf8');
    if (rawExec) {
      await rawExec(migrationSql);
    } else {
      const statements = migrationSql
        .split(/;\s*\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      for (const stmt of statements) {
        await database.execute(sql.raw(stmt));
      }
    }

    await database.execute(
      sql`INSERT INTO "__habitflow_migrations" ("tag") VALUES (${file}) ON CONFLICT ("tag") DO NOTHING`
    );
  }
}

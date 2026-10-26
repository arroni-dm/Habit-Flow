import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { Pool } from 'pg';
import * as schema from './schema.ts';
import { runMigrations, type AppDatabase } from './migrate.ts';

export type { AppDatabase };

interface ManagedDbContext {
  db: AppDatabase;
  close: () => Promise<void>;
  rawExec?: (sqlText: string) => Promise<void>;
}

declare global {
  var __habitflowDbContext: ManagedDbContext | undefined;
  var __habitflowMigrated: Promise<void> | undefined;
}

export function createManagedDatabase(options?: {
  inMemory?: boolean;
  dataDir?: string;
  connectionString?: string;
}): ManagedDbContext {
  const connString = options?.connectionString ?? process.env.DATABASE_URL?.trim();

  if (connString && !options?.inMemory) {
    const pool = new Pool({
      connectionString: connString,
      max: 10,
      connectionTimeoutMillis: 15000,
    });
    pool.on('error', (err) => {
      console.error('PostgreSQL pool client error:', err.message);
    });
    const db = drizzleNodePg(pool, { schema }) as unknown as AppDatabase;
    return {
      db,
      rawExec: async (sqlText: string) => {
        await pool.query(sqlText);
      },
      close: async () => {
        await pool.end();
      },
    };
  }

  if (options?.inMemory) {
    const client = new PGlite();
    const db = drizzlePglite(client, { schema }) as unknown as AppDatabase;
    return {
      db,
      rawExec: async (sqlText: string) => {
        await client.exec(sqlText);
      },
      close: async () => {
        await client.close();
      },
    };
  }

  const configuredDir = options?.dataDir ?? process.env.PGDATA_DIR?.trim() ?? './data/pgdata';
  const resolvedDir = path.resolve(process.cwd(), configuredDir);
  fs.mkdirSync(path.dirname(resolvedDir), { recursive: true });

  const client = new PGlite(resolvedDir);
  const db = drizzlePglite(client, { schema }) as unknown as AppDatabase;

  return {
    db,
    rawExec: async (sqlText: string) => {
      await client.exec(sqlText);
    },
    close: async () => {
      await client.close();
    },
  };
}

export function getDbContext(): ManagedDbContext {
  if (!globalThis.__habitflowDbContext) {
    globalThis.__habitflowDbContext = createManagedDatabase();
  }
  return globalThis.__habitflowDbContext;
}

export async function ensureDatabaseReady(): Promise<AppDatabase> {
  const ctx = getDbContext();
  if (!globalThis.__habitflowMigrated) {
    globalThis.__habitflowMigrated = runMigrations(ctx.db, ctx.rawExec);
  }
  await globalThis.__habitflowMigrated;
  return ctx.db;
}

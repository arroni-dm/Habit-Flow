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

  // Vercel Serverless environment check
  const isVercel = process.env.VERCEL === '1';
  const configuredDir = options?.dataDir ?? process.env.PGDATA_DIR?.trim() ?? (isVercel ? '/tmp/pgdata' : './data/pgdata');
  const resolvedDir = isVercel ? configuredDir : path.resolve(process.cwd(), configuredDir);

  fs.mkdirSync(path.dirname(resolvedDir), { recursive: true });

  // Vercel serverless instance handling (Bypass strict file lock for /tmp)
  if (isVercel) {
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

  const lockPath = `${resolvedDir}.lock`;
  const owner = String(process.pid);
  try {
    fs.writeFileSync(lockPath, owner, { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const existingPid = Number(fs.readFileSync(lockPath, 'utf8'));
    if (!Number.isSafeInteger(existingPid) || existingPid <= 0) {
      throw new Error(`Invalid database lock: ${lockPath}. Inspect it before restarting.`);
    }
    try {
      process.kill(existingPid, 0);
    } catch (probeError) {
      if ((probeError as NodeJS.ErrnoException).code !== 'ESRCH') throw probeError;
      fs.unlinkSync(lockPath);
      fs.writeFileSync(lockPath, owner, { flag: 'wx' });
    }
    if (fs.readFileSync(lockPath, 'utf8') !== owner) {
      throw new Error(`Database is already open in process ${existingPid}. Stop the other HabitFlow server first.`);
    }
  }
  const releaseLock = () => {
    if (fs.existsSync(lockPath) && fs.readFileSync(lockPath, 'utf8') === owner) {
      fs.unlinkSync(lockPath);
    }
  };
  process.once('exit', releaseLock);
  const client = new PGlite(resolvedDir);
  const db = drizzlePglite(client, { schema }) as unknown as AppDatabase;

  return {
    db,
    rawExec: async (sqlText: string) => {
      await client.exec(sqlText);
    },
    close: async () => {
      await client.close();
      releaseLock();
      process.removeListener('exit', releaseLock);
    },
  };
}

export async function closeDatabase(): Promise<void> {
  await globalThis.__habitflowDbContext?.close();
  globalThis.__habitflowDbContext = undefined;
  globalThis.__habitflowMigrated = undefined;
}

export function getDbContext(): ManagedDbContext {
  if (!globalThis.__habitflowDbContext) {
    const isVercel = process.env.VERCEL === '1';
    globalThis.__habitflowDbContext = createManagedDatabase({
      inMemory: isVercel || undefined
    });
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
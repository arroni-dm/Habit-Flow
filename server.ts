import path from 'node:path';
import * as dotenv from 'dotenv';
import express from 'express';
import { closeDatabase, ensureDatabaseReady } from './src/db/index.ts';
import { createApp } from './src/server/app.ts';
import { runGlobalReminderSweep } from './src/server/reminders.ts';

dotenv.config();

if (process.argv.includes('--production')) {
  process.env.NODE_ENV = 'production';
}

const PORT = 3000;

async function startServer() {
  const db = await ensureDatabaseReady();
  const app = createApp(async () => db);
  let closeVite: (() => Promise<void>) | undefined;

  // Run server-side background reminder evaluation every 60 seconds
  const reminderTimer = setInterval(() => {
    void runGlobalReminderSweep(db, new Date());
  }, 60_000);
  reminderTimer.unref();

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    closeVite = () => vite.close();
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`HabitFlow server listening on http://localhost:${PORT}`);
  });
  let shuttingDown = false;
  const shutdown = async (exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(reminderTimer);
    try {
      await closeVite?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await closeDatabase();
      process.exit(exitCode);
    } catch (error) {
      console.error('Server shutdown failed:', error);
      process.exit(1);
    }
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  server.on('error', (error) => {
    console.error('Unable to listen on port 3000. Stop any other HabitFlow server.', error.message);
    void shutdown(1);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});

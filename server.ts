import path from 'node:path';
import * as dotenv from 'dotenv';
import express from 'express';
import { ensureDatabaseReady } from './src/db/index.ts';
import { createApp } from './src/server/app.ts';
import { runGlobalReminderSweep } from './src/server/reminders.ts';

dotenv.config();

const PORT = 3000;

async function startServer() {
  const db = await ensureDatabaseReady();
  const app = createApp(async () => db);

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
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`HabitFlow server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});

import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { NextFunction, Request, Response } from 'express';
import type { AppDatabase } from '../db/index.ts';
import { userSessions, users } from '../db/schema.ts';
import type { UserProfile } from '../shared/types.ts';
import { mapUserToProfile } from './mappers.ts';

export const SESSION_COOKIE_NAME = 'habitflow_sid';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface AuthenticatedRequest extends Request {
  authUser?: UserProfile;
  csrfToken?: string;
  sessionIdHash?: string;
}

export async function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, 10);
}

export async function verifyPassword(plainPassword: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plainPassword, hash);
}

export function hashOpaqueToken(rawToken: string): string {
  const secret = process.env.SESSION_SECRET || 'habitflow-default-token-salt-v1';
  return crypto.createHmac('sha256', secret).update(rawToken).digest('hex');
}

export function generateRandomToken(bytes: number = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

function shouldUseSecureCookie(req: Request): boolean {
  if (process.env.NODE_ENV === 'test') return false;
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (req.secure || forwardedProto === 'https') return true;
  if (process.env.APP_URL?.startsWith('https://')) return true;
  return process.env.NODE_ENV === 'production';
}

export function extractRawSessionToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer.length >= 16) {
      return bearer;
    }
  }
  const cookieToken = req.cookies?.[SESSION_COOKIE_NAME];
  if (typeof cookieToken === 'string' && cookieToken.trim().length >= 16) {
    return cookieToken.trim();
  }
  return null;
}

export async function createUserSession(
  db: AppDatabase,
  userId: number,
  req: Request,
  res: Response
): Promise<{ sessionToken: string; csrfToken: string; expiresAt: Date }> {
  const rawSessionToken = generateRandomToken(32);
  const sessionIdHash = hashOpaqueToken(rawSessionToken);
  const csrfToken = generateRandomToken(24);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  // Opportunistically clean up expired sessions for this user
  await db
    .delete(userSessions)
    .where(and(eq(userSessions.userId, userId), lt(userSessions.expiresAt, new Date())));

  await db.insert(userSessions).values({
    id: sessionIdHash,
    userId,
    csrfToken,
    ipAddress: req.ip || null,
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 255) : null,
    expiresAt,
  });

  const isSecure = shouldUseSecureCookie(req);
  res.cookie(SESSION_COOKIE_NAME, rawSessionToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite: isSecure ? 'none' : 'lax',
    partitioned: isSecure,
    path: '/',
    maxAge: SESSION_TTL_MS,
  });

  return { sessionToken: rawSessionToken, csrfToken, expiresAt };
}

export async function destroyUserSession(
  db: AppDatabase,
  req: Request,
  res: Response
): Promise<void> {
  const rawToken = extractRawSessionToken(req);
  if (rawToken) {
    const idHash = hashOpaqueToken(rawToken);
    await db.delete(userSessions).where(eq(userSessions.id, idHash));
  }
  const isSecure = shouldUseSecureCookie(req);
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: isSecure,
    sameSite: isSecure ? 'none' : 'lax',
    partitioned: isSecure,
    path: '/',
  });
}

export function createRequireAuth(getDb: () => Promise<AppDatabase>) {
  return async function requireAuth(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const rawToken = extractRawSessionToken(req);
      if (!rawToken) {
        res.status(401).json({ error: 'Authentication required.' });
        return;
      }

      const db = await getDb();
      const idHash = hashOpaqueToken(rawToken);
      const now = new Date();

      const rows = await db
        .select({
          session: userSessions,
          user: users,
        })
        .from(userSessions)
        .innerJoin(users, eq(userSessions.userId, users.id))
        .where(and(eq(userSessions.id, idHash), gt(userSessions.expiresAt, now)))
        .limit(1);

      if (rows.length === 0) {
        res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
        return;
      }

      const { session, user } = rows[0];

      // Enforce CSRF token on state-changing HTTP methods
      const mutatingMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
      if (mutatingMethods.includes(req.method.toUpperCase())) {
        const headerCsrf = req.headers['x-csrf-token'];
        if (!headerCsrf || headerCsrf !== session.csrfToken) {
          res.status(403).json({ error: 'Invalid or missing CSRF security token.' });
          return;
        }
      }

      req.authUser = mapUserToProfile(user);
      req.csrfToken = session.csrfToken;
      req.sessionIdHash = session.id;
      next();
    } catch (error) {
      console.error('Authentication check failed:', error);
      res.status(500).json({ error: 'Authentication verification failed.' });
    }
  };
}

export function createRateLimiter(options: { windowMs: number; maxRequests: number }) {
  const hits = new Map<string, number[]>();

  return function rateLimiter(req: Request, res: Response, next: NextFunction): void {
    if (process.env.DISABLE_RATE_LIMIT === 'true') {
      next();
      return;
    }

    const key = `${req.ip || 'local'}:${req.path}`;
    const now = Date.now();
    const cutoff = now - options.windowMs;
    const recent = (hits.get(key) ?? []).filter((ts) => ts > cutoff);

    if (recent.length >= options.maxRequests) {
      res.status(429).json({
        error: 'Too many requests. Please wait a moment and try again.',
      });
      return;
    }

    recent.push(now);
    hits.set(key, recent);
    next();
  };
}

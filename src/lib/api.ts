const SESSION_STORAGE_KEY = 'habitflow_session_token';
const CSRF_STORAGE_KEY = 'habitflow_csrf_token';

function readStoredValue(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStoredValue(key: string, value: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (value) {
      window.localStorage.setItem(key, value);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage quota / sandboxed iframe restrictions; memory fallback remains active
  }
}

let memorySessionToken: string | null = readStoredValue(SESSION_STORAGE_KEY);
let memoryCsrfToken: string | null = readStoredValue(CSRF_STORAGE_KEY);

export function setCsrfToken(token: string | null): void {
  memoryCsrfToken = token;
  writeStoredValue(CSRF_STORAGE_KEY, token);
}

export function getCsrfToken(): string | null {
  return memoryCsrfToken;
}

export function setSessionToken(token: string | null): void {
  memorySessionToken = token;
  writeStoredValue(SESSION_STORAGE_KEY, token);
}

export function getSessionToken(): string | null {
  return memorySessionToken;
}

export function clearAuthTokens(): void {
  setSessionToken(null);
  setCsrfToken(null);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function apiFetch<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});

  if (!(options.body instanceof FormData) && !headers.has('Content-Type') && method !== 'GET') {
    headers.set('Content-Type', 'application/json');
  }

  if (memorySessionToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${memorySessionToken}`);
  }

  if (memoryCsrfToken && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    headers.set('x-csrf-token', memoryCsrfToken);
  }

  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      method,
      headers,
      credentials: 'include',
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError(
      'Cannot reach the HabitFlow server. Keep npm run dev running in your terminal, open http://localhost:3000, and try again.',
      0
    );
  }

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const errBody = await response.json();
      if (errBody?.error) message = String(errBody.error);
    } catch {
      // Ignore non-JSON body
    }
    throw new ApiError(message, response.status);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await response.json();
    if (data && typeof data.sessionToken === 'string') {
      setSessionToken(data.sessionToken);
    }
    if (data && typeof data.csrfToken === 'string') {
      setCsrfToken(data.csrfToken);
    }
    return data as T;
  }

  return (await response.text()) as unknown as T;
}

export async function downloadAuthenticatedCsv(url: string, fallbackFilename: string): Promise<void> {
  const headers = new Headers();
  if (memorySessionToken) {
    headers.set('Authorization', `Bearer ${memorySessionToken}`);
  }

  const response = await fetch(url, {
    method: 'GET',
    headers,
    credentials: 'include',
  });

  if (!response.ok) {
    let message = 'Export failed.';
    try {
      const err = await response.json();
      if (err?.error) message = err.error;
    } catch {
      // ignore
    }
    throw new ApiError(message, response.status);
  }

  const disposition = response.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/i);
  const filename = match?.[1] || fallbackFilename;

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

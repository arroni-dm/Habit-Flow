/**
 * Protects the application when running inside preview iframes where `window.fetch`
 * is defined with only a getter and third-party browser extensions (e.g. `frame_ant.js`)
 * attempt to assign `window.fetch = ...`.
 */
export function ensureWritableWindowFetch(target: Window & typeof globalThis = window): void {
  try {
    const desc = Object.getOwnPropertyDescriptor(target, 'fetch');
    if (
      desc &&
      typeof desc.get === 'function' &&
      typeof desc.set !== 'function' &&
      desc.configurable !== false
    ) {
      const origGet = desc.get;
      let assignedFetch: typeof fetch | null = null;
      Object.defineProperty(target, 'fetch', {
        configurable: true,
        enumerable: desc.enumerable !== false,
        get() {
          return assignedFetch ?? origGet.call(target);
        },
        set(fn: unknown) {
          if (typeof fn === 'function') {
            assignedFetch = fn as typeof fetch;
          }
        },
      });
    }
  } catch {
    // Ignore if non-configurable in restricted runtime
  }
}

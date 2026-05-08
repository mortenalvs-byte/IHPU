// Persistent storage adapter for TestSession autosave.
//
// Wraps `localStorage` with a probe that survives:
//   - private-browsing modes that throw on setItem
//   - non-browser environments where localStorage is undefined (Node tests,
//     SSR, etc.)
//   - corrupted JSON in the slot from earlier app versions
//
// Every public function is no-throw. A failed save is reported via the
// return value, never via an exception. The renderer must keep working
// even if persistence breaks.

import {
  parseTestSessionJson,
  serializeTestSession
} from './sessionModel';
import {
  SESSION_STORAGE_KEY,
  type SessionLoadResult,
  type TestSession
} from './sessionTypes';

export interface SaveOutcome {
  ok: boolean;
  reason?: 'STORAGE_UNAVAILABLE' | 'WRITE_FAILED';
  message?: string;
}

/**
 * Optional injection point for tests. Falls back to `globalThis.localStorage`
 * when undefined, so production code doesn't need to know about it.
 */
export interface StorageBackend {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

let _backendOverride: StorageBackend | null = null;

/**
 * Test-only: replace the storage backend. Pass `null` to revert.
 */
export function _setStorageBackendForTests(backend: StorageBackend | null): void {
  _backendOverride = backend;
}

function getBackend(): StorageBackend | null {
  if (_backendOverride !== null) return _backendOverride;
  try {
    const candidate = (globalThis as { localStorage?: Storage }).localStorage;
    if (!candidate) return null;
    // Probe — some sandboxed contexts expose localStorage but throw on use.
    const probe = '__ihpu_storage_probe__';
    candidate.setItem(probe, '1');
    candidate.removeItem(probe);
    return {
      getItem: (k) => candidate.getItem(k),
      setItem: (k, v) => candidate.setItem(k, v),
      removeItem: (k) => candidate.removeItem(k)
    };
  } catch {
    return null;
  }
}

export function isLocalStorageAvailable(): boolean {
  return getBackend() !== null;
}

export function saveLastSession(session: TestSession): SaveOutcome {
  const backend = getBackend();
  if (!backend) {
    return {
      ok: false,
      reason: 'STORAGE_UNAVAILABLE',
      message: 'localStorage er ikke tilgjengelig — autosave er deaktivert.'
    };
  }
  try {
    const text = serializeTestSession(session);
    backend.setItem(SESSION_STORAGE_KEY, text);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: 'WRITE_FAILED',
      message: `Kunne ikke lagre økt: ${err instanceof Error ? err.message : String(err)}`
    };
  }
}

export function loadLastSession(): SessionLoadResult {
  const backend = getBackend();
  if (!backend) {
    return {
      ok: false,
      reason: 'STORAGE_UNAVAILABLE',
      message: 'localStorage er ikke tilgjengelig.'
    };
  }
  let text: string | null;
  try {
    text = backend.getItem(SESSION_STORAGE_KEY);
  } catch {
    return {
      ok: false,
      reason: 'STORAGE_UNAVAILABLE',
      message: 'Kunne ikke lese fra localStorage.'
    };
  }
  if (text === null) {
    return { ok: false, reason: 'NOT_FOUND', message: 'Ingen lagret økt funnet.' };
  }
  const parsed = parseTestSessionJson(text);
  if (!parsed.ok) {
    return { ok: false, reason: 'INVALID', error: parsed.error };
  }
  return { ok: true, session: parsed.session };
}

export function clearLastSession(): SaveOutcome {
  const backend = getBackend();
  if (!backend) {
    return { ok: false, reason: 'STORAGE_UNAVAILABLE', message: 'localStorage er ikke tilgjengelig.' };
  }
  try {
    backend.removeItem(SESSION_STORAGE_KEY);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: 'WRITE_FAILED',
      message: `Kunne ikke fjerne økt: ${err instanceof Error ? err.message : String(err)}`
    };
  }
}

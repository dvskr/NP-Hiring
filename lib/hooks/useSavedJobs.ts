'use client';

import { useEffect, useCallback, useMemo, useSyncExternalStore } from 'react';
// F2: localStorage shape + persistence live in the shared module so this hook
// and SaveJobButton can never write incompatible serializations to the same key.
import {
  read as getStoredSavedJobs,
  _write as setStoredSavedJobs,
  SAVED_JOBS_KEY,
  type SavedJobsMap,
} from '@/lib/saved-jobs';
import { useToast } from '@/components/ui/ToastProvider';

const STORAGE_KEY = SAVED_JOBS_KEY;
const API_PATH = '/api/saved-jobs';
const FRESH_MS = 30_000;
const NOTICE_DEDUPE_MS = 3_000;

/**
 * Where the saved list currently comes from:
 *   - unknown        not resolved yet (always the value during SSR + hydration)
 *   - authenticated  the server list is authoritative and mutations sync to it
 *   - anonymous      signed out; saves live in this browser only
 *   - error          a session cookie exists but the server list could not be
 *                    loaded; the local cache is shown and mutations still try
 *                    the server (and roll back visibly if that fails)
 */
export type SavedJobsAuthStatus = 'unknown' | 'authenticated' | 'anonymous' | 'error';

export type SavedJobsNoticeKind = 'device-only' | 'save-failed' | 'remove-failed';

export const SAVED_JOBS_NOTICE_MESSAGES: Record<SavedJobsNoticeKind, string> = {
  'device-only': 'Saved on this device only. Sign in to save jobs to your account.',
  'save-failed': 'We could not save this job. Please try again.',
  'remove-failed': 'We could not remove this saved job. Please try again.',
};

interface UseSavedJobsReturn {
  savedJobs: string[];
  isSaved: (jobId: string) => boolean;
  saveJob: (jobId: string) => void;
  removeJob: (jobId: string) => void;
  clearAll: () => void;
  savedAt: (jobId: string) => Date | null;
  authStatus: SavedJobsAuthStatus;
}

/**
 * Module-level shared state (one fetch per page, shared by every hook
 * instance). Components read it through useSyncExternalStore so the server
 * snapshot (empty, status unknown) is what hydration renders; the
 * localStorage-backed client snapshot only appears in the post-hydration
 * re-render. Reading localStorage during the hydration render is what caused
 * React error #418 on /saved, /jobs and every JobCard list.
 */
let cachedMap: SavedJobsMap | null = null;
let lastSyncAt = 0;
let authStatus: SavedJobsAuthStatus = 'unknown';
let migrated = false;
let inflight: Promise<void> | null = null;
const subscribers = new Set<() => void>();

const EMPTY_MAP: SavedJobsMap = Object.freeze({}) as SavedJobsMap;

/**
 * Mutations the server has not confirmed yet. A server sync that lands while
 * one is pending re-applies it on top of the server list, so an early click
 * is never overwritten by the (older) GET response.
 */
interface PendingOp {
  kind: 'save' | 'remove';
}
const pendingOps = new Map<string, PendingOp>();
/** Per job serial queue so save then unsave reach the server in order. */
const jobQueues = new Map<string, Promise<void>>();

type NoticeHandler = (kind: SavedJobsNoticeKind) => void;
const noticeHandlers = new Set<NoticeHandler>();
const lastNoticeAt = new Map<SavedJobsNoticeKind, number>();

function notify() {
  for (const cb of subscribers) cb();
}

function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

/**
 * Hydrate the module cache from localStorage on first access. Only ever
 * reached from the client snapshot (never during SSR or the hydration
 * render), so it cannot produce a server/client markup mismatch.
 */
function ensureCacheHydrated(): void {
  if (cachedMap === null && typeof window !== 'undefined') {
    cachedMap = getStoredSavedJobs();
  }
}

function getMapSnapshot(): SavedJobsMap {
  ensureCacheHydrated();
  return cachedMap ?? EMPTY_MAP;
}

function getServerMapSnapshot(): SavedJobsMap {
  return EMPTY_MAP;
}

function getAuthSnapshot(): SavedJobsAuthStatus {
  return authStatus;
}

function getServerAuthSnapshot(): SavedJobsAuthStatus {
  return 'unknown';
}

function setAuthStatus(next: SavedJobsAuthStatus) {
  if (authStatus === next) return;
  authStatus = next;
  notify();
}

function applyMap(next: SavedJobsMap, persistLocal = true) {
  cachedMap = next;
  if (persistLocal) setStoredSavedJobs(next);
  notify();
}

function emitNotice(kind: SavedJobsNoticeKind) {
  const now = Date.now();
  const last = lastNoticeAt.get(kind) ?? 0;
  if (now - last < NOTICE_DEDUPE_MS) return;
  lastNoticeAt.set(kind, now);
  // Every mounted hook registers the same toast function; deliver once.
  const first = noticeHandlers.values().next();
  if (!first.done) first.value(kind);
}

/**
 * Heuristic: anonymous visitors have no Supabase auth cookie, so the GET
 * is guaranteed to 401. Skip it to keep the browser console clean.
 */
function hasLikelyAuthCookie(): boolean {
  if (typeof document === 'undefined') return false;
  // @supabase/ssr splits large sessions into sb-<ref>-auth-token.0, .1, ...
  // A chunked session must still count, or a signed-in user's saves would
  // be treated as device-only and never reach the server.
  return /(?:^|;\s*)sb-[^=]+-auth-token(?:\.\d+)?=/.test(document.cookie);
}

function withPendingOverlay(base: SavedJobsMap): SavedJobsMap {
  if (pendingOps.size === 0) return base;
  const next: SavedJobsMap = { ...base };
  for (const [jobId, op] of pendingOps) {
    if (op.kind === 'save') {
      if (!(jobId in next)) next[jobId] = cachedMap?.[jobId] ?? new Date().toISOString();
    } else {
      delete next[jobId];
    }
  }
  return next;
}

async function syncFromServer(force = false): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!hasLikelyAuthCookie()) {
    setAuthStatus('anonymous');
    return;
  }
  const now = Date.now();
  if (!force && now - lastSyncAt < FRESH_MS && lastSyncAt > 0) return;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch(API_PATH, { credentials: 'include' });
      lastSyncAt = Date.now();
      if (res.status === 401) {
        setAuthStatus('anonymous');
        return;
      }
      if (!res.ok) {
        if (authStatus !== 'authenticated') setAuthStatus('error');
        return;
      }
      const data = (await res.json()) as { savedJobs?: Array<{ jobId: string; savedAt: string }> };
      const serverMap: SavedJobsMap = Object.fromEntries(
        (data.savedJobs ?? []).map((r) => [r.jobId, r.savedAt]),
      );

      // First-time migration: push localStorage-only entries to the server
      // so authenticated users don't lose history accumulated while anonymous.
      // Entries with a pending mutation are sent by their own queue.
      let merged: SavedJobsMap = serverMap;
      if (!migrated) {
        migrated = true;
        const local = getStoredSavedJobs();
        const localOnly = Object.keys(local).filter(
          (id) => !(id in serverMap) && !pendingOps.has(id),
        );
        if (localOnly.length > 0) {
          await Promise.allSettled(
            localOnly.map((jobId) =>
              fetch(API_PATH, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ jobId }),
              }),
            ),
          );
          merged = { ...serverMap };
          for (const id of localOnly) if (!(id in merged)) merged[id] = local[id];
        }
      }
      authStatus = 'authenticated';
      applyMap(withPendingOverlay(merged));
    } catch {
      // Network down / parse error: stay on whatever the local cache holds.
      if (authStatus !== 'authenticated') setAuthStatus('error');
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function settle(jobId: string, op: PendingOp) {
  if (pendingOps.get(jobId) === op) pendingOps.delete(jobId);
}

function rollback(jobId: string, op: PendingOp, previousSavedAt: string | undefined) {
  // A newer intent for this job supersedes this one; leave the UI on it.
  if (pendingOps.get(jobId) !== op) return;
  pendingOps.delete(jobId);
  const current = cachedMap ?? {};
  if (op.kind === 'save') {
    if (!(jobId in current)) return;
    const next = { ...current };
    delete next[jobId];
    applyMap(next);
  } else if (!(jobId in current)) {
    applyMap({ ...current, [jobId]: previousSavedAt ?? new Date().toISOString() });
  }
}

async function sendMutation(jobId: string, op: PendingOp, previousSavedAt: string | undefined) {
  // Wait for the auth state instead of guessing: an early click must not be
  // dropped just because GET /api/saved-jobs has not answered yet.
  if (inflight) await inflight;
  else if (authStatus === 'unknown') await syncFromServer();

  if (authStatus === 'anonymous') {
    settle(jobId, op);
    if (op.kind === 'save') emitNotice('device-only');
    return;
  }

  try {
    const init: RequestInit =
      op.kind === 'save'
        ? { method: 'POST' }
        : { method: 'DELETE' };
    const res = await fetch(API_PATH, {
      ...init,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ jobId }),
    });
    if (res.status === 401) {
      setAuthStatus('anonymous');
      settle(jobId, op);
      if (op.kind === 'save') emitNotice('device-only');
      return;
    }
    if (!res.ok) throw new Error(`Saved jobs request failed (${res.status})`);
    settle(jobId, op);
  } catch {
    rollback(jobId, op, previousSavedAt);
    emitNotice(op.kind === 'save' ? 'save-failed' : 'remove-failed');
  }
}

function mutate(jobId: string, kind: PendingOp['kind']): Promise<void> {
  ensureCacheHydrated();
  const current = cachedMap ?? {};
  const previousSavedAt = current[jobId];
  if (kind === 'save' && jobId in current) return Promise.resolve();
  if (kind === 'remove' && !(jobId in current)) return Promise.resolve();

  if (kind === 'save') {
    applyMap({ ...current, [jobId]: new Date().toISOString() });
  } else {
    const next = { ...current };
    delete next[jobId];
    applyMap(next);
  }

  // No session cookie: the save is device-local and must not hit the API.
  if (!hasLikelyAuthCookie()) {
    setAuthStatus('anonymous');
    if (kind === 'save') emitNotice('device-only');
    return Promise.resolve();
  }

  const op: PendingOp = { kind };
  pendingOps.set(jobId, op);
  const prior = jobQueues.get(jobId) ?? Promise.resolve();
  const task = prior.then(() => sendMutation(jobId, op, previousSavedAt));
  jobQueues.set(jobId, task);
  void task.finally(() => {
    if (jobQueues.get(jobId) === task) jobQueues.delete(jobId);
  });
  return task;
}

/** Test seam: the module-level store API without React. */
export const __savedJobsStore = {
  save: (jobId: string) => mutate(jobId, 'save'),
  remove: (jobId: string) => mutate(jobId, 'remove'),
  sync: (force = false) => syncFromServer(force),
  getMap: getMapSnapshot,
  getServerMap: getServerMapSnapshot,
  getAuthStatus: getAuthSnapshot,
  getServerAuthStatus: getServerAuthSnapshot,
  onNotice: (handler: NoticeHandler) => {
    noticeHandlers.add(handler);
    return () => {
      noticeHandlers.delete(handler);
    };
  },
  reset: () => {
    cachedMap = null;
    lastSyncAt = 0;
    authStatus = 'unknown';
    migrated = false;
    inflight = null;
    pendingOps.clear();
    jobQueues.clear();
    noticeHandlers.clear();
    lastNoticeAt.clear();
    subscribers.clear();
  },
};

/**
 * Hook return contract is a superset of the localStorage-only version so
 * existing callers don't break. Internally it's auth-aware (server when
 * authenticated, localStorage when not) and request-deduped at the module
 * level: N hook instances on the same page share one fetch.
 */
export default function useSavedJobs(): UseSavedJobsReturn {
  const map = useSyncExternalStore(subscribe, getMapSnapshot, getServerMapSnapshot);
  const status = useSyncExternalStore(subscribe, getAuthSnapshot, getServerAuthSnapshot);
  const { toast } = useToast();

  useEffect(() => {
    const handler: NoticeHandler = (kind) => {
      toast(SAVED_JOBS_NOTICE_MESSAGES[kind], kind === 'device-only' ? 'info' : 'error');
    };
    noticeHandlers.add(handler);
    return () => {
      noticeHandlers.delete(handler);
    };
  }, [toast]);

  useEffect(() => {
    // Hydrate after mount (idempotent), then one shared sync.
    ensureCacheHydrated();
    void syncFromServer();

    // Cross-tab via storage event, primarily useful for anonymous users.
    function onStorage(event: StorageEvent) {
      if (event.key !== STORAGE_KEY) return;
      try {
        const newValue = event.newValue ? JSON.parse(event.newValue) : {};
        const next: SavedJobsMap = Array.isArray(newValue)
          ? Object.fromEntries(newValue.map((id: string) => [id, new Date().toISOString()]))
          : (newValue as SavedJobsMap);
        applyMap(next, false); // already in localStorage from the originating tab
      } catch (error) {
        console.error('Error parsing storage event:', error);
      }
    }
    window.addEventListener('storage', onStorage);

    // Refresh on tab focus, but only when authenticated and only past freshness window.
    function onVisibility() {
      if (document.visibilityState === 'visible' && authStatus === 'authenticated') {
        void syncFromServer();
      }
    }
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const savedJobs = useMemo(() => Object.keys(map), [map]);

  const isSaved = useCallback((jobId: string): boolean => jobId in map, [map]);

  const saveJob = useCallback((jobId: string): void => {
    void mutate(jobId, 'save');
  }, []);

  const removeJob = useCallback((jobId: string): void => {
    void mutate(jobId, 'remove');
  }, []);

  const clearAll = useCallback((): void => {
    ensureCacheHydrated();
    for (const jobId of Object.keys(cachedMap ?? {})) void mutate(jobId, 'remove');
  }, []);

  const savedAt = useCallback((jobId: string): Date | null => {
    const dateString = map[jobId];
    if (!dateString) return null;
    const date = new Date(dateString);
    return Number.isNaN(date.getTime()) ? null : date;
  }, [map]);

  return { savedJobs, isSaved, saveJob, removeJob, clearAll, savedAt, authStatus: status };
}

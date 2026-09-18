import { useEffect, useMemo, useRef, useState } from 'react';
import { logsApi } from '@/services/api';
import {
  collectRequestIdHints,
  matchUpstreamModels,
  parseRequestLogDump,
  selectCandidateHintIds,
  type MonitorRowForUpstreamMatch,
  type RequestIdHint,
  type RequestLogDump,
} from '@/utils/requestLogUpstreamModel';

const APP_LOG_CACHE_MS = 8_000;
const MISSING_RETRY_MS = 5_000;
const INFLIGHT_RETRY_MS = 3_000;
const MATCH_RETRY_MS = 3_000;
const MATCH_RETRY_MAX = 24;
const MAX_DUMP_DOWNLOADS = 4;
const MAX_DUMP_CHARS = 20_000_000;

type DumpCacheEntry =
  | { status: 'ok'; dump: RequestLogDump }
  | { status: 'missing'; at: number; retryMs: number };

let appLogCache: { at: number; lines: string[] } | null = null;
const dumpCache = new Map<string, DumpCacheEntry>();
const dumpInflight = new Map<string, Promise<DumpCacheEntry>>();

const isMissingStatus = (err: unknown): boolean => {
  const status = (err as { status?: number; response?: { status?: number } })?.status;
  const responseStatus = (err as { response?: { status?: number } })?.response?.status;
  if (status === 404 || responseStatus === 404) return true;
  const message = err instanceof Error ? err.message : String(err ?? '');
  return /404|not found/i.test(message);
};

const loadAppLogLines = async (): Promise<string[]> => {
  if (appLogCache && Date.now() - appLogCache.at < APP_LOG_CACHE_MS) {
    return appLogCache.lines;
  }
  try {
    const response = await logsApi.fetchLogs({ limit: 500 });
    appLogCache = { at: Date.now(), lines: response.lines };
    return response.lines;
  } catch {
    return appLogCache?.lines ?? [];
  }
};

const loadDump = (id: string, completed: boolean): Promise<DumpCacheEntry> => {
  const cached = dumpCache.get(id);
  if (cached?.status === 'ok') return Promise.resolve(cached);
  const retryMs = cached?.status === 'missing' ? cached.retryMs : MISSING_RETRY_MS;
  if (cached?.status === 'missing' && Date.now() - cached.at < retryMs) {
    return Promise.resolve(cached);
  }
  const inflight = dumpInflight.get(id);
  if (inflight) return inflight;

  const request = logsApi
    .fetchRequestLogText(id)
    .then((text): DumpCacheEntry => {
      if (!text || text.length > MAX_DUMP_CHARS) {
        return { status: 'missing', at: Date.now(), retryMs: MISSING_RETRY_MS };
      }
      return { status: 'ok', dump: parseRequestLogDump(text, id) };
    })
    .catch((err: unknown): DumpCacheEntry => {
      const wait = isMissingStatus(err) && !completed ? INFLIGHT_RETRY_MS : MISSING_RETRY_MS;
      return { status: 'missing', at: Date.now(), retryMs: wait };
    })
    .then((entry) => {
      dumpCache.set(id, entry);
      dumpInflight.delete(id);
      return entry;
    });

  dumpInflight.set(id, request);
  return request;
};

const loadDumps = async (ids: string[], hints: RequestIdHint[]): Promise<RequestLogDump[]> => {
  const dumps: RequestLogDump[] = [];
  const hintById = new Map(hints.map((hint) => [hint.id, hint]));
  const queue = ids.slice(0, MAX_DUMP_DOWNLOADS);
  const workers = Math.min(2, queue.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < queue.length) {
      const index = cursor;
      cursor += 1;
      const id = queue[index];
      const hint = hintById.get(id);
      const entry = await loadDump(id, hint?.completed === true);
      if (entry.status === 'ok') {
        const hint = hints.find((item) => item.id === id);
        dumps.push({
          ...entry.dump,
          id,
          startedAt: entry.dump.startedAt || hint?.firstTs || 0,
          endedAt: Math.max(entry.dump.endedAt, hint?.lastTs || 0),
        });
      }
    }
  };

  await Promise.all(Array.from({ length: workers }, () => worker()));
  return dumps;
};

export function useUpstreamReturnedModels(
  entries: MonitorRowForUpstreamMatch[],
  enabled: boolean
): Record<string, string> {
  const [matched, setMatched] = useState<Record<string, string>>({});
  const [retryTick, setRetryTick] = useState(0);
  const retryTickRef = useRef(0);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const signature = useMemo(
    () => entries.map((entry) => `${entry.id}\t${entry.timestampMs}\t${entry.model}`).join('|'),
    [entries]
  );

  useEffect(() => {
    retryTickRef.current = 0;
    setRetryTick(0);
  }, [signature]);

  useEffect(() => {
    const currentEntries = entriesRef.current;
    if (!enabled || currentEntries.length === 0) {
      setMatched({});
      return;
    }

    let cancelled = false;
    const retry = { id: undefined as number | undefined };
    const rows = currentEntries.map((entry) => ({
      id: entry.id,
      timestampMs: entry.timestampMs,
      model: entry.model,
    }));

    void (async () => {
      const lines = await loadAppLogLines();
      if (cancelled) return;
      const hints = collectRequestIdHints(lines);
      const ids = selectCandidateHintIds(rows, hints);
      const dumps = await loadDumps(ids, hints);
      if (cancelled) return;
      const next = matchUpstreamModels(rows, dumps, hints);
      setMatched(next);
      const blank = rows.some((row) => !next[row.id]);
      const pending =
        ids.length === 0 ||
        ids.some((id) => dumpCache.get(id)?.status === 'missing') ||
        hints.some((hint) => ids.includes(hint.id) && !hint.completed);
      if (blank && pending && retryTickRef.current < MATCH_RETRY_MAX) {
        retry.id = window.setTimeout(() => {
          retryTickRef.current += 1;
          setRetryTick(retryTickRef.current);
        }, MATCH_RETRY_MS);
      }
    })();

    return () => {
      cancelled = true;
      if (retry.id !== undefined) window.clearTimeout(retry.id);
    };
  }, [enabled, signature, retryTick]);

  return matched;
}

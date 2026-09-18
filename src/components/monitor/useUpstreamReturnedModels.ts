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
const MISSING_RETRY_MS = 60_000;
const MAX_DUMP_DOWNLOADS = 12;
const MAX_DUMP_CHARS = 4_000_000;

type DumpCacheEntry =
  | { status: 'ok'; dump: RequestLogDump }
  | { status: 'missing'; at: number };

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

const loadDump = (id: string): Promise<DumpCacheEntry> => {
  const cached = dumpCache.get(id);
  if (cached?.status === 'ok') return Promise.resolve(cached);
  if (cached?.status === 'missing' && Date.now() - cached.at < MISSING_RETRY_MS) {
    return Promise.resolve(cached);
  }
  const inflight = dumpInflight.get(id);
  if (inflight) return inflight;

  const request = logsApi
    .fetchRequestLogText(id)
    .then((text): DumpCacheEntry => {
      if (!text || text.length > MAX_DUMP_CHARS) {
        return { status: 'missing', at: Date.now() };
      }
      return { status: 'ok', dump: parseRequestLogDump(text, id) };
    })
    .catch((err: unknown): DumpCacheEntry => {
      if (isMissingStatus(err)) return { status: 'missing', at: Date.now() };
      return { status: 'missing', at: Date.now() };
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
  const queue = ids.slice(0, MAX_DUMP_DOWNLOADS);
  const workers = Math.min(2, queue.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < queue.length) {
      const index = cursor;
      cursor += 1;
      const id = queue[index];
      const entry = await loadDump(id);
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
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const signature = useMemo(
    () => entries.map((entry) => `${entry.id}\t${entry.timestampMs}\t${entry.model}`).join('|'),
    [entries]
  );

  useEffect(() => {
    const currentEntries = entriesRef.current;
    if (!enabled || currentEntries.length === 0) {
      setMatched({});
      return;
    }

    let cancelled = false;
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
      setMatched(matchUpstreamModels(rows, dumps, hints));
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, signature]);

  return matched;
}

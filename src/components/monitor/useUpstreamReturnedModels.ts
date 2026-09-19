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
// dump 改用 Range 只取尾部 256 KB 后，单次请求的体量降到原来的约 1/6，
// 因此这里放宽到能覆盖一整页列表（默认每页 20 行），否则一页里多数行永远没数据。
const MAX_COMPLETED_DUMPS = 24;
const MAX_PENDING_DUMPS = 4;
const DUMP_WORKERS = 4;

type DumpCacheEntry =
  | { status: 'ok'; dump: RequestLogDump; partial: boolean }
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
    const response = await logsApi.fetchLogs({ limit: 5000 });
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
    .then(({ text, partial }): DumpCacheEntry => {
      if (!text) {
        return { status: 'missing', at: Date.now(), retryMs: MISSING_RETRY_MS };
      }
      return { status: 'ok', dump: parseRequestLogDump(text, id), partial };
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
  const completed = ids.filter((id) => hintById.get(id)?.completed);
  const pending = ids.filter((id) => !hintById.get(id)?.completed);
  const queue = [
    ...completed.slice(0, MAX_COMPLETED_DUMPS),
    ...pending.slice(0, MAX_PENDING_DUMPS),
  ];
  const workers = Math.min(DUMP_WORKERS, queue.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < queue.length) {
      const index = cursor;
      cursor += 1;
      const id = queue[index];
      const hint = hintById.get(id);
      const entry = await loadDump(id, hint?.completed === true);
      if (entry.status === 'ok') {
        dumps.push({
          ...entry.dump,
          id,
          // 只取到尾部片段时，解析出的 startedAt 只是那一段的开头，比真实请求晚得多，
          // 拿它去做时间窗匹配会失配，所以优先信 app log 里的 hint。
          startedAt: entry.partial
            ? hint?.firstTs || entry.dump.startedAt || 0
            : entry.dump.startedAt || hint?.firstTs || 0,
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
      setMatched((prev) => {
        const merged: Record<string, string> = {};
        for (const row of rows) {
          merged[row.id] = next[row.id] || prev[row.id] || '';
        }
        return merged;
      });
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

export interface RequestIdHint {
  id: string;
  firstTs: number;
  lastTs: number;
  models: string[];
  apiRequest: boolean;
}

export interface RequestLogDump {
  id?: string;
  startedAt: number;
  endedAt: number;
  requestedModels: string[];
  upstreamEvents: Array<{ at: number; model: string }>;
}

export interface MonitorRowForUpstreamMatch {
  id: string;
  timestampMs: number;
  model: string;
}

const UPSTREAM_MODEL_FIELDS = [
  'upstream_model',
  'upstreamModel',
  'response_model',
  'responseModel',
  'returned_model',
  'returnedModel',
] as const;

export const readProvidedUpstreamModel = (item: {
  [key: string]: unknown;
  model?: string;
}): string => {
  for (const key of UPSTREAM_MODEL_FIELDS) {
    const value = item[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

const APP_LOG_LINE_RE =
  /^\[(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\]\s+\[([0-9a-fA-F]{8}|-{4,})\]/;
const MODEL_EQ_RE = /\bmodel=([A-Za-z0-9._:+\-]+)/;
const PATH_RE = /"(\/v1(?:beta)?\/[^"]+)"/;
const SECTION_RE = /^=== (.+?) ===\s*$/m;
const EVENT_BLOCK_RE =
  /Timestamp:\s*([^\n]+)\nEvent:\s*([^\n]+)(?:\nDirection:\s*[^\n]+)?\n([\s\S]*?)(?=\nTimestamp:|\n=== |$)/g;
const REQUEST_INFO_TS_RE = /^Timestamp:\s*(.+)$/m;
const JSON_MODEL_RE = /"model"\s*:\s*"([^"]+)"/g;
const IGNORED_MODEL_KEYS = new Set(['x-codex-safety-buffering-faster-model']);

const API_RESPONSE_EVENTS = new Set([
  'api.websocket.response',
  'api.response',
  'upstream.response',
  'upstream.websocket.response',
]);

const REQUEST_EVENTS = new Set([
  'api.websocket.request',
  'websocket.request',
  'api.request',
  'upstream.request',
]);

const RESPONSE_LIKE_EVENTS = new Set([
  ...API_RESPONSE_EVENTS,
  'websocket.response',
]);

const parseTimestamp = (value: string): number => {
  const ms = Date.parse(value.trim().replace(' ', 'T'));
  return Number.isFinite(ms) ? ms : 0;
};

const unique = (values: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const model = value.trim();
    if (!model || seen.has(model)) continue;
    seen.add(model);
    out.push(model);
  }
  return out;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const modelFromObject = (value: unknown): string => {
  if (!isRecord(value)) return '';
  const direct = readString(value.model);
  if (direct) return direct;
  const version = readString(value.modelVersion) || readString(value.model_version);
  if (version) return version;
  if (isRecord(value.response)) return modelFromObject(value.response);
  return '';
};

const isRequestCreate = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  const type = readString(value.type).toLowerCase();
  return type === 'response.create' || type === 'request' || 'input' in value && !('id' in value);
};

const isUpstreamResponseObject = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  if (isRequestCreate(value)) return false;
  const object = readString(value.object).toLowerCase();
  if (object === 'response' || object === 'chat.completion' || object === 'chat.completion.chunk') {
    return true;
  }
  if (readString(value.id) && (readString(value.status) || 'created_at' in value || 'output' in value)) {
    return true;
  }
  if (isRecord(value.response) && modelFromObject(value.response)) {
    const type = readString(value.type).toLowerCase();
    return type.startsWith('response.') || type === '' || 'status' in value.response;
  }
  return false;
};

const tryParseJsonAt = (text: string, start: number): { value: unknown; end: number } | null => {
  const open = text[start];
  if (open !== '{' && open !== '[') return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length && i - start < 2_000_000; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) {
        try {
          return { value: JSON.parse(text.slice(start, i + 1)), end: i + 1 };
        } catch {
          return null;
        }
      }
    }
  }
  return null;
};

const extractJsonObjects = (text: string): unknown[] => {
  const objects: unknown[] = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '{') continue;
    const parsed = tryParseJsonAt(text, i);
    if (!parsed) continue;
    objects.push(parsed.value);
    i = parsed.end - 1;
    if (objects.length >= 400) break;
  }
  return objects;
};

const splitSections = (text: string): Array<{ name: string; body: string }> => {
  const matches = [...text.matchAll(new RegExp(SECTION_RE.source, 'gm'))];
  if (matches.length === 0) return [{ name: 'WHOLE', body: text }];
  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const bodyStart = start + match[0].length;
    const bodyEnd = index + 1 < matches.length ? (matches[index + 1].index ?? text.length) : text.length;
    return { name: match[1], body: text.slice(bodyStart, bodyEnd) };
  });
};

const collectFromObjects = (
  objects: unknown[],
  at: number
): { requested: string[]; upstream: Array<{ at: number; model: string }> } => {
  const requested: string[] = [];
  const upstream: Array<{ at: number; model: string }> = [];
  for (const object of objects) {
    const model = modelFromObject(object);
    if (!model) continue;
    if (isRequestCreate(object)) requested.push(model);
    else if (isUpstreamResponseObject(object)) upstream.push({ at, model });
  }
  return { requested, upstream };
};

const isPreferredUpstreamSection = (name: string): boolean => {
  const lower = name.toLowerCase();
  return (
    lower.includes('api websocket') ||
    lower.includes('upstream') ||
    lower === 'response' ||
    lower.includes('api response')
  );
};

const isRequestSection = (name: string): boolean => {
  const lower = name.toLowerCase();
  return lower.includes('request info') || lower.includes('request body') || lower === 'request';
};

export const collectRequestIdHints = (lines: string[]): RequestIdHint[] => {
  const byId = new Map<string, RequestIdHint>();
  for (const raw of lines) {
    const match = raw.match(APP_LOG_LINE_RE);
    if (!match) continue;
    const id = match[2];
    if (!id || /^-+$/.test(id)) continue;
    const ts = parseTimestamp(match[1]);
    if (!ts) continue;
    let hint = byId.get(id);
    if (!hint) {
      hint = { id, firstTs: ts, lastTs: ts, models: [], apiRequest: false };
      byId.set(id, hint);
    }
    hint.firstTs = Math.min(hint.firstTs, ts);
    hint.lastTs = Math.max(hint.lastTs, ts);
    const model = raw.match(MODEL_EQ_RE)?.[1];
    if (model) hint.models = unique([...hint.models, model]);
    if (PATH_RE.test(raw) || /\/v1(?:beta)?\//.test(raw)) hint.apiRequest = true;
  }
  return [...byId.values()].filter((hint) => hint.apiRequest || hint.models.length > 0);
};

export const parseRequestLogDump = (text: string, id?: string): RequestLogDump => {
  const sections = splitSections(text);
  const requestedModels: string[] = [];
  const upstreamEvents: Array<{ at: number; model: string }> = [];
  let startedAt = 0;
  let endedAt = 0;

  const requestInfo = sections.find((section) => section.name.toLowerCase().includes('request info'));
  if (requestInfo) {
    const tsMatch = requestInfo.body.match(REQUEST_INFO_TS_RE);
    if (tsMatch) startedAt = parseTimestamp(tsMatch[1]);
  }

  const considerSection = (section: { name: string; body: string }, preferUpstream: boolean) => {
    EVENT_BLOCK_RE.lastIndex = 0;
    let matchedEvents = false;
    let block: RegExpExecArray | null;
    while ((block = EVENT_BLOCK_RE.exec(section.body))) {
      matchedEvents = true;
      const at = parseTimestamp(block[1]);
      const event = block[2].trim().toLowerCase();
      const objects = extractJsonObjects(block[3]);
      const collected = collectFromObjects(objects, at);
      if (REQUEST_EVENTS.has(event) || collected.requested.length) {
        requestedModels.push(...collected.requested);
        if (!collected.requested.length) {
          for (const object of objects) {
            const model = modelFromObject(object);
            if (model && isRequestCreate(object)) requestedModels.push(model);
          }
        }
      }
      if (preferUpstream && API_RESPONSE_EVENTS.has(event)) {
        if (collected.upstream.length) upstreamEvents.push(...collected.upstream);
        else {
          for (const object of objects) {
            const model = modelFromObject(object);
            if (model && !isRequestCreate(object)) upstreamEvents.push({ at, model });
          }
        }
      } else if (!preferUpstream && RESPONSE_LIKE_EVENTS.has(event) && collected.upstream.length) {
        upstreamEvents.push(...collected.upstream);
      }
      if (at) {
        if (!startedAt || at < startedAt) startedAt = at;
        if (at > endedAt) endedAt = at;
      }
    }

    if (matchedEvents) return;

    if (isRequestSection(section.name)) {
      for (const object of extractJsonObjects(section.body)) {
        const model = modelFromObject(object);
        if (model) requestedModels.push(model);
      }
      return;
    }

    if (preferUpstream || isPreferredUpstreamSection(section.name)) {
      for (const object of extractJsonObjects(section.body)) {
        const model = modelFromObject(object);
        if (!model || isRequestCreate(object)) continue;
        if (isUpstreamResponseObject(object) || isPreferredUpstreamSection(section.name)) {
          upstreamEvents.push({ at: startedAt, model });
        }
      }
    }
  };

  const preferred = sections.filter((section) => isPreferredUpstreamSection(section.name));
  const others = sections.filter((section) => !isPreferredUpstreamSection(section.name));
  for (const section of preferred) considerSection(section, true);
  if (upstreamEvents.length === 0) {
    for (const section of others) considerSection(section, false);
  } else {
    for (const section of others) considerSection(section, false);
  }

  if (requestedModels.length === 0) {
    JSON_MODEL_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = JSON_MODEL_RE.exec(text))) {
      if (IGNORED_MODEL_KEYS.has(match[1])) continue;
      requestedModels.push(match[1]);
      if (requestedModels.length >= 8) break;
    }
  }

  if (!endedAt) endedAt = startedAt;
  if (!startedAt && upstreamEvents.length) {
    startedAt = Math.min(...upstreamEvents.map((event) => event.at).filter(Boolean));
  }

  return {
    id,
    startedAt,
    endedAt,
    requestedModels: unique(requestedModels),
    upstreamEvents: upstreamEvents.filter((event) => event.model),
  };
};

export const selectCandidateHintIds = (
  entries: MonitorRowForUpstreamMatch[],
  hints: RequestIdHint[],
  expandMs = 120_000
): string[] => {
  if (entries.length === 0 || hints.length === 0) return [];
  const pageMin = Math.min(...entries.map((entry) => entry.timestampMs));
  const pageMax = Math.max(...entries.map((entry) => entry.timestampMs));
  const models = new Set(entries.map((entry) => entry.model).filter(Boolean));
  const matchesModel = (hint: RequestIdHint) =>
    !hint.models.length || !models.size || hint.models.some((model) => models.has(model));
  const overlapping = hints.filter((hint) => {
    if (!matchesModel(hint)) return false;
    if (hint.lastTs + 5_000 < pageMin) return false;
    if (hint.firstTs - expandMs > pageMax) return false;
    return true;
  });
  if (overlapping.length) return overlapping.map((hint) => hint.id);
  return hints.filter(matchesModel).map((hint) => hint.id);
};

const dumpWindow = (dump: RequestLogDump, hint?: RequestIdHint) => {
  const startedAt = dump.startedAt || hint?.firstTs || 0;
  const endedAt = Math.max(dump.endedAt, hint?.lastTs || 0, startedAt);
  return { startedAt, endedAt };
};

export const matchUpstreamModels = (
  entries: MonitorRowForUpstreamMatch[],
  dumps: RequestLogDump[],
  hints: RequestIdHint[] = []
): Record<string, string> => {
  const hintById = new Map(hints.map((hint) => [hint.id, hint]));
  const result: Record<string, string> = {};

  for (const entry of entries) {
    result[entry.id] = '';
    if (!entry.timestampMs) continue;

    const containing = dumps
      .map((dump) => ({ dump, ...dumpWindow(dump, dump.id ? hintById.get(dump.id) : undefined) }))
      .filter(({ dump, startedAt, endedAt }) => {
        if (!startedAt) return false;
        if (entry.timestampMs < startedAt - 5_000 || entry.timestampMs > endedAt + 5_000) return false;
        if (
          dump.requestedModels.length &&
          entry.model &&
          !dump.requestedModels.includes(entry.model)
        ) {
          return false;
        }
        return dump.upstreamEvents.length > 0;
      })
      .sort((a, b) => b.startedAt - a.startedAt);

    if (containing.length === 0) continue;

    const startedBefore = containing.filter((item) => item.startedAt <= entry.timestampMs + 2_000);
    const picked = (startedBefore[0] ?? containing[0]).dump;
    const events = picked.upstreamEvents;
    const uniqueModels = unique(events.map((event) => event.model));
    if (uniqueModels.length === 1) {
      result[entry.id] = uniqueModels[0];
      continue;
    }
    const withTime = events.filter((event) => event.at);
    if (!withTime.length) continue;
    let best = withTime[0];
    let bestDist = Math.abs(best.at - entry.timestampMs);
    for (const event of withTime.slice(1)) {
      const dist = Math.abs(event.at - entry.timestampMs);
      if (dist < bestDist) {
        best = event;
        bestDist = dist;
      }
    }
    result[entry.id] = best.model;
  }

  return result;
};

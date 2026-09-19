export interface RequestIdHint {
  id: string;
  firstTs: number;
  lastTs: number;
  models: string[];
  apiRequest: boolean;
  completed: boolean;
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

export const readProvidedUpstreamModel = (item: object): string => {
  const record = item as Record<string, unknown>;
  for (const key of UPSTREAM_MODEL_FIELDS) {
    const value = record[key];
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

const RESPONSE_LIKE_EVENTS = new Set([...API_RESPONSE_EVENTS, 'websocket.response']);

const HAS_EXPLICIT_TZ_RE = /(?:[zZ]|[+-]\d{2}:?\d{2})$/;
const LARGE_DUMP_CHARS = 300_000;
const MODEL_NEAR_ANCHORS: Array<{ needle: string; window: number; key: 'model' | 'modelVersion' }> =
  [
    { needle: '"type":"response.create"', window: 280, key: 'model' },
    { needle: '"object":"response"', window: 2500, key: 'model' },
    { needle: '"object":"chat.completion"', window: 800, key: 'model' },
    { needle: '"object":"chat.completion.chunk"', window: 800, key: 'model' },
    { needle: '"type":"response.created"', window: 3000, key: 'model' },
    { needle: '"type":"response.completed"', window: 3000, key: 'model' },
    { needle: '"type":"response.in_progress"', window: 3000, key: 'model' },
    { needle: '"modelVersion"', window: 80, key: 'modelVersion' },
  ];

// CPA 的 main.log 时间戳不带时区（`[2026-09-19 09:11:49]`），必须自己决定按哪个偏移解析。
// 这里原先硬编码 +08:00，服务器一改时区（或夏令时切换）整列就会静默变空：
// 哪怕只差 15 分钟，也足以让下面 120 秒的时间窗匹配全部落空。
const OFFSET_STEP_MINUTES = 15;
const MIN_OFFSET_MINUTES = -12 * 60;
const MAX_OFFSET_MINUTES = 14 * 60;
// 容忍机器时钟的小幅漂移；超过这个量的「未来日志」判定为偏移猜错。
const CLOCK_SKEW_TOLERANCE_MS = 60_000;

const localOffsetMinutes = (): number => -new Date().getTimezoneOffset();

const formatOffset = (minutes: number): string => {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${sign}${hh}:${mm}`;
};

/**
 * 从 app log 推断服务器写日志用的 UTC 偏移。
 *
 * 取日志里最新的一条时间戳，在所有 15 分钟粒度的候选偏移（真实时区偏移都是它的
 * 整数倍）里，挑出使「推算出的写入时刻」最接近 now 的那个。
 *
 * 光比远近不够：候选范围横跨 26 小时，任何 now 都能找到一个差值很小的偏移，
 * 只是可能整整差了 15 分钟的倍数。所以加一条物理约束——**日志不可能写于未来**，
 * 把推算时刻超过 now 的候选全部排除。有了它，只要日志滞后小于一个步长（15 分钟），
 * 推断结果必定是真实偏移。
 *
 * 局限：日志滞后超过 15 分钟时仍可能选错，且无从检测（差值同样很小）。实际不成立，
 * 因为面板自身每 10 秒轮询一次 `/v0/management/logs`，这些请求会被 gin_logger
 * 记进同一份日志，尾部始终是新鲜的。真取不到可用候选时回退浏览器本地时区——
 * 看板与服务器同处一地是最常见的情形。
 */
export const inferLogOffsetMinutes = (lines: string[], now: number = Date.now()): number => {
  // 必须取「最后一行」，而不是「时间戳数值最大的那行」：日志是顺序追加的，
  // 但服务器改过时区（或夏令时切换）之后，同一份日志里会混有两个偏移的裸时间戳，
  // 旧时区的数值完全可能更大。拿那样一条旧日志去推断会得出荒谬的偏移，
  // 进而匹配到一批早就没有 dump 的旧请求，整列照样是空的。
  let latestAsUtc = 0;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const match = lines[i].match(APP_LOG_LINE_RE);
    if (!match) continue;
    const ms = Date.parse(`${match[1].replace(' ', 'T')}Z`);
    if (Number.isFinite(ms) && ms > 0) {
      latestAsUtc = ms;
      break;
    }
  }
  if (!latestAsUtc) return localOffsetMinutes();

  let best: number | null = null;
  let bestLag = Number.POSITIVE_INFINITY;
  for (
    let offset = MIN_OFFSET_MINUTES;
    offset <= MAX_OFFSET_MINUTES;
    offset += OFFSET_STEP_MINUTES
  ) {
    const writtenAt = latestAsUtc - offset * 60_000;
    const lag = now - writtenAt;
    if (lag < -CLOCK_SKEW_TOLERANCE_MS) continue;
    if (lag < bestLag) {
      bestLag = lag;
      best = offset;
    }
  }
  return best ?? localOffsetMinutes();
};

/**
 * dump 内部的 Timestamp 自带时区（`2026-09-19T09:10:46.057-07:00`），走前一分支即可；
 * naiveOffsetMinutes 只作用于不带时区的时间戳，默认按浏览器本地时区解释。
 */
const parseTimestamp = (value: string, naiveOffsetMinutes?: number): number => {
  const normalized = value.trim().replace(' ', 'T');
  if (!normalized) return 0;
  const withOffset = HAS_EXPLICIT_TZ_RE.test(normalized)
    ? normalized
    : `${normalized}${formatOffset(naiveOffsetMinutes ?? localOffsetMinutes())}`;
  const ms = Date.parse(withOffset);
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
  return type === 'response.create' || type === 'request' || ('input' in value && !('id' in value));
};

const isUpstreamResponseObject = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  if (isRequestCreate(value)) return false;
  const object = readString(value.object).toLowerCase();
  if (object === 'response' || object === 'chat.completion' || object === 'chat.completion.chunk') {
    return true;
  }
  if (
    readString(value.id) &&
    (readString(value.status) || 'created_at' in value || 'output' in value)
  ) {
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
    const bodyEnd =
      index + 1 < matches.length ? (matches[index + 1].index ?? text.length) : text.length;
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

/**
 * @param offsetMinutes 解析 app log 裸时间戳用的 UTC 偏移；省略时从日志自身推断。
 */
export const collectRequestIdHints = (lines: string[], offsetMinutes?: number): RequestIdHint[] => {
  const naiveOffset = offsetMinutes ?? inferLogOffsetMinutes(lines);
  const byId = new Map<string, RequestIdHint>();
  for (const raw of lines) {
    const match = raw.match(APP_LOG_LINE_RE);
    if (!match) continue;
    const id = match[2];
    if (!id || /^-+$/.test(id)) continue;
    const ts = parseTimestamp(match[1], naiveOffset);
    if (!ts) continue;
    let hint = byId.get(id);
    if (!hint) {
      hint = { id, firstTs: ts, lastTs: ts, models: [], apiRequest: false, completed: false };
      byId.set(id, hint);
    }
    hint.firstTs = Math.min(hint.firstTs, ts);
    hint.lastTs = Math.max(hint.lastTs, ts);
    const model = raw.match(MODEL_EQ_RE)?.[1];
    if (model) hint.models = unique([...hint.models, model]);
    if (PATH_RE.test(raw) || /\/v1(?:beta)?\//.test(raw)) hint.apiRequest = true;
    if (
      /\/v1(?:beta)?\//.test(raw) &&
      /\b[1-5]\d{2}\b/.test(raw) &&
      !/\/v0\/management\//.test(raw)
    ) {
      hint.completed = true;
    }
  }
  return [...byId.values()].filter((hint) => hint.apiRequest || hint.models.length > 0);
};

const readQuotedValue = (text: string, key: string, from: number, to: number): string => {
  const prefix = `"${key}"`;
  let at = text.indexOf(prefix, from);
  while (at >= 0 && at < to) {
    let index = at + prefix.length;
    while (index < to && (text[index] === ' ' || text[index] === '\t')) index += 1;
    if (text[index] === ':') {
      index += 1;
      while (index < to && (text[index] === ' ' || text[index] === '\t')) index += 1;
      if (text[index] === '"') {
        const start = index + 1;
        const end = text.indexOf('"', start);
        if (end > start && end <= to) return text.slice(start, end);
      }
    }
    at = text.indexOf(prefix, at + prefix.length);
  }
  return '';
};

const modelsNearAnchors = (text: string, requested: string[], upstream: string[]): void => {
  for (const anchor of MODEL_NEAR_ANCHORS) {
    let from = 0;
    let found = 0;
    while (found < 8) {
      const at = text.indexOf(anchor.needle, from);
      if (at < 0) break;
      const model = readQuotedValue(text, anchor.key, at, at + anchor.window);
      if (model && !IGNORED_MODEL_KEYS.has(model)) {
        if (anchor.needle.includes('response.create')) requested.push(model);
        else upstream.push(model);
        found += 1;
      }
      from = at + anchor.needle.length;
    }
  }
};

const firstAndLastTimestamp = (text: string): { startedAt: number; endedAt: number } => {
  const needle = 'Timestamp: ';
  const firstAt = text.indexOf(needle);
  const lastAt = text.lastIndexOf(needle);
  const readAt = (index: number): number => {
    if (index < 0) return 0;
    const end = text.indexOf('\n', index);
    return parseTimestamp(text.slice(index + needle.length, end < 0 ? index + 80 : end));
  };
  const startedAt = readAt(firstAt);
  const endedAt = lastAt === firstAt ? startedAt : readAt(lastAt);
  return { startedAt, endedAt: endedAt || startedAt };
};

export const scanRequestLogDump = (text: string, id?: string): RequestLogDump => {
  const { startedAt: scannedStart, endedAt } = firstAndLastTimestamp(text);
  let startedAt = scannedStart;
  const requestInfoTs = text.match(REQUEST_INFO_TS_RE);
  if (requestInfoTs) {
    const at = parseTimestamp(requestInfoTs[1]);
    if (at && (!startedAt || at < startedAt)) startedAt = at;
  }

  const requestedModels: string[] = [];
  const upstreamModels: string[] = [];
  const requestBodyAt = text.indexOf('=== REQUEST BODY ===');
  if (requestBodyAt >= 0) {
    const model = readQuotedValue(text, 'model', requestBodyAt, requestBodyAt + 20_000);
    if (model) requestedModels.push(model);
  }
  modelsNearAnchors(text, requestedModels, upstreamModels);

  return {
    id,
    startedAt,
    endedAt: endedAt || startedAt,
    requestedModels: unique(requestedModels),
    upstreamEvents: unique(upstreamModels).map((model) => ({ at: startedAt, model })),
  };
};

const parseRequestLogDumpDetailed = (text: string, id?: string): RequestLogDump => {
  const sections = splitSections(text);
  const requestedModels: string[] = [];
  const upstreamEvents: Array<{ at: number; model: string }> = [];
  let startedAt = 0;
  let endedAt = 0;

  const requestInfo = sections.find((section) =>
    section.name.toLowerCase().includes('request info')
  );
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

export const parseRequestLogDump = (text: string, id?: string): RequestLogDump => {
  if (text.length > LARGE_DUMP_CHARS) return scanRequestLogDump(text, id);
  const parsed = parseRequestLogDumpDetailed(text, id);
  if (parsed.upstreamEvents.length) return parsed;
  const scanned = scanRequestLogDump(text, id);
  return {
    id,
    startedAt: parsed.startedAt || scanned.startedAt,
    endedAt: Math.max(parsed.endedAt, scanned.endedAt),
    requestedModels: unique([...parsed.requestedModels, ...scanned.requestedModels]),
    upstreamEvents: scanned.upstreamEvents,
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
  const rankHints = (items: RequestIdHint[]) =>
    [...items].sort((left, right) => {
      const score = (hint: RequestIdHint) =>
        (hint.completed ? 2 : 0) + (hint.models.length ? 1 : 0);
      const diff = score(right) - score(left);
      if (diff) return diff;
      return right.lastTs - left.lastTs || right.firstTs - left.firstTs;
    });
  if (overlapping.length) return rankHints(overlapping).map((hint) => hint.id);
  return rankHints(hints.filter(matchesModel)).map((hint) => hint.id);
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
        if (entry.timestampMs < startedAt - 5_000 || entry.timestampMs > endedAt + 5_000)
          return false;
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

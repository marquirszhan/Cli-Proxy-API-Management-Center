/**
 * 日志相关 API
 */

import { apiClient } from './client';
import { LOGS_TIMEOUT_MS } from '@/utils/constants';
import { isRecord } from '@/utils/helpers';

export interface LogsQuery {
  after?: number;
  cursor?: string;
  limit?: number;
}

export interface LogsResponse {
  lines: string[];
  latestAfter?: number;
  nextCursor?: string;
  cursorReset?: boolean;
}

export interface ErrorLogFile {
  name: string;
  size?: number;
  modified?: number;
}

export interface ErrorLogsResponse {
  files?: ErrorLogFile[];
}

const stringValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const booleanValue = (value: unknown): boolean =>
  value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true');

const unixSecondsFromValue = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = stringValue(value);
  if (!text) return 0;
  const asNumber = Number(text);
  if (Number.isFinite(asNumber)) return asNumber;
  const asDate = Date.parse(text);
  return Number.isFinite(asDate) ? Math.floor(asDate / 1000) : 0;
};

const normalizeLogsResponse = (data: unknown): LogsResponse => {
  if (!isRecord(data)) {
    return { lines: [] };
  }

  const lines = Array.isArray(data.lines)
    ? data.lines.filter((line): line is string => typeof line === 'string')
    : [];
  const latestTimestamp = unixSecondsFromValue(data['latest-timestamp']);

  return {
    lines,
    latestAfter: latestTimestamp > 0 ? latestTimestamp : undefined,
    nextCursor: stringValue(data['next-cursor']) || undefined,
    cursorReset: booleanValue(data['cursor-reset']),
  };
};

const responseDataToText = async (data: unknown): Promise<string> => {
  if (data instanceof Blob) return data.text();
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (typeof data === 'string') return data;
  if (data === undefined || data === null) return '';
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
};

/** 单个请求 dump 最多读入的字符数，避免超大文件把浏览器内存吃满。 */
const REQUEST_LOG_MAX_CHARS = 1_500_000;

/**
 * 用 Range 读取 dump 尾部的字节数。
 *
 * 上游响应段落在文件末尾，实测 256 KB 足以覆盖它；取得越少越快，
 * 但过小会在响应体很长时切掉 `=== RESPONSE ===` 的开头。
 */
const REQUEST_LOG_TAIL_BYTES = 262_144;

export interface RequestLogTextResult {
  text: string;
  /**
   * 是否只取到了文件尾部。
   *
   * 为真时文本开头的结构是残缺的，从中解析出的起始时间戳只代表这一段的开头，
   * 比真实请求时间晚，调用方不应拿它做时间窗匹配。
   */
  partial: boolean;
}

/** 流式读取响应体，读满 REQUEST_LOG_MAX_CHARS 就停并断开，不把整个文件拉完。 */
const readResponseTextCapped = async (response: Response): Promise<string> => {
  if (!response.body) {
    return (await response.text()).slice(0, REQUEST_LOG_MAX_CHARS);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (text.length < REQUEST_LOG_MAX_CHARS) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return text.slice(0, REQUEST_LOG_MAX_CHARS);
};

export const logsApi = {
  async fetchLogs(params: LogsQuery = {}): Promise<LogsResponse> {
    const data = await apiClient.get('/logs', { params, timeout: LOGS_TIMEOUT_MS });
    return normalizeLogsResponse(data);
  },

  clearLogs: () => apiClient.delete('/logs'),

  fetchErrorLogs: (): Promise<ErrorLogsResponse> =>
    apiClient.get('/request-error-logs', { timeout: LOGS_TIMEOUT_MS }),

  downloadErrorLog: (filename: string) =>
    apiClient.getRaw(`/request-error-logs/${encodeURIComponent(filename)}`, {
      responseType: 'blob',
      timeout: LOGS_TIMEOUT_MS,
    }),

  downloadRequestLogById: (id: string) =>
    apiClient.getRaw(`/request-log-by-id/${encodeURIComponent(id)}`, {
      responseType: 'blob',
      timeout: LOGS_TIMEOUT_MS,
    }),

  async fetchRequestLogText(id: string): Promise<RequestLogTextResult> {
    const base = apiClient.getBaseUrl().replace(/\/$/, '');
    const key = apiClient.getManagementKey();
    if (base && typeof fetch === 'function') {
      const url = `${base}/request-log-by-id/${encodeURIComponent(id)}`;
      const headers: Record<string, string> = {};
      if (key) headers.Authorization = `Bearer ${key}`;

      // 上游返回的模型写在 dump 尾部的 `=== RESPONSE ===` 段里，请求体排在它前面。
      // 这类 dump 常常超过 2 MB，从头读满 REQUEST_LOG_MAX_CHARS 会在读到答案之前
      // 先耗尽预算，于是大文件反而永远取不到模型名。所以优先用 Range 直接取尾部。
      // 后端 GetRequestLogByID 走 c.FileAttachment -> http.ServeFile，支持 Range；
      // 响应压缩中间件也会跳过带 Range 的请求，这里不会拿到 gzip 流。
      const ranged = await fetch(url, {
        headers: { ...headers, Range: `bytes=-${REQUEST_LOG_TAIL_BYTES}` },
      });
      if (ranged.status === 206) {
        return { text: await readResponseTextCapped(ranged), partial: true };
      }
      // 服务端不支持 Range，或文件本身比请求的尾部还小，都会返回 200 全量。
      if (ranged.ok) {
        return { text: await readResponseTextCapped(ranged), partial: false };
      }
      // 416 只说明 Range 不被接受，文件可能仍在；其余状态码照常抛给调用方判断。
      if (ranged.status !== 416) {
        const error = new Error(`HTTP ${ranged.status}`) as Error & { status: number };
        error.status = ranged.status;
        throw error;
      }
      const full = await fetch(url, { headers });
      if (!full.ok) {
        const error = new Error(`HTTP ${full.status}`) as Error & { status: number };
        error.status = full.status;
        throw error;
      }
      return { text: await readResponseTextCapped(full), partial: false };
    }
    const response = await logsApi.downloadRequestLogById(id);
    const text = (await responseDataToText(response.data)).slice(0, REQUEST_LOG_MAX_CHARS);
    return { text, partial: false };
  },
};

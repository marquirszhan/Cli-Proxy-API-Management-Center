/**
 * 日志相关 API
 */

import type { ApiError } from '@/types';
import { apiClient } from './client';
import { parseApiErrorResponse } from './apiError';
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
  files: ErrorLogFile[];
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
    // An explicit empty cursor clears the previous cursor after a reset.
    nextCursor: typeof data['next-cursor'] === 'string' ? data['next-cursor'] : undefined,
    cursorReset: booleanValue(data['cursor-reset']),
  };
};

export interface LogsRequestOptions {
  signal?: AbortSignal;
}

const normalizeErrorLogsResponse = (data: unknown): ErrorLogsResponse => {
  if (!isRecord(data) || !Array.isArray(data.files)) return { files: [] };
  return {
    files: data.files.flatMap((file): ErrorLogFile[] => {
      if (!isRecord(file) || typeof file.name !== 'string' || !file.name.trim()) return [];
      return [
        {
          name: file.name,
          size:
            typeof file.size === 'number' && Number.isFinite(file.size) && file.size >= 0
              ? file.size
              : undefined,
          modified: unixSecondsFromValue(file.modified) || undefined,
        },
      ];
    }),
  };
};

/** Decode download bodies without interpreting successful log contents as API errors. */
export const responseDataToText = async (data: unknown): Promise<string> => {
  if (data instanceof Blob) return data.text();
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data);
  }
  if (typeof data === 'string') return data;
  if (data === undefined || data === null) return '';
  try {
    return JSON.stringify(data, null, 2) ?? String(data);
  } catch {
    return String(data);
  }
};

const downloadLog = async (path: string, options: LogsRequestOptions) => {
  try {
    return await apiClient.getRaw(path, {
      ...options,
      responseType: 'blob',
      timeout: LOGS_TIMEOUT_MS,
    });
  } catch (error: unknown) {
    // The client already emitted unauthorized on 401 and normalized the Axios error.
    // It retains the body in data/details, NOT response.data. Preserve its identity,
    // status, transport code and body while enriching the human-readable error.
    if (error instanceof Error) {
      const apiError = error as ApiError;
      const body = apiError.data instanceof Blob ? apiError.data : apiError.details;
      if (body instanceof Blob) {
        try {
          const text = await responseDataToText(body);
          const parsed = parseApiErrorResponse(JSON.parse(text), apiError.message);
          apiError.message = parsed.message;
          if (parsed.apiCode !== undefined) apiError.apiCode = parsed.apiCode;
        } catch {
          // Unreadable/non-JSON bodies must not mask the original transport failure.
        }
      }
    }
    throw error;
  }
};


/** 单个请求 dump 最多读入的字符数，避免超大文件把浏览器内存吃满。 */
const REQUEST_LOG_MAX_CHARS = 1_500_000;

/**
 * 用 Range 读取 dump 尾部的字节数。
 * 上游响应段落在文件末尾；取得越少越快，但过小会在响应体很长时切掉 `=== RESPONSE ===` 的开头。
 */
const REQUEST_LOG_TAIL_BYTES = 262_144;

export interface RequestLogTextResult {
  text: string;
  /** 为真时文本开头是残缺的，解析出的起始时间戳不能拿来做时间窗匹配。 */
  partial: boolean;
}

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

  async fetchLogs(params: LogsQuery = {}, options: LogsRequestOptions = {}): Promise<LogsResponse> {
    const data = await apiClient.get('/observability/logs', {
      ...options,
      params,
      timeout: LOGS_TIMEOUT_MS,
    });
    return normalizeLogsResponse(data);
  },

  clearLogs: (options: LogsRequestOptions = {}) => apiClient.delete('/observability/logs', options),

  async fetchErrorLogs(options: LogsRequestOptions = {}): Promise<ErrorLogsResponse> {
    const data = await apiClient.get('/observability/logs/errors', {
      ...options,
      timeout: LOGS_TIMEOUT_MS,
    });
    return normalizeErrorLogsResponse(data);
  },

  downloadErrorLog: (filename: string, options: LogsRequestOptions = {}) =>
    downloadLog(`/observability/logs/errors/${encodeURIComponent(filename)}`, options),

  downloadRequestLogById: (id: string, options: LogsRequestOptions = {}) =>
    downloadLog(`/observability/logs/requests/${encodeURIComponent(id)}`, options),

  async fetchRequestLogText(id: string): Promise<RequestLogTextResult> {
    const base = apiClient.getBaseUrl().replace(/\/$/, '');
    const key = apiClient.getManagementKey();
    const requestPath = `/observability/logs/requests/${encodeURIComponent(id)}`;
    if (base && typeof fetch === 'function') {
      const url = `${base}${requestPath}`;
      const headers: Record<string, string> = {};
      if (key) headers.Authorization = `Bearer ${key}`;

      // 上游返回的模型写在 dump 尾部。大文件从头读会在读到答案之前耗尽预算，所以优先 Range 取尾部。
      const ranged = await fetch(url, {
        headers: { ...headers, Range: `bytes=-${REQUEST_LOG_TAIL_BYTES}` },
      });
      if (ranged.status === 206) {
        return { text: await readResponseTextCapped(ranged), partial: true };
      }
      if (ranged.ok) {
        return { text: await readResponseTextCapped(ranged), partial: false };
      }
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

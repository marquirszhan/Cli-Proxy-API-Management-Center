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

  async fetchRequestLogText(id: string): Promise<string> {
    const maxChars = 1_500_000;
    const base = apiClient.getBaseUrl().replace(/\/$/, '');
    const key = apiClient.getManagementKey();
    if (base && typeof fetch === 'function') {
      const response = await fetch(`${base}/request-log-by-id/${encodeURIComponent(id)}`, {
        headers: key ? { Authorization: `Bearer ${key}` } : undefined,
      });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`) as Error & { status: number };
        error.status = response.status;
        throw error;
      }
      if (!response.body) {
        return (await response.text()).slice(0, maxChars);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let text = '';
      try {
        while (text.length < maxChars) {
          const { done, value } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      return text.slice(0, maxChars);
    }
    const response = await logsApi.downloadRequestLogById(id);
    return (await responseDataToText(response.data)).slice(0, maxChars);
  },
};

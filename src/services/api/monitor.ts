/**
 * 监控中心相关 API
 */

import { apiClient } from './client';
import {
  normalizeMonitorHourlyModelsData,
  normalizeMonitorHourlyTokensData,
  normalizeMonitorKpiData,
} from '@/utils/monitor';
import { buildMonitorRequestKey, monitorRequestGate } from '@/utils/requestGate';

const MONITOR_TIMEOUT_MS = 60 * 1000;

const gatedGet = <T>(path: string, params?: object, config?: { timeout?: number }) =>
  monitorRequestGate.run(buildMonitorRequestKey(path, params), () =>
    apiClient.get<T>(path, {
      params,
      timeout: config?.timeout ?? MONITOR_TIMEOUT_MS,
    })
  );

export interface MonitorTimeRangeQuery {
  time_range?: string;
  start_time?: string;
  end_time?: string;
  api_filter?: string;
}

export interface MonitorFilterOptions {
  apis?: string[];
  models?: string[];
  sources?: string[];
}

export interface MonitorRecentRequest {
  failed: boolean;
  timestamp: string;
}

export interface MonitorRequestLogsQuery extends MonitorTimeRangeQuery {
  page?: number;
  page_size?: number;
  api?: string;
  api_key?: string;
  api_filter?: string;
  model?: string;
  source?: string;
  channel?: string;
  status?: '' | 'success' | 'failed';
}

export interface MonitorRequestLogItem {
  timestamp: string;
  api_key: string;
  model: string;
  source: string;
  auth_index: string;
  failed: boolean;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cached_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;
  latency_ms: number;
  ttft_ms: number;
  stream?: boolean;
  fast?: boolean;
  request_count: number;
  success_rate: number;
  recent_requests: MonitorRecentRequest[];
}

export interface MonitorRequestLogsResponse {
  items: MonitorRequestLogItem[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  has_prev: boolean;
  has_next: boolean;
  filters?: MonitorFilterOptions;
  time_range?: {
    start_time?: string;
    end_time?: string;
  };
}

export interface MonitorStatsQuery extends MonitorTimeRangeQuery {
  page?: number;
  page_size?: number;
  limit?: number;
  summary?: boolean;
  api?: string;
  api_key?: string;
  api_filter?: string;
  model?: string;
  source?: string;
  channel?: string;
  status?: '' | 'success' | 'failed';
}

export interface MonitorModelStatsItem {
  model: string;
  requests: number;
  success: number;
  failed: number;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  cache_write_tokens: number;
  fast_input_tokens?: number;
  fast_output_tokens?: number;
  fast_cached_tokens?: number;
  fast_cache_write_tokens?: number;
  success_rate: number;
  last_request_at?: string;
  recent_requests: MonitorRecentRequest[];
}

export interface MonitorChannelStatsItem {
  source: string;
  total_requests: number;
  success_requests: number;
  failed_requests: number;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  cache_write_tokens: number;
  success_rate: number;
  last_request_at?: string;
  recent_requests: MonitorRecentRequest[];
  models: MonitorModelStatsItem[];
}

export interface MonitorChannelStatsResponse {
  items: MonitorChannelStatsItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  has_prev: boolean;
  has_next: boolean;
  filters?: MonitorFilterOptions;
  time_range?: {
    start_time?: string;
    end_time?: string;
  };
}

export interface MonitorFailureStatsItem {
  source: string;
  failed_count: number;
  last_failed_at?: string;
  models: MonitorModelStatsItem[];
}

export interface MonitorFailureAnalysisResponse {
  items: MonitorFailureStatsItem[];
  total: number;
  limit: number;
  filters?: MonitorFilterOptions;
  time_range?: {
    start_time?: string;
    end_time?: string;
  };
}

export interface MonitorKpiData {
  total_requests: number;
  success_requests: number;
  failed_requests: number;
  success_rate: number;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cached_tokens: number;
  cache_write_tokens: number;
  avg_tpm: number;
  avg_rpm: number;
  avg_rpd: number;
}

export interface MonitorDailyTrendItem {
  date: string;
  requests: number;
  success_requests: number;
  failed_requests: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cached_tokens: number;
  cache_write_tokens: number;
}

export interface MonitorHourlyModelsData {
  hours: string[];
  models: string[];
  model_data: Record<string, number[]>;
  success_rates: number[];
}

export interface MonitorHourlyTokensData {
  hours: string[];
  total_tokens: number[];
  input_tokens: number[];
  output_tokens: number[];
  reasoning_tokens: number[];
  cached_tokens: number[];
  cache_write_tokens: number[];
}

export interface MonitorServiceHealthBlock {
  success: number;
  failure: number;
}

export interface MonitorServiceHealthData {
  rows: number;
  cols: number;
  block_duration_ms: number;
  blocks: MonitorServiceHealthBlock[];
  total_success: number;
  total_failure: number;
  success_rate: number;
}

export interface MonitorKeyStatsEntry {
  success: number;
  failure: number;
  blocks: Array<{ success: number; failure: number }>;
}

export interface MonitorKeyStatsWireFilter {
  auth_indexes?: string[];
}

export interface MonitorKeyStatsResponseFilter extends MonitorKeyStatsWireFilter {
  auth_index?: string;
}

export interface MonitorKeyStatsWireResponse {
  by_source: Record<string, MonitorKeyStatsEntry>;
  by_auth_index: Record<string, MonitorKeyStatsEntry>;
  block_config: {
    count: number;
    duration_ms: number;
    window_start_ms: number;
  };
  filter?: MonitorKeyStatsWireFilter;
}

export type MonitorKeyStatsResponse = Omit<MonitorKeyStatsWireResponse, 'filter'> & {
  filter?: MonitorKeyStatsResponseFilter;
};

export type MonitorKeyStatsQuery = { auth_index?: string } | string[];

export interface MonitorKeyStatsOptions {
  forceRefresh?: boolean;
}

export const KEY_STATS_STALE_TIME_MS = 240_000;

let fullKeyStatsCache:
  | {
      configRevision: number;
      refreshedAt: number;
      response: MonitorKeyStatsResponse;
    }
  | undefined;

export interface MonitorRequestDetailItem {
  timestamp: string;
  method: string;
  path: string;
  model: string;
  source: string;
  auth_index: string;
  failed: boolean;
}

export interface MonitorRequestDetailsResponse {
  items: MonitorRequestDetailItem[];
}

export interface MonitorRequestDetailsQuery {
  timestamp?: string;
  window_seconds?: number;
  method?: string;
  path?: string;
  limit?: number;
}

export interface MonitorProviderMapResponse {
  providers: Record<string, string>;
  models: Record<string, string[]>;
}

export const monitorApi = {
  getProviderMap: async (): Promise<MonitorProviderMapResponse> => {
    const data = await gatedGet<Partial<MonitorProviderMapResponse>>(
      '/custom/monitor/provider-map'
    );
    return {
      providers:
        data.providers && typeof data.providers === 'object' && !Array.isArray(data.providers)
          ? (data.providers as Record<string, string>)
          : {},
      models:
        data.models && typeof data.models === 'object' && !Array.isArray(data.models)
          ? (data.models as Record<string, string[]>)
          : {},
    };
  },

  getRequestLogs: (params: MonitorRequestLogsQuery = {}) =>
    gatedGet<MonitorRequestLogsResponse>('/custom/monitor/request-logs', params),

  getChannelStats: (params: MonitorStatsQuery = {}) =>
    gatedGet<MonitorChannelStatsResponse>('/custom/monitor/channel-stats', params),

  getFailureAnalysis: (params: MonitorStatsQuery = {}) =>
    gatedGet<MonitorFailureAnalysisResponse>('/custom/monitor/failure-analysis', params),

  getKpi: async (params: MonitorTimeRangeQuery = {}) => {
    const data = await gatedGet('/custom/monitor/kpi', params);
    return normalizeMonitorKpiData(data);
  },

  getDailyTrend: (params: MonitorTimeRangeQuery = {}) =>
    gatedGet<{ items: MonitorDailyTrendItem[] }>('/custom/monitor/daily-trend', params),

  getHourlyModels: async (
    params: MonitorTimeRangeQuery & { hours?: number; limit?: number } = {}
  ) => {
    const data = await gatedGet('/custom/monitor/hourly-models', params);
    return normalizeMonitorHourlyModelsData(data);
  },

  getHourlyTokens: async (params: MonitorTimeRangeQuery & { hours?: number } = {}) => {
    const data = await gatedGet('/custom/monitor/hourly-tokens', params);
    return normalizeMonitorHourlyTokensData(data);
  },

  getServiceHealth: () => gatedGet<MonitorServiceHealthData>('/custom/monitor/service-health'),

  getKeyStats: async (
    query: MonitorKeyStatsQuery = [],
    options: MonitorKeyStatsOptions = {}
  ): Promise<MonitorKeyStatsResponse> => {
    const authIndexes = Array.isArray(query) ? query : query.auth_index ? [query.auth_index] : [];
    const isFullQuery = authIndexes.length === 0;
    const configRevision = apiClient.getConfigRevision();
    if (
      isFullQuery &&
      !options.forceRefresh &&
      fullKeyStatsCache?.configRevision === configRevision &&
      Date.now() - fullKeyStatsCache.refreshedAt < KEY_STATS_STALE_TIME_MS
    ) {
      return fullKeyStatsCache.response;
    }

    const key = `${configRevision}:${buildMonitorRequestKey('/custom/monitor/key-stats', {
      auth_index: authIndexes,
    })}`;
    const response = await monitorRequestGate.run(key, () =>
      apiClient.get<MonitorKeyStatsWireResponse>('/custom/monitor/key-stats', {
        params: { auth_index: authIndexes },
        paramsSerializer: { indexes: null },
        timeout: MONITOR_TIMEOUT_MS,
      })
    );

    if (isFullQuery && apiClient.getConfigRevision() === configRevision) {
      fullKeyStatsCache = {
        configRevision,
        refreshedAt: Date.now(),
        response,
      };
    }

    if (!Array.isArray(query) && response.filter?.auth_indexes?.length === 1) {
      return {
        ...response,
        filter: {
          ...response.filter,
          auth_index: response.filter.auth_indexes[0],
        },
      };
    }

    return response;
  },

  getRequestDetails: (params: MonitorRequestDetailsQuery = {}) =>
    gatedGet<MonitorRequestDetailsResponse>('/custom/monitor/request-details', params),
};

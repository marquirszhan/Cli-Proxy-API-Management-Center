import { useMemo, useState, useCallback, Fragment, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { monitorApi, type MonitorChannelStatsItem } from '@/services/api';
import { useDisableModel } from '@/hooks/useDisableModel';
import { TimeRangeSelector, type TimeRange } from './TimeRangeSelector';
import { DisableModelModal } from './DisableModelModal';
import {
  formatTimestamp,
  formatCompactTokenNumber,
  formatRequestKeyDisplay,
  formatCacheTokenRatio,
  getRateClassName,
  getProviderDisplayParts,
  buildMonitorTimeRangeParams,
  computeUncachedInputTokens,
  normalizeMonitorInputTokens,
  calculateMonitorAggregateCost,
  formatMonitorCost,
  applyMonitorChannelStatsModelFilter,
  mergeMonitorFilterOptions,
  type DateRange,
} from '@/utils/monitor';
import styles from '@/pages/MonitorPage.module.scss';

interface ChannelStatsProps {
  refreshKey: number;
  loading: boolean;
  enabled?: boolean;
  providerMap: Record<string, string>;
  providerModels: Record<string, Set<string>>;
}

interface ModelStat {
  requests: number;
  success: number;
  failed: number;
  inputTokens: number;
  totalInputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  cost: number;
  successRate: number;
  recentRequests: { failed: boolean; timestamp: number }[];
  lastTimestamp: number;
}

interface ChannelStat {
  source: string;
  displayName: string;
  providerName: string | null;
  maskedKey: string;
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  inputTokens: number;
  totalInputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  cost: number;
  successRate: number;
  lastRequestTime: number;
  recentRequests: { failed: boolean; timestamp: number }[];
  models: Record<string, ModelStat>;
}

interface ChannelFilterOption {
  source: string;
  label: string;
}

export function ChannelStats({
  refreshKey,
  loading,
  enabled = true,
  providerMap,
  providerModels,
}: ChannelStatsProps) {
  const { t } = useTranslation();
  const [expandedChannel, setExpandedChannel] = useState<string | null>(null);
  const [filterRequestKey, setFilterRequestKey] = useState('');
  const [filterChannel, setFilterChannel] = useState('');
  const [filterModel, setFilterModel] = useState('');
  const [filterStatus, setFilterStatus] = useState<'' | 'success' | 'failed'>('');

  const [timeRange, setTimeRange] = useState<TimeRange>(1);
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  const [channelStats, setChannelStats] = useState<ChannelStat[]>([]);
  const [filters, setFilters] = useState<{
    requestKeys: string[];
    channels: ChannelFilterOption[];
    models: string[];
  }>({ requestKeys: [], channels: [], models: [] });
  const [statsLoading, setStatsLoading] = useState(false);

  const {
    disableState,
    disabling,
    isModelDisabled,
    handleDisableClick: onDisableClick,
    handleConfirmDisable,
    handleCancelDisable,
  } = useDisableModel({ providerMap, providerModels });

  const handleTimeRangeChange = useCallback((range: TimeRange, custom?: DateRange) => {
    setTimeRange(range);
    setCustomRange(custom);
    setPage(1);
  }, []);

  const formatChannelLabel = useCallback(
    (source: string): string => {
      const normalizedSource = source || 'unknown';
      const { provider, masked } = getProviderDisplayParts(normalizedSource, providerMap);
      return provider ? `${provider} (${masked})` : masked;
    },
    [providerMap]
  );

  const mapChannelStat = useCallback(
    (item: MonitorChannelStatsItem): ChannelStat => {
      const source = item.source || 'unknown';
      const { provider, masked } = getProviderDisplayParts(source, providerMap);
      const displayName = provider ? `${provider} (${masked})` : masked;

      const models: Record<string, ModelStat> = {};
      (item.models || []).forEach((model) => {
        const cachedTokens = model.cached_tokens || 0;
        const cacheWriteTokens = model.cache_write_tokens || 0;
        const fastCachedTokens = model.fast_cached_tokens || 0;
        const fastCacheWriteTokens = model.fast_cache_write_tokens || 0;
        const totalInputTokens = normalizeMonitorInputTokens(
          model.input_tokens || 0,
          cachedTokens,
          cacheWriteTokens
        );
        const outputTokens = model.output_tokens || 0;
        models[model.model] = {
          requests: model.requests || 0,
          success: model.success || 0,
          failed: model.failed || 0,
          inputTokens: computeUncachedInputTokens(totalInputTokens, cachedTokens, cacheWriteTokens),
          totalInputTokens,
          outputTokens,
          cachedTokens,
          cacheWriteTokens,
          cost: calculateMonitorAggregateCost(
            model.model,
            totalInputTokens,
            outputTokens,
            cachedTokens,
            cacheWriteTokens,
            {
              inputTokens: normalizeMonitorInputTokens(
                model.fast_input_tokens || 0,
                fastCachedTokens,
                fastCacheWriteTokens
              ),
              outputTokens: model.fast_output_tokens || 0,
              cachedTokens: fastCachedTokens,
              cacheWriteTokens: fastCacheWriteTokens,
            }
          ),
          successRate: model.success_rate || 0,
          recentRequests: (model.recent_requests || []).map((req) => ({
            failed: !!req.failed,
            timestamp: req.timestamp ? new Date(req.timestamp).getTime() : 0,
          })),
          lastTimestamp: model.last_request_at ? new Date(model.last_request_at).getTime() : 0,
        };
      });
      const cachedTokens = item.cached_tokens || 0;
      const cacheWriteTokens = item.cache_write_tokens || 0;
      const totalInputTokens = normalizeMonitorInputTokens(
        item.input_tokens || 0,
        cachedTokens,
        cacheWriteTokens
      );

      return {
        source,
        displayName,
        providerName: provider,
        maskedKey: masked,
        totalRequests: item.total_requests || 0,
        successRequests: item.success_requests || 0,
        failedRequests: item.failed_requests || 0,
        inputTokens: computeUncachedInputTokens(totalInputTokens, cachedTokens, cacheWriteTokens),
        totalInputTokens,
        outputTokens: item.output_tokens || 0,
        cachedTokens,
        cacheWriteTokens,
        cost: Object.values(models).reduce((sum, model) => sum + model.cost, 0),
        successRate: item.success_rate || 0,
        lastRequestTime: item.last_request_at ? new Date(item.last_request_at).getTime() : 0,
        recentRequests: (item.recent_requests || []).map((req) => ({
          failed: !!req.failed,
          timestamp: req.timestamp ? new Date(req.timestamp).getTime() : 0,
        })),
        models,
      };
    },
    [providerMap]
  );

  const loadChannelStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const response = await monitorApi.getChannelStats({
        page,
        page_size: pageSize,
        api_key: filterRequestKey || undefined,
        source: filterChannel || undefined,
        status: filterStatus || undefined,
        model: filterModel || undefined,
        ...buildMonitorTimeRangeParams(timeRange, customRange),
      });
      const rawItems = response.items || [];
      const mapped = applyMonitorChannelStatsModelFilter(rawItems, filterModel).map(mapChannelStat);
      setChannelStats(mapped);
      setTotal(response.total);
      setTotalPages(response.total_pages);
      if (response.page !== page) setPage(response.page);

      // 后端可能返回数万条 source 候选。原生 select 渲染这些 option 会长时间阻塞主线程；
      // 筛选项只保留当前页可见渠道和已选渠道。
      const sourceSet = new Set<string>(mapped.map((stat) => stat.source));
      if (filterChannel) sourceSet.add(filterChannel);
      const channels = Array.from(sourceSet)
        .filter((source) => !!source)
        .map((source) => ({ source, label: formatChannelLabel(source) }))
        .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN'));

      const modelSet = new Set<string>(
        response.filters?.models && response.filters.models.length > 0
          ? response.filters.models
          : rawItems.flatMap((stat) => (stat.models || []).map((model) => model.model))
      );

      const requestKeys = Array.from(
        new Set((response.filters?.apis || []).filter(Boolean))
      ).sort();
      const nextFilters = { requestKeys, channels, models: Array.from(modelSet).sort() };
      setFilters((prev) =>
        mergeMonitorFilterOptions(prev, nextFilters, {
          requestKey: filterRequestKey,
          channel: filterChannel,
          model: filterModel,
          status: filterStatus,
        })
      );
    } catch (err) {
      console.error('渠道统计加载失败：', err);
      setChannelStats([]);
      setTotal(0);
      setTotalPages(0);
      setFilters({ requestKeys: [], channels: [], models: [] });
    } finally {
      setStatsLoading(false);
    }
  }, [
    page,
    pageSize,
    filterRequestKey,
    filterChannel,
    filterStatus,
    filterModel,
    timeRange,
    customRange,
    mapChannelStat,
    formatChannelLabel,
  ]);

  useEffect(() => {
    // refreshKey=0 表示 provider map 尚未就绪；跳过首屏空跑，避免与 loadData 完成后再打一次形成双请求。
    if (!enabled || refreshKey === 0) return;
    loadChannelStats();
  }, [enabled, loadChannelStats, refreshKey]);

  const filteredStats = useMemo(() => {
    return channelStats.filter((stat) => {
      if (filterChannel && stat.source !== filterChannel) return false;
      return true;
    });
  }, [channelStats, filterChannel]);

  useEffect(() => {
    if (expandedChannel && !filteredStats.some((stat) => stat.source === expandedChannel)) {
      setExpandedChannel(null);
    }
  }, [expandedChannel, filteredStats]);

  const toggleExpand = (source: string) => {
    setExpandedChannel(expandedChannel === source ? null : source);
  };

  const goToPage = (nextPage: number) => {
    setPage(Math.max(1, Math.min(nextPage, totalPages)));
  };

  const handleDisableClick = (source: string, model: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onDisableClick(source, model);
  };

  const renderTokenCell = (tokens: number) => (
    <td
      className={`${styles.tokenCell} ${styles.numberCell}`}
      title={tokens.toLocaleString('zh-CN')}
    >
      {formatCompactTokenNumber(tokens)}
    </td>
  );

  const renderCacheCell = (cachedTokens: number) => (
    <td
      className={`${styles.tokenCell} ${styles.numberCell}`}
      title={cachedTokens > 0 ? cachedTokens.toLocaleString('zh-CN') : ''}
    >
      {cachedTokens > 0 ? formatCompactTokenNumber(cachedTokens) : ''}
    </td>
  );

  const renderCacheRatioCell = (cachedTokens: number, inputTokens: number) => {
    const cache = formatCacheTokenRatio(cachedTokens, inputTokens);

    return (
      <td
        className={`${styles.tokenCell} ${styles.numberCell}`}
        title={cachedTokens > 0 ? cache.title : ''}
      >
        {cachedTokens > 0 ? cache.ratio : ''}
      </td>
    );
  };

  const renderCostCell = (cost: number) => (
    <td className={`${styles.tokenCell} ${styles.numberCell}`} title={formatMonitorCost(cost)}>
      {formatMonitorCost(cost)}
    </td>
  );

  return (
    <>
      <Card
        title={t('monitor.channel.title')}
        subtitle={t('monitor.channel.click_hint')}
        extra={
          <TimeRangeSelector
            value={timeRange}
            onChange={handleTimeRangeChange}
            customRange={customRange}
          />
        }
      >
        <div className={styles.logFilters}>
          <select
            className={`${styles.logSelect} ${styles.requestKeySelect}`}
            aria-label={t('monitor.logs.header_request_key')}
            value={filterRequestKey}
            onChange={(e) => {
              setFilterRequestKey(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('monitor.channel.all_request_keys')}</option>
            {filters.requestKeys.map((requestKey) => (
              <option key={requestKey} value={requestKey}>
                {formatRequestKeyDisplay(requestKey)}
              </option>
            ))}
          </select>
          <select
            className={`${styles.logSelect} ${styles.channelSelect}`}
            aria-label={t('monitor.channel.header_name')}
            value={filterChannel}
            onChange={(e) => {
              setFilterChannel(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('monitor.channel.all_channels')}</option>
            {filters.channels.map((channel) => (
              <option key={channel.source} value={channel.source}>
                {channel.label}
              </option>
            ))}
          </select>
          <select
            className={styles.logSelect}
            aria-label={t('monitor.channel.model')}
            value={filterModel}
            onChange={(e) => {
              setFilterModel(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('monitor.channel.all_models')}</option>
            {filters.models.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
          <select
            className={`${styles.logSelect} ${styles.statusSelect}`}
            aria-label={t('monitor.logs.header_status')}
            value={filterStatus}
            onChange={(e) => {
              setFilterStatus(e.target.value as '' | 'success' | 'failed');
              setPage(1);
            }}
          >
            <option value="">{t('monitor.channel.all_status')}</option>
            <option value="success">{t('monitor.channel.only_success')}</option>
            <option value="failed">{t('monitor.channel.only_failed')}</option>
          </select>
        </div>

        <div className={styles.tableWrapper}>
          {statsLoading || loading ? (
            <div className={styles.emptyState}>{t('common.loading')}</div>
          ) : filteredStats.length === 0 ? (
            <div className={styles.emptyState}>{t('monitor.no_data')}</div>
          ) : (
            <table className={`${styles.table} ${styles.channelStatsTable}`}>
              <thead>
                <tr>
                  <th>{t('monitor.channel.header_name')}</th>
                  <th className={styles.numberCell}>{t('monitor.channel.header_count')}</th>
                  <th className={styles.numberCell}>{t('monitor.logs.header_input')}</th>
                  <th className={styles.numberCell}>{t('monitor.logs.header_output')}</th>
                  <th className={styles.numberCell}>{t('monitor.logs.header_cache')}</th>
                  <th className={styles.numberCell}>{t('monitor.logs.header_cache_ratio')}</th>
                  <th className={styles.numberCell}>{t('monitor.logs.header_cost')}</th>
                  <th className={styles.numberCell}>{t('monitor.channel.header_rate')}</th>
                  <th>{t('monitor.channel.header_recent')}</th>
                  <th>{t('monitor.channel.header_time')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredStats.map((stat) => (
                  <Fragment key={stat.source}>
                    <tr className={styles.expandable} onClick={() => toggleExpand(stat.source)}>
                      <td title={stat.displayName || stat.source}>
                        {stat.providerName ? (
                          <>
                            <span className={styles.channelName}>{stat.providerName}</span>
                            <span className={styles.channelSecret}> ({stat.maskedKey})</span>
                          </>
                        ) : (
                          stat.maskedKey
                        )}
                      </td>
                      <td className={styles.numberCell}>{stat.totalRequests.toLocaleString()}</td>
                      {renderTokenCell(stat.inputTokens)}
                      {renderTokenCell(stat.outputTokens)}
                      {renderCacheCell(stat.cachedTokens)}
                      {renderCacheRatioCell(stat.cachedTokens, stat.totalInputTokens)}
                      {renderCostCell(stat.cost)}
                      <td
                        className={`${getRateClassName(stat.successRate, styles)} ${styles.numberCell}`}
                      >
                        {stat.successRate.toFixed(1)}%
                      </td>
                      <td>
                        <div className={styles.statusBars}>
                          {stat.recentRequests.map((req, i) => (
                            <div
                              key={i}
                              className={`${styles.statusBar} ${req.failed ? styles.failure : styles.success}`}
                            />
                          ))}
                        </div>
                      </td>
                      <td>{formatTimestamp(stat.lastRequestTime)}</td>
                    </tr>
                    {expandedChannel === stat.source && (
                      <tr key={`${stat.source}-detail`}>
                        <td colSpan={10} className={styles.expandDetail}>
                          <div className={styles.expandTableWrapper}>
                            <table className={`${styles.table} ${styles.channelModelStatsTable}`}>
                              <thead>
                                <tr>
                                  <th>{t('monitor.channel.model')}</th>
                                  <th className={styles.numberCell}>
                                    {t('monitor.channel.header_count')}
                                  </th>
                                  <th className={styles.numberCell}>
                                    {t('monitor.logs.header_input')}
                                  </th>
                                  <th className={styles.numberCell}>
                                    {t('monitor.logs.header_output')}
                                  </th>
                                  <th className={styles.numberCell}>
                                    {t('monitor.logs.header_cache')}
                                  </th>
                                  <th className={styles.numberCell}>
                                    {t('monitor.logs.header_cache_ratio')}
                                  </th>
                                  <th className={styles.numberCell}>
                                    {t('monitor.logs.header_cost')}
                                  </th>
                                  <th className={styles.numberCell}>
                                    {t('monitor.channel.header_rate')}
                                  </th>
                                  <th className={styles.numberCell}>
                                    {t('monitor.channel.success')}/{t('monitor.channel.failed')}
                                  </th>
                                  <th>{t('monitor.channel.header_recent')}</th>
                                  <th>{t('monitor.channel.header_time')}</th>
                                  <th>{t('monitor.logs.header_actions')}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {Object.entries(stat.models)
                                  .sort((a, b) => {
                                    const aDisabled = isModelDisabled(stat.source, a[0]);
                                    const bDisabled = isModelDisabled(stat.source, b[0]);
                                    if (aDisabled !== bDisabled) {
                                      return aDisabled ? 1 : -1;
                                    }
                                    return b[1].requests - a[1].requests;
                                  })
                                  .map(([modelName, modelStat]) => {
                                    const disabled = isModelDisabled(stat.source, modelName);
                                    return (
                                      <tr
                                        key={modelName}
                                        className={disabled ? styles.modelDisabled : ''}
                                      >
                                        <td>{modelName}</td>
                                        <td className={styles.numberCell}>
                                          {modelStat.requests.toLocaleString()}
                                        </td>
                                        {renderTokenCell(modelStat.inputTokens)}
                                        {renderTokenCell(modelStat.outputTokens)}
                                        {renderCacheCell(modelStat.cachedTokens)}
                                        {renderCacheRatioCell(
                                          modelStat.cachedTokens,
                                          modelStat.totalInputTokens
                                        )}
                                        {renderCostCell(modelStat.cost)}
                                        <td
                                          className={`${getRateClassName(modelStat.successRate, styles)} ${styles.numberCell}`}
                                        >
                                          {modelStat.successRate.toFixed(1)}%
                                        </td>
                                        <td className={styles.numberCell}>
                                          <span className={styles.kpiSuccess}>
                                            {modelStat.success}
                                          </span>
                                          {' / '}
                                          <span className={styles.kpiFailure}>
                                            {modelStat.failed}
                                          </span>
                                        </td>
                                        <td>
                                          <div className={styles.statusBars}>
                                            {modelStat.recentRequests.map((req, i) => (
                                              <div
                                                key={i}
                                                className={`${styles.statusBar} ${req.failed ? styles.failure : styles.success}`}
                                              />
                                            ))}
                                          </div>
                                        </td>
                                        <td>{formatTimestamp(modelStat.lastTimestamp)}</td>
                                        <td>
                                          {disabled ? (
                                            <span className={styles.disabledLabel}>
                                              {t('monitor.logs.removed')}
                                            </span>
                                          ) : stat.source &&
                                            stat.source !== '-' &&
                                            stat.source !== 'unknown' ? (
                                            <button
                                              className={styles.disableBtn}
                                              onClick={(e) =>
                                                handleDisableClick(stat.source, modelName, e)
                                              }
                                            >
                                              {t('monitor.logs.disable')}
                                            </button>
                                          ) : (
                                            '-'
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {totalPages > 0 && (
          <div className={styles.pagination}>
            <button className={styles.pageBtn} onClick={() => goToPage(1)} disabled={page <= 1}>
              {t('monitor.logs.first_page')}
            </button>
            <button
              className={styles.pageBtn}
              onClick={() => goToPage(page - 1)}
              disabled={page <= 1}
            >
              {t('monitor.logs.prev_page')}
            </button>
            <span className={styles.pageBtn}>
              {t('monitor.logs.page_info', { current: page, total: totalPages })}
            </span>
            <select
              className={`${styles.logSelect} ${styles.pageSizeSelect}`}
              aria-label={t('monitor.logs.page_size_label')}
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
            >
              <option value="20">{t('monitor.logs.page_size_20')}</option>
              <option value="50">{t('monitor.logs.page_size_50')}</option>
              <option value="100">{t('monitor.logs.page_size_100')}</option>
            </select>
            <button
              className={styles.pageBtn}
              onClick={() => goToPage(page + 1)}
              disabled={page >= totalPages}
            >
              {t('monitor.logs.next_page')}
            </button>
            <button
              className={styles.pageBtn}
              onClick={() => goToPage(totalPages)}
              disabled={page >= totalPages}
            >
              {t('monitor.logs.last_page')}
            </button>
          </div>
        )}

        {channelStats.length > 0 && (
          <div className={styles.paginationTotal} role="status" aria-live="polite">
            {t('monitor.logs.total_count', { count: total })}
          </div>
        )}
      </Card>

      <DisableModelModal
        disableState={disableState}
        disabling={disabling}
        onConfirm={handleConfirmDisable}
        onCancel={handleCancelDisable}
      />
    </>
  );
}

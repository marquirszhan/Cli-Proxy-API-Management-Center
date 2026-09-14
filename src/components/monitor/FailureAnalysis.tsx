import { useMemo, useState, useCallback, Fragment, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { monitorApi, type MonitorFailureStatsItem } from '@/services/api';
import { useDisableModel } from '@/hooks/useDisableModel';
import { TimeRangeSelector, type TimeRange } from './TimeRangeSelector';
import { DisableModelModal } from './DisableModelModal';
import {
  formatTimestamp,
  getRateClassName,
  getProviderDisplayParts,
  buildMonitorTimeRangeParams,
  applyMonitorFailureAnalysisModelFilter,
  mergeMonitorFilterOptions,
  type DateRange,
} from '@/utils/monitor';
import styles from '@/pages/MonitorPage.module.scss';

interface FailureAnalysisProps {
  refreshKey: number;
  loading: boolean;
  enabled?: boolean;
  providerMap: Record<string, string>;
  providerModels: Record<string, Set<string>>;
}

interface ModelFailureStat {
  success: number;
  failure: number;
  total: number;
  successRate: number;
  recentRequests: { failed: boolean; timestamp: number }[];
  lastTimestamp: number;
}

interface FailureStat {
  source: string;
  displayName: string;
  providerName: string | null;
  maskedKey: string;
  failedCount: number;
  lastFailTime: number;
  models: Record<string, ModelFailureStat>;
}

interface ChannelFilterOption {
  source: string;
  label: string;
}

export function FailureAnalysis({
  refreshKey,
  loading,
  enabled = true,
  providerMap,
  providerModels,
}: FailureAnalysisProps) {
  const { t } = useTranslation();
  const [expandedChannel, setExpandedChannel] = useState<string | null>(null);
  const [filterChannel, setFilterChannel] = useState('');
  const [filterModel, setFilterModel] = useState('');

  const [timeRange, setTimeRange] = useState<TimeRange>(1);
  const [customRange, setCustomRange] = useState<DateRange | undefined>();

  const [failureStats, setFailureStats] = useState<FailureStat[]>([]);
  const [filters, setFilters] = useState<{ channels: ChannelFilterOption[]; models: string[] }>({
    channels: [],
    models: [],
  });
  const [analysisLoading, setAnalysisLoading] = useState(false);

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
  }, []);

  const formatChannelLabel = useCallback(
    (source: string): string => {
      const normalizedSource = source || 'unknown';
      const { provider, masked } = getProviderDisplayParts(normalizedSource, providerMap);
      return provider ? `${provider} (${masked})` : masked;
    },
    [providerMap]
  );

  const mapFailureStat = useCallback(
    (item: MonitorFailureStatsItem): FailureStat => {
      const source = item.source || 'unknown';
      const { provider, masked } = getProviderDisplayParts(source, providerMap);
      const displayName = provider ? `${provider} (${masked})` : masked;

      const models: Record<string, ModelFailureStat> = {};
      (item.models || []).forEach((model) => {
        models[model.model] = {
          success: model.success || 0,
          failure: model.failed || 0,
          total: model.requests || 0,
          successRate: model.success_rate || 0,
          recentRequests: (model.recent_requests || []).map((req) => ({
            failed: !!req.failed,
            timestamp: req.timestamp ? new Date(req.timestamp).getTime() : 0,
          })),
          lastTimestamp: model.last_request_at ? new Date(model.last_request_at).getTime() : 0,
        };
      });

      return {
        source,
        displayName,
        providerName: provider,
        maskedKey: masked,
        failedCount: item.failed_count || 0,
        lastFailTime: item.last_failed_at ? new Date(item.last_failed_at).getTime() : 0,
        models,
      };
    },
    [providerMap]
  );

  const loadFailureAnalysis = useCallback(async () => {
    setAnalysisLoading(true);
    try {
      const response = await monitorApi.getFailureAnalysis({
        limit: 10,
        source: filterChannel || undefined,
        model: filterModel || undefined,
        ...buildMonitorTimeRangeParams(timeRange, customRange),
      });

      const rawItems = response.items || [];
      const mapped = applyMonitorFailureAnalysisModelFilter(rawItems, filterModel).map(
        mapFailureStat
      );
      setFailureStats(mapped);

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
      const nextFilters = { channels, models: Array.from(modelSet).sort() };
      setFilters((prev) =>
        mergeMonitorFilterOptions(prev, nextFilters, {
          channel: filterChannel,
          model: filterModel,
        })
      );
    } catch (err) {
      console.error('失败分析加载失败：', err);
      setFailureStats([]);
      setFilters({ channels: [], models: [] });
    } finally {
      setAnalysisLoading(false);
    }
  }, [filterChannel, filterModel, timeRange, customRange, mapFailureStat, formatChannelLabel]);

  useEffect(() => {
    // 与 ChannelStats 一致：等 MonitorPage 完成 provider 加载（refreshKey>=1）再请求。
    if (!enabled || refreshKey === 0) return;
    loadFailureAnalysis();
  }, [enabled, loadFailureAnalysis, refreshKey]);

  const filteredStats = useMemo(() => {
    return failureStats.filter((stat) => {
      if (filterChannel && stat.source !== filterChannel) return false;
      return true;
    });
  }, [failureStats, filterChannel]);

  useEffect(() => {
    if (expandedChannel && !filteredStats.some((stat) => stat.source === expandedChannel)) {
      setExpandedChannel(null);
    }
  }, [expandedChannel, filteredStats]);

  const toggleExpand = (source: string) => {
    setExpandedChannel(expandedChannel === source ? null : source);
  };

  const getTopFailedModels = (source: string, modelsMap: Record<string, ModelFailureStat>) => {
    return Object.entries(modelsMap)
      .filter(([, stat]) => stat.failure > 0)
      .sort((a, b) => {
        const aDisabled = isModelDisabled(source, a[0]);
        const bDisabled = isModelDisabled(source, b[0]);
        if (aDisabled !== bDisabled) {
          return aDisabled ? 1 : -1;
        }
        return b[1].failure - a[1].failure;
      })
      .slice(0, 2);
  };

  const handleDisableClick = (source: string, model: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onDisableClick(source, model);
  };

  return (
    <>
      <Card
        title={t('monitor.failure.title')}
        subtitle={t('monitor.failure.click_hint')}
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
            className={styles.logSelect}
            value={filterChannel}
            onChange={(e) => setFilterChannel(e.target.value)}
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
            value={filterModel}
            onChange={(e) => setFilterModel(e.target.value)}
          >
            <option value="">{t('monitor.channel.all_models')}</option>
            {filters.models.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.tableWrapper}>
          {analysisLoading || loading ? (
            <div className={styles.emptyState}>{t('common.loading')}</div>
          ) : filteredStats.length === 0 ? (
            <div className={styles.emptyState}>{t('monitor.failure.no_failures')}</div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('monitor.failure.header_name')}</th>
                  <th>{t('monitor.failure.header_count')}</th>
                  <th>{t('monitor.failure.header_time')}</th>
                  <th>{t('monitor.failure.header_models')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredStats.map((stat) => {
                  const topModels = getTopFailedModels(stat.source, stat.models);
                  const totalFailedModels = Object.values(stat.models).filter(
                    (m) => m.failure > 0
                  ).length;

                  return (
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
                        <td className={styles.kpiFailure}>{stat.failedCount.toLocaleString()}</td>
                        <td>{formatTimestamp(stat.lastFailTime)}</td>
                        <td>
                          {topModels.map(([model, modelStat]) => {
                            const percent =
                              stat.failedCount > 0
                                ? ((modelStat.failure / stat.failedCount) * 100).toFixed(0)
                                : '0';
                            const shortModel =
                              model.length > 16 ? `${model.slice(0, 13)}...` : model;
                            const disabled = isModelDisabled(stat.source, model);
                            return (
                              <span
                                key={model}
                                className={`${styles.failureModelTag} ${disabled ? styles.modelDisabled : ''}`}
                                title={`${model}: ${modelStat.failure} (${percent}%)${disabled ? ` - ${t('monitor.logs.removed')}` : ''}`}
                              >
                                {shortModel}
                              </span>
                            );
                          })}
                          {totalFailedModels > 2 && (
                            <span className={styles.moreModelsHint}>+{totalFailedModels - 2}</span>
                          )}
                        </td>
                      </tr>
                      {expandedChannel === stat.source && (
                        <tr key={`${stat.source}-detail`}>
                          <td colSpan={4} className={styles.expandDetail}>
                            <div className={styles.expandTableWrapper}>
                              <table className={styles.table}>
                                <thead>
                                  <tr>
                                    <th>{t('monitor.channel.model')}</th>
                                    <th>{t('monitor.channel.header_count')}</th>
                                    <th>{t('monitor.channel.header_rate')}</th>
                                    <th>
                                      {t('monitor.channel.success')}/{t('monitor.channel.failed')}
                                    </th>
                                    <th>{t('monitor.channel.header_recent')}</th>
                                    <th>{t('monitor.channel.header_time')}</th>
                                    <th>{t('monitor.logs.header_actions')}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {Object.entries(stat.models)
                                    .filter(([, m]) => m.failure > 0)
                                    .sort((a, b) => {
                                      const aDisabled = isModelDisabled(stat.source, a[0]);
                                      const bDisabled = isModelDisabled(stat.source, b[0]);
                                      if (aDisabled !== bDisabled) {
                                        return aDisabled ? 1 : -1;
                                      }
                                      return b[1].failure - a[1].failure;
                                    })
                                    .map(([modelName, modelStat]) => {
                                      const disabled = isModelDisabled(stat.source, modelName);
                                      return (
                                        <tr
                                          key={modelName}
                                          className={disabled ? styles.modelDisabled : ''}
                                        >
                                          <td>{modelName}</td>
                                          <td>{modelStat.total.toLocaleString()}</td>
                                          <td
                                            className={getRateClassName(
                                              modelStat.successRate,
                                              styles
                                            )}
                                          >
                                            {modelStat.successRate.toFixed(1)}%
                                          </td>
                                          <td>
                                            <span className={styles.kpiSuccess}>
                                              {modelStat.success}
                                            </span>
                                            {' / '}
                                            <span className={styles.kpiFailure}>
                                              {modelStat.failure}
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
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
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

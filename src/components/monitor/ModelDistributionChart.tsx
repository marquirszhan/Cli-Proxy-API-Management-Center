import { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Doughnut } from 'react-chartjs-2';
import type { TooltipItem } from 'chart.js';
import type { TimeRange } from '@/pages/MonitorPage';
import { monitorApi } from '@/services/api/monitor';
import {
  buildMonitorChannelDistributionItems,
  buildMonitorModelDistributionItems,
  buildMonitorTimeRangeParams,
  formatMonitorCost,
  type MonitorDistributionMetric,
  type MonitorDistributionListItem,
} from '@/utils/monitor';
import styles from '@/pages/MonitorPage.module.scss';

interface ModelDistributionChartProps {
  timeRange: TimeRange;
  apiFilter: string;
  isDark: boolean;
  providerMap: Record<string, string>;
  preloadedChannelStats?: import('@/services/api/monitor').MonitorChannelStatsItem[];
  preloadedKey?: string;
}

// 颜色调色板
const COLORS = [
  '#3b82f6', // 蓝色
  '#22c55e', // 绿色
  '#f97316', // 橙色
  '#8b5cf6', // 紫色
  '#ec4899', // 粉色
  '#06b6d4', // 青色
  '#eab308', // 黄色
  '#ef4444', // 红色
  '#14b8a6', // 青绿
  '#6366f1', // 靛蓝
];

type DistributionTab = 'channel-token' | 'channel-cost' | 'model-token' | 'model-cost';

const DISTRIBUTION_TABS: { id: DistributionTab; labelKey: string }[] = [
  { id: 'channel-token', labelKey: 'monitor.distribution.tab_channel_token' },
  { id: 'channel-cost', labelKey: 'monitor.distribution.tab_channel_cost' },
  { id: 'model-token', labelKey: 'monitor.distribution.tab_model_token' },
  { id: 'model-cost', labelKey: 'monitor.distribution.tab_model_cost' },
];

const DISTRIBUTION_TOP_LIMIT = 10;
// 后端 channel-stats limit 上限为 100；再大只是空转参数，徒增请求体积与解析成本。
const DISTRIBUTION_SOURCE_LIMIT = 100;

const EMPTY_DISTRIBUTION_ITEMS: MonitorDistributionListItem[] = [];

export function ModelDistributionChart({
  timeRange,
  apiFilter,
  isDark,
  providerMap,
  preloadedChannelStats,
  preloadedKey,
}: ModelDistributionChartProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<DistributionTab>('channel-token');
  const distributionMode = activeTab.startsWith('channel') ? 'channel' : 'model';
  const metric: MonitorDistributionMetric = activeTab.endsWith('cost') ? 'cost' : 'token';
  const requestKey = `${timeRange}\0${apiFilter}\0${activeTab}`;
  const otherLabel = t('monitor.distribution.other');
  const [distributionState, setDistributionState] = useState<{
    requestKey: string;
    items: MonitorDistributionListItem[];
  } | null>(null);
  const loading = distributionState?.requestKey !== requestKey;
  const distributionItems = distributionState?.items ?? EMPTY_DISTRIBUTION_ITEMS;

  const statsRequestKey = `${timeRange}\0${apiFilter}`;
  const parentOwned = preloadedKey === statsRequestKey;

  useEffect(() => {
    let cancelled = false;
    const timeParams = buildMonitorTimeRangeParams(timeRange);

    const loadDistribution = async () => {
      let items: import('@/services/api/monitor').MonitorChannelStatsItem[];
      if (parentOwned) {
        // 父组件接管：等待首屏渠道摘要，禁止再打独立 channel-stats。
        if (preloadedChannelStats === undefined) {
          return null;
        }
        items = preloadedChannelStats;
      } else {
        const data = await monitorApi.getChannelStats({
          limit: DISTRIBUTION_SOURCE_LIMIT,
          summary: true,
          ...timeParams,
          ...(apiFilter ? { api_filter: apiFilter } : {}),
        });
        items = data.items || [];
      }

      if (distributionMode === 'channel') {
        return buildMonitorChannelDistributionItems(
          items,
          providerMap,
          metric,
          DISTRIBUTION_TOP_LIMIT,
          otherLabel
        );
      }

      return buildMonitorModelDistributionItems(items, metric, DISTRIBUTION_TOP_LIMIT, otherLabel);
    };

    loadDistribution()
      .then((items) => {
        if (cancelled || items === null) return;
        setDistributionState({ requestKey, items });
      })
      .catch((err) => {
        console.error('Distribution load failed:', err);
        if (!cancelled) {
          setDistributionState({ requestKey, items: [] });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    timeRange,
    apiFilter,
    activeTab,
    distributionMode,
    metric,
    providerMap,
    otherLabel,
    requestKey,
    parentOwned,
    preloadedChannelStats,
  ]);

  const timeRangeLabel = (() => {
    if (timeRange === 'yesterday') return t('monitor.yesterday');
    if (timeRange === 'dayBeforeYesterday') return t('monitor.day_before_yesterday');
    if (timeRange === 1) return t('monitor.today');
    return t('monitor.last_n_days', { n: timeRange });
  })();

  // 计算总数
  const total = useMemo(() => {
    return distributionItems.reduce((sum, item) => {
      return sum + (metric === 'cost' ? item.cost : item.tokens);
    }, 0);
  }, [distributionItems, metric]);

  // 图表数据
  const chartData = useMemo(() => {
    return {
      labels: distributionItems.map((item) => item.label),
      datasets: [
        {
          data: distributionItems.map((item) => (metric === 'cost' ? item.cost : item.tokens)),
          backgroundColor: COLORS.slice(0, distributionItems.length),
          borderColor: isDark ? '#1f2937' : '#ffffff',
          borderWidth: 2,
        },
      ],
    };
  }, [distributionItems, metric, isDark]);

  // 图表配置
  const chartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          backgroundColor: isDark ? '#374151' : '#ffffff',
          titleColor: isDark ? '#f3f4f6' : '#111827',
          bodyColor: isDark ? '#d1d5db' : '#4b5563',
          borderColor: isDark ? '#4b5563' : '#e5e7eb',
          borderWidth: 1,
          padding: 12,
          callbacks: {
            label: (context: TooltipItem<'doughnut'>) => {
              const value = Number(context.raw || 0);
              const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
              if (metric === 'cost') {
                return `${formatMonitorCost(value)} (${percentage}%)`;
              }
              return `${value.toLocaleString()} ${t('monitor.distribution.tokens')} (${percentage}%)`;
            },
          },
        },
      },
    }),
    [isDark, total, metric, t]
  );

  // 格式化数值
  const formatTokenValue = (value: number) => {
    if (value >= 1000000) {
      return (value / 1000000).toFixed(1) + 'M';
    }
    if (value >= 1000) {
      return (value / 1000).toFixed(1) + 'K';
    }
    return value.toString();
  };

  const formatDistributionValue = (value: number) =>
    metric === 'cost' ? formatMonitorCost(value) : formatTokenValue(value);

  const titleKey =
    distributionMode === 'channel'
      ? 'monitor.distribution.channel_title'
      : 'monitor.distribution.title';
  const dimensionLabel =
    distributionMode === 'channel'
      ? t('monitor.distribution.channels')
      : t('monitor.distribution.models');
  const metricLabel =
    metric === 'cost' ? t('monitor.distribution.by_cost') : t('monitor.distribution.by_tokens');
  const shareLabel = (() => {
    if (distributionMode === 'channel' && metric === 'cost') {
      return t('monitor.distribution.channel_cost_share');
    }
    if (distributionMode === 'channel') {
      return t('monitor.distribution.channel_token_share');
    }
    return metric === 'cost'
      ? t('monitor.distribution.model_cost_share')
      : t('monitor.distribution.model_token_share');
  })();

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <div>
          <h3 className={styles.chartTitle}>{t(titleKey)}</h3>
          <p className={styles.chartSubtitle}>
            {timeRangeLabel} · {dimensionLabel} · {metricLabel} · Top {DISTRIBUTION_TOP_LIMIT}
          </p>
        </div>
        <div className={styles.chartControlGroups}>
          <div
            className={`${styles.chartControls} ${styles.distributionTabs}`}
            role="tablist"
            aria-label={t('monitor.distribution.tabs_label')}
          >
            {DISTRIBUTION_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                className={`${styles.chartControlBtn} ${styles.distributionTabButton} ${activeTab === tab.id ? styles.active : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {t(tab.labelKey)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading || distributionItems.length === 0 ? (
        <div className={styles.chartContent}>
          <div className={styles.chartEmpty}>
            {loading ? t('common.loading') : t('monitor.no_data')}
          </div>
        </div>
      ) : (
        <div className={styles.distributionContent}>
          <div className={styles.donutWrapper}>
            <Doughnut data={chartData} options={chartOptions} />
            <div className={styles.donutCenter}>
              <div className={styles.donutLabel}>{shareLabel}</div>
            </div>
          </div>
          <div className={styles.legendList}>
            {distributionItems.map((item, index) => {
              const value = metric === 'cost' ? item.cost : item.tokens;
              const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : '0';
              return (
                <div key={`${item.label}-${index}`} className={styles.legendItem}>
                  <span className={styles.legendDot} style={{ backgroundColor: COLORS[index] }} />
                  <span className={styles.legendName} title={item.label}>
                    {item.label}
                  </span>
                  <span className={styles.legendValue}>
                    {formatDistributionValue(value)} ({percentage}%)
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

import { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Chart } from 'react-chartjs-2';
import type { TimeRange } from '@/pages/MonitorPage';
import { monitorApi, type MonitorDailyTrendItem } from '@/services/api/monitor';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { buildMonitorTimeRangeParams } from '@/utils/monitor';
import styles from '@/pages/MonitorPage.module.scss';

interface DailyTrendChartProps {
  timeRange: TimeRange;
  apiFilter: string;
  isDark: boolean;
  preloadedItems?: MonitorDailyTrendItem[];
  preloadedKey?: string;
}

const EMPTY_DAILY_ITEMS: MonitorDailyTrendItem[] = [];

export function DailyTrendChart({
  timeRange,
  apiFilter,
  isDark,
  preloadedItems,
  preloadedKey,
}: DailyTrendChartProps) {
  const { t } = useTranslation();
  const isMobile = useMediaQuery('(max-width: 768px)');
  const requestKey = `${timeRange}\0${apiFilter}`;
  const [dailyState, setDailyState] = useState<{
    requestKey: string;
    items: MonitorDailyTrendItem[];
  } | null>(null);
  const parentOwned = preloadedKey === requestKey;
  const loading = parentOwned
    ? preloadedItems === undefined
    : dailyState?.requestKey !== requestKey;
  const dailyItems = parentOwned
    ? (preloadedItems ?? EMPTY_DAILY_ITEMS)
    : (dailyState?.items ?? EMPTY_DAILY_ITEMS);

  useEffect(() => {
    if (parentOwned) return;
    let cancelled = false;

    const params = {
      ...buildMonitorTimeRangeParams(timeRange),
      ...(apiFilter ? { api_filter: apiFilter } : {}),
    };

    monitorApi
      .getDailyTrend(params)
      .then((data) => {
        if (!cancelled) {
          setDailyState({ requestKey, items: data.items || [] });
        }
      })
      .catch((err) => {
        console.error('Daily trend load failed:', err);
        if (!cancelled) {
          setDailyState({ requestKey, items: [] });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [timeRange, apiFilter, requestKey, parentOwned]);

  // 图表数据
  const chartData = useMemo(() => {
    const labels = dailyItems.map((item) => {
      // item.date format: "2026-02-23" — parse directly to avoid timezone shift
      const [, m, d] = item.date.split('-');
      return `${parseInt(m, 10)}/${parseInt(d, 10)}`;
    });

    return {
      labels,
      datasets: [
        {
          type: 'line' as const,
          label: t('monitor.trend.requests'),
          data: dailyItems.map((item) => item.requests),
          borderColor: '#3b82f6',
          backgroundColor: '#3b82f6',
          borderWidth: 3,
          fill: false,
          tension: 0.35,
          yAxisID: 'y1',
          order: 0,
          pointRadius: 3,
          pointBackgroundColor: '#3b82f6',
        },
        {
          type: 'bar' as const,
          label: t('monitor.trend.input_tokens'),
          data: dailyItems.map((item) => item.input_tokens / 1000),
          backgroundColor: 'rgba(34, 197, 94, 0.7)',
          borderColor: 'rgba(34, 197, 94, 0.7)',
          borderWidth: 1,
          borderRadius: 0,
          yAxisID: 'y',
          order: 1,
          stack: 'tokens',
        },
        {
          type: 'bar' as const,
          label: t('monitor.trend.output_tokens'),
          data: dailyItems.map((item) => item.output_tokens / 1000),
          backgroundColor: 'rgba(249, 115, 22, 0.7)',
          borderColor: 'rgba(249, 115, 22, 0.7)',
          borderWidth: 1,
          borderRadius: 4,
          yAxisID: 'y',
          order: 1,
          stack: 'tokens',
        },
      ],
    };
  }, [dailyItems, t]);

  // 图表配置
  const chartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index' as const,
        intersect: false,
      },
      plugins: {
        legend: {
          display: true,
          position: 'bottom' as const,
          labels: {
            color: isDark ? '#9ca3af' : '#6b7280',
            usePointStyle: true,
            padding: isMobile ? 8 : 16,
            font: {
              size: isMobile ? 10 : 11,
            },
            generateLabels: (chart: any) => {
              return chart.data.datasets.map((dataset: any, i: number) => {
                const isLine = dataset.type === 'line';
                return {
                  text: dataset.label,
                  fillStyle: dataset.backgroundColor,
                  strokeStyle: dataset.borderColor,
                  lineWidth: 0,
                  hidden: !chart.isDatasetVisible(i),
                  datasetIndex: i,
                  pointStyle: isLine ? 'circle' : 'rect',
                };
              });
            },
          },
        },
        tooltip: {
          backgroundColor: isDark ? '#374151' : '#ffffff',
          titleColor: isDark ? '#f3f4f6' : '#111827',
          bodyColor: isDark ? '#d1d5db' : '#4b5563',
          borderColor: isDark ? '#4b5563' : '#e5e7eb',
          borderWidth: 1,
          padding: 12,
          callbacks: {
            label: (context: any) => {
              const label = context.dataset.label || '';
              const value = context.raw;
              if (context.dataset.yAxisID === 'y1') {
                return `${label}: ${value.toLocaleString()}`;
              }
              return `${label}: ${value.toFixed(1)}K`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: {
            color: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)',
          },
          ticks: {
            color: isDark ? '#9ca3af' : '#6b7280',
            autoSkip: true,
            maxTicksLimit: isMobile ? 4 : 8,
            maxRotation: 0,
            font: {
              size: isMobile ? 10 : 11,
            },
          },
        },
        y: {
          type: 'linear' as const,
          position: 'left' as const,
          stacked: true,
          grid: {
            color: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)',
          },
          ticks: {
            color: isDark ? '#9ca3af' : '#6b7280',
            maxTicksLimit: isMobile ? 4 : 8,
            font: {
              size: isMobile ? 10 : 11,
            },
            callback: (value: string | number) => `${value}K`,
          },
          title: {
            display: !isMobile,
            text: 'Tokens (K)',
            color: isDark ? '#9ca3af' : '#6b7280',
            font: {
              size: 11,
            },
          },
        },
        y1: {
          type: 'linear' as const,
          position: 'right' as const,
          display: !isMobile,
          grid: {
            drawOnChartArea: false,
          },
          ticks: {
            color: isDark ? '#9ca3af' : '#6b7280',
            font: {
              size: 11,
            },
          },
          title: {
            display: !isMobile,
            text: t('monitor.trend.requests'),
            color: isDark ? '#9ca3af' : '#6b7280',
            font: {
              size: 11,
            },
          },
        },
      },
    }),
    [isDark, isMobile, t]
  );

  const timeRangeLabel = (() => {
    if (timeRange === 'yesterday') return t('monitor.yesterday');
    if (timeRange === 'dayBeforeYesterday') return t('monitor.day_before_yesterday');
    if (timeRange === 1) return t('monitor.today');
    return t('monitor.last_n_days', { n: timeRange });
  })();

  return (
    <div className={`${styles.chartCard} ${styles.trendChartCard}`}>
      <div className={styles.chartHeader}>
        <div>
          <h3 className={styles.chartTitle}>{t('monitor.trend.title')}</h3>
          <p className={styles.chartSubtitle}>
            {timeRangeLabel} · {t('monitor.trend.subtitle')}
          </p>
        </div>
      </div>

      <div className={`${styles.chartContent} ${styles.trendChartContent}`}>
        {loading || dailyItems.length === 0 ? (
          <div className={styles.chartEmpty}>
            {loading ? t('common.loading') : t('monitor.no_data')}
          </div>
        ) : (
          <Chart type="bar" data={chartData} options={chartOptions} />
        )}
      </div>
    </div>
  );
}

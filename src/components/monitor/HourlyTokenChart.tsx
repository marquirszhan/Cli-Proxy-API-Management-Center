import { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Chart } from 'react-chartjs-2';
import type { TimeRange } from '@/pages/MonitorPage';
import { monitorApi, type MonitorHourlyTokensData } from '@/services/api/monitor';
import { buildMonitorTimeRangeParams } from '@/utils/monitor';
import styles from '@/pages/MonitorPage.module.scss';

interface HourlyTokenChartProps {
  timeRange: TimeRange;
  apiFilter: string;
  isDark: boolean;
  preloaded?: MonitorHourlyTokensData;
  preloadedKey?: string;
}

type HourRange = 6 | 12 | 24;

const EMPTY_DATA: MonitorHourlyTokensData = {
  hours: [],
  total_tokens: [],
  input_tokens: [],
  output_tokens: [],
  reasoning_tokens: [],
  cached_tokens: [],
  cache_write_tokens: [],
};

export function HourlyTokenChart({
  timeRange,
  apiFilter,
  isDark,
  preloaded,
  preloadedKey,
}: HourlyTokenChartProps) {
  const { t } = useTranslation();
  const [hourRange, setHourRange] = useState<HourRange>(12);
  const requestKey = `${timeRange}\0${apiFilter}\0${hourRange}`;
  const [hourlyState, setHourlyState] = useState<{
    requestKey: string;
    data: MonitorHourlyTokensData;
  } | null>(null);
  const parentOwned = preloadedKey === requestKey;
  const loading = parentOwned ? preloaded === undefined : hourlyState?.requestKey !== requestKey;
  const hourlyData = parentOwned ? (preloaded ?? EMPTY_DATA) : (hourlyState?.data ?? EMPTY_DATA);

  useEffect(() => {
    if (parentOwned) return;
    let cancelled = false;

    const params = {
      hours: hourRange,
      ...buildMonitorTimeRangeParams(timeRange),
      ...(apiFilter ? { api_filter: apiFilter } : {}),
    };

    monitorApi
      .getHourlyTokens(params)
      .then((data) => {
        if (!cancelled) {
          setHourlyState({ requestKey, data });
        }
      })
      .catch((err) => {
        console.error('Hourly tokens load failed:', err);
        if (!cancelled) {
          setHourlyState({ requestKey, data: EMPTY_DATA });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [timeRange, apiFilter, hourRange, requestKey, parentOwned]);

  // 获取时间范围标签
  const hourRangeLabel = useMemo(() => {
    if (hourRange === 6) return t('monitor.hourly.last_6h');
    if (hourRange === 12) return t('monitor.hourly.last_12h');
    return t('monitor.hourly.last_24h');
  }, [hourRange, t]);

  // 图表数据 - 服务端返回原始 token 数，前端 /1000 转为 K
  const chartData = useMemo(() => {
    const labels = hourlyData.hours.map((hour) => {
      return `${new Date(hour).getHours()}:00`;
    });

    return {
      labels,
      datasets: [
        {
          type: 'line' as const,
          label: t('monitor.hourly_token.input'),
          data: hourlyData.input_tokens.map((v) => v / 1000),
          borderColor: '#22c55e',
          backgroundColor: '#22c55e',
          borderWidth: 2,
          tension: 0.4,
          yAxisID: 'y',
          order: 0,
          pointRadius: 3,
          pointBackgroundColor: '#22c55e',
        },
        {
          type: 'line' as const,
          label: t('monitor.hourly_token.output'),
          data: hourlyData.output_tokens.map((v) => v / 1000),
          borderColor: '#f97316',
          backgroundColor: '#f97316',
          borderWidth: 2,
          tension: 0.4,
          yAxisID: 'y',
          order: 0,
          pointRadius: 3,
          pointBackgroundColor: '#f97316',
        },
        {
          type: 'bar' as const,
          label: t('monitor.hourly_token.total'),
          data: hourlyData.total_tokens.map((v) => v / 1000),
          backgroundColor: 'rgba(59, 130, 246, 0.6)',
          borderColor: 'rgba(59, 130, 246, 0.6)',
          borderWidth: 1,
          borderRadius: 4,
          yAxisID: 'y',
          order: 1,
        },
      ],
    };
  }, [hourlyData, t]);

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
            padding: 12,
            font: {
              size: 11,
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
            font: {
              size: 11,
            },
          },
        },
        y: {
          position: 'left' as const,
          grid: {
            color: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)',
          },
          ticks: {
            color: isDark ? '#9ca3af' : '#6b7280',
            font: {
              size: 11,
            },
            callback: (value: string | number) => `${value}K`,
          },
          title: {
            display: true,
            text: 'Tokens (K)',
            color: isDark ? '#9ca3af' : '#6b7280',
            font: {
              size: 11,
            },
          },
        },
      },
    }),
    [isDark]
  );

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <div>
          <h3 className={styles.chartTitle}>{t('monitor.hourly_token.title')}</h3>
          <p className={styles.chartSubtitle}>{hourRangeLabel}</p>
        </div>
        <div className={styles.chartControls}>
          <button
            className={`${styles.chartControlBtn} ${hourRange === 6 ? styles.active : ''}`}
            onClick={() => setHourRange(6)}
          >
            {t('monitor.hourly.last_6h')}
          </button>
          <button
            className={`${styles.chartControlBtn} ${hourRange === 12 ? styles.active : ''}`}
            onClick={() => setHourRange(12)}
          >
            {t('monitor.hourly.last_12h')}
          </button>
          <button
            className={`${styles.chartControlBtn} ${hourRange === 24 ? styles.active : ''}`}
            onClick={() => setHourRange(24)}
          >
            {t('monitor.hourly.last_24h')}
          </button>
        </div>
      </div>

      <div className={styles.chartContent}>
        {loading || hourlyData.hours.length === 0 ? (
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

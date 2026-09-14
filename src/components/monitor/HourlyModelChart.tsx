import { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Chart } from 'react-chartjs-2';
import type { TimeRange } from '@/pages/MonitorPage';
import { monitorApi, type MonitorHourlyModelsData } from '@/services/api/monitor';
import { buildMonitorTimeRangeParams } from '@/utils/monitor';
import styles from '@/pages/MonitorPage.module.scss';

interface HourlyModelChartProps {
  timeRange: TimeRange;
  apiFilter: string;
  isDark: boolean;
  /** dashboard 默认 hours=12 的预加载；切换 6/24 时回退独立请求 */
  preloaded?: import('@/services/api/monitor').MonitorHourlyModelsData;
  preloadedKey?: string;
}

// 颜色调色板
const COLORS = [
  'rgba(59, 130, 246, 0.7)', // 蓝色
  'rgba(34, 197, 94, 0.7)', // 绿色
  'rgba(249, 115, 22, 0.7)', // 橙色
  'rgba(139, 92, 246, 0.7)', // 紫色
  'rgba(236, 72, 153, 0.7)', // 粉色
  'rgba(6, 182, 212, 0.7)', // 青色
];

type HourRange = 6 | 12 | 24;

const EMPTY_DATA: MonitorHourlyModelsData = {
  hours: [],
  models: [],
  model_data: {},
  success_rates: [],
};

export function HourlyModelChart({
  timeRange,
  apiFilter,
  isDark,
  preloaded,
  preloadedKey,
}: HourlyModelChartProps) {
  const { t } = useTranslation();
  const [hourRange, setHourRange] = useState<HourRange>(12);
  const requestKey = `${timeRange}\0${apiFilter}\0${hourRange}`;
  const [hourlyState, setHourlyState] = useState<{
    requestKey: string;
    data: MonitorHourlyModelsData;
  } | null>(null);
  // 仅默认 12h 由 dashboard 接管；切换 6/24 时 preloadedKey 不匹配，回退独立请求。
  const parentOwned = preloadedKey === requestKey;
  const loading = parentOwned ? preloaded === undefined : hourlyState?.requestKey !== requestKey;
  const hourlyData = parentOwned ? (preloaded ?? EMPTY_DATA) : (hourlyState?.data ?? EMPTY_DATA);

  useEffect(() => {
    if (parentOwned) return;
    let cancelled = false;

    const params = {
      hours: hourRange,
      limit: 6,
      ...buildMonitorTimeRangeParams(timeRange),
      ...(apiFilter ? { api_filter: apiFilter } : {}),
    };

    monitorApi
      .getHourlyModels(params)
      .then((data) => {
        if (!cancelled) {
          setHourlyState({ requestKey, data });
        }
      })
      .catch((err) => {
        console.error('Hourly models load failed:', err);
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

  // 图表数据
  const chartData = useMemo(() => {
    const labels = hourlyData.hours.map((hour) => {
      return `${new Date(hour).getHours()}:00`;
    });

    // 成功率折线放在最前面
    const datasets: any[] = [
      {
        type: 'line' as const,
        label: t('monitor.hourly.success_rate'),
        data: hourlyData.success_rates,
        borderColor: '#4ef0c3',
        backgroundColor: '#4ef0c3',
        borderWidth: 2.5,
        tension: 0.4,
        yAxisID: 'y1',
        stack: '',
        pointRadius: 3,
        pointBackgroundColor: '#4ef0c3',
        pointBorderColor: '#4ef0c3',
      },
    ];

    // 添加模型柱状图
    hourlyData.models.forEach((model, index) => {
      datasets.push({
        type: 'bar' as const,
        label: model,
        data: hourlyData.model_data[model] || [],
        backgroundColor: COLORS[index % COLORS.length],
        borderColor: COLORS[index % COLORS.length],
        borderWidth: 1,
        borderRadius: 4,
        stack: 'models',
        yAxisID: 'y',
      });
    });

    return { labels, datasets };
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
              return chart.data.datasets
                .map((dataset: any, i: number) => {
                  const isLine = dataset.type === 'line';
                  // 柱状图数据全为0时不显示标签
                  if (
                    !isLine &&
                    Array.isArray(dataset.data) &&
                    dataset.data.every((v: number) => v === 0)
                  ) {
                    return null;
                  }
                  return {
                    text: dataset.label,
                    fillStyle: dataset.backgroundColor,
                    strokeStyle: dataset.borderColor,
                    lineWidth: 0,
                    hidden: !chart.isDatasetVisible(i),
                    datasetIndex: i,
                    pointStyle: isLine ? 'circle' : 'rect',
                  };
                })
                .filter(Boolean);
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
          filter: (tooltipItem: any) => {
            // 值为0的模型不在tooltip中显示
            return tooltipItem.raw !== 0;
          },
        },
      },
      scales: {
        x: {
          stacked: true,
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
          stacked: true,
          position: 'left' as const,
          grid: {
            color: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)',
          },
          ticks: {
            color: isDark ? '#9ca3af' : '#6b7280',
            font: {
              size: 11,
            },
          },
          title: {
            display: true,
            text: t('monitor.hourly.requests'),
            color: isDark ? '#9ca3af' : '#6b7280',
            font: {
              size: 11,
            },
          },
        },
        y1: {
          position: 'right' as const,
          min: 0,
          max: 100,
          grid: {
            drawOnChartArea: false,
          },
          ticks: {
            color: isDark ? '#9ca3af' : '#6b7280',
            font: {
              size: 11,
            },
            callback: (value: string | number) => `${value}%`,
          },
          title: {
            display: true,
            text: t('monitor.hourly.success_rate'),
            color: isDark ? '#9ca3af' : '#6b7280',
            font: {
              size: 11,
            },
          },
        },
      },
    }),
    [isDark, t]
  );

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <div>
          <h3 className={styles.chartTitle}>{t('monitor.hourly_model.title')}</h3>
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

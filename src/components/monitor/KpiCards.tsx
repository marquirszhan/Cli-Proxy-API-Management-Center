import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { TimeRange } from '@/pages/MonitorPage';
import { monitorApi, type MonitorKpiData } from '@/services/api/monitor';
import {
  buildMonitorTimeRangeParams,
  formatMonitorNumber,
  normalizeMonitorKpiData,
} from '@/utils/monitor';
import styles from '@/pages/MonitorPage.module.scss';

interface KpiCardsProps {
  timeRange: TimeRange;
  apiFilter: string;
  isDark?: boolean;
  /** 来自 dashboard 合并接口的预加载数据；有则跳过独立 KPI 请求 */
  preloaded?: MonitorKpiData | null;
  preloadedKey?: string;
}

export function KpiCards({ timeRange, apiFilter, preloaded, preloadedKey }: KpiCardsProps) {
  const { t } = useTranslation();
  const requestKey = `${timeRange}\0${apiFilter}`;
  const [kpiResult, setKpiResult] = useState<{
    requestKey: string;
    data: MonitorKpiData | null;
  } | null>(null);
  // 父组件传入 preloadedKey 即接管数据源；加载中 preloaded 为 undefined，禁止再打独立 KPI 请求。
  const parentOwned = preloadedKey === requestKey;
  const loading = parentOwned ? preloaded === undefined : kpiResult?.requestKey !== requestKey;
  const kpiData = parentOwned ? (preloaded ?? null) : (kpiResult?.data ?? null);

  useEffect(() => {
    if (parentOwned) return;
    let cancelled = false;

    const params = {
      ...buildMonitorTimeRangeParams(timeRange),
      ...(apiFilter ? { api_filter: apiFilter } : {}),
    };

    monitorApi
      .getKpi(params)
      .then((data) => {
        if (!cancelled) {
          setKpiResult({ requestKey, data });
        }
      })
      .catch((err) => {
        console.error('KPI data load failed:', err);
        if (!cancelled) {
          setKpiResult({ requestKey, data: null });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [timeRange, apiFilter, requestKey, parentOwned]);

  const timeRangeLabel = (() => {
    if (timeRange === 'yesterday') return t('monitor.yesterday');
    if (timeRange === 'dayBeforeYesterday') return t('monitor.day_before_yesterday');
    if (timeRange === 1) return t('monitor.today');
    return t('monitor.last_n_days', { n: timeRange });
  })();

  const stats = normalizeMonitorKpiData(kpiData);
  const hasStats = !loading && stats !== null;

  return (
    <div className={styles.kpiGrid}>
      {/* 请求数 */}
      <div className={styles.kpiCard}>
        <div className={styles.kpiTitle}>
          <span className={styles.kpiLabel}>{t('monitor.kpi.requests')}</span>
          <span className={styles.kpiTag}>{timeRangeLabel}</span>
        </div>
        <div className={styles.kpiValue}>
          {hasStats ? formatMonitorNumber(stats.total_requests) : '--'}
        </div>
        <div className={styles.kpiMeta}>
          <span className={styles.kpiSuccess}>
            {t('monitor.kpi.success')}: {hasStats ? stats.success_requests.toLocaleString() : '--'}
          </span>
          <span className={styles.kpiFailure}>
            {t('monitor.kpi.failed')}: {hasStats ? stats.failed_requests.toLocaleString() : '--'}
          </span>
          <span>
            {t('monitor.kpi.rate')}: {hasStats ? `${stats.success_rate.toFixed(1)}%` : '--'}
          </span>
        </div>
      </div>

      {/* Tokens */}
      <div className={`${styles.kpiCard} ${styles.green}`}>
        <div className={styles.kpiTitle}>
          <span className={styles.kpiLabel}>{t('monitor.kpi.tokens')}</span>
          <span className={styles.kpiTag}>{timeRangeLabel}</span>
        </div>
        <div className={styles.kpiValue}>
          {hasStats ? formatMonitorNumber(stats.total_tokens) : '--'}
        </div>
        <div className={styles.kpiMeta}>
          <span>
            {t('monitor.kpi.input')}: {hasStats ? formatMonitorNumber(stats.input_tokens) : '--'}
          </span>
          <span>
            {t('monitor.kpi.output')}: {hasStats ? formatMonitorNumber(stats.output_tokens) : '--'}
          </span>
        </div>
      </div>

      {/* 平均 TPM */}
      <div className={`${styles.kpiCard} ${styles.purple}`}>
        <div className={styles.kpiTitle}>
          <span className={styles.kpiLabel}>{t('monitor.kpi.avg_tpm')}</span>
          <span className={styles.kpiTag}>{timeRangeLabel}</span>
        </div>
        <div className={styles.kpiValue}>
          {hasStats ? formatMonitorNumber(stats.avg_tpm) : '--'}
        </div>
        <div className={styles.kpiMeta}>
          <span>{t('monitor.kpi.tokens_per_minute')}</span>
        </div>
      </div>

      {/* 平均 RPM */}
      <div className={`${styles.kpiCard} ${styles.orange}`}>
        <div className={styles.kpiTitle}>
          <span className={styles.kpiLabel}>{t('monitor.kpi.avg_rpm')}</span>
          <span className={styles.kpiTag}>{timeRangeLabel}</span>
        </div>
        <div className={styles.kpiValue}>{hasStats ? stats.avg_rpm.toFixed(1) : '--'}</div>
        <div className={styles.kpiMeta}>
          <span>{t('monitor.kpi.requests_per_minute')}</span>
        </div>
      </div>

      {/* 日均 RPD */}
      <div className={`${styles.kpiCard} ${styles.cyan}`}>
        <div className={styles.kpiTitle}>
          <span className={styles.kpiLabel}>{t('monitor.kpi.avg_rpd')}</span>
          <span className={styles.kpiTag}>{timeRangeLabel}</span>
        </div>
        <div className={styles.kpiValue}>
          {hasStats ? formatMonitorNumber(stats.avg_rpd) : '--'}
        </div>
        <div className={styles.kpiMeta}>
          <span>{t('monitor.kpi.requests_per_day')}</span>
        </div>
      </div>
    </div>
  );
}

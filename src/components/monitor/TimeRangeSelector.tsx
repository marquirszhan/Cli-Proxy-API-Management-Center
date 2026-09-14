import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import styles from '@/pages/MonitorPage.module.scss';

export type TimeRange = 1 | 7 | 14 | 30 | 'yesterday' | 'dayBeforeYesterday' | 'custom';

interface DateRange {
  start: Date;
  end: Date;
}

interface TimeRangeSelectorProps {
  value: TimeRange;
  onChange: (range: TimeRange, customRange?: DateRange) => void;
  customRange?: DateRange;
}

// 获取昨天的日期范围
function getYesterdayRange(): DateRange {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const start = new Date(yesterday);
  start.setHours(0, 0, 0, 0);
  const end = new Date(yesterday);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

// 获取前天的日期范围
function getDayBeforeYesterdayRange(): DateRange {
  const now = new Date();
  const dayBefore = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  const start = new Date(dayBefore);
  start.setHours(0, 0, 0, 0);
  const end = new Date(dayBefore);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

export function TimeRangeSelector({ value, onChange, customRange }: TimeRangeSelectorProps) {
  const { t } = useTranslation();
  const [showCustom, setShowCustom] = useState(value === 'custom');
  const [startDate, setStartDate] = useState(() => {
    if (customRange?.start) {
      return formatDateForInput(customRange.start);
    }
    const date = new Date();
    date.setDate(date.getDate() - 7);
    return formatDateForInput(date);
  });
  const [endDate, setEndDate] = useState(() => {
    if (customRange?.end) {
      return formatDateForInput(customRange.end);
    }
    return formatDateForInput(new Date());
  });

  const handleTimeClick = useCallback(
    (range: TimeRange) => {
      if (range === 'custom') {
        setShowCustom(true);
        onChange(range);
      } else if (range === 'yesterday') {
        setShowCustom(false);
        onChange(range, getYesterdayRange());
      } else if (range === 'dayBeforeYesterday') {
        setShowCustom(false);
        onChange(range, getDayBeforeYesterdayRange());
      } else {
        setShowCustom(false);
        onChange(range);
      }
    },
    [onChange]
  );

  const handleApplyCustom = useCallback(() => {
    if (startDate && endDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);

      if (start <= end) {
        onChange('custom', { start, end });
      }
    }
  }, [startDate, endDate, onChange]);

  // 获取按钮显示文本
  const getButtonLabel = (range: TimeRange): string => {
    switch (range) {
      case 1:
        return t('monitor.time.today');
      case 'yesterday':
        return t('monitor.time.yesterday');
      case 'dayBeforeYesterday':
        return t('monitor.time.dayBeforeYesterday');
      case 'custom':
        return t('monitor.time.custom');
      default:
        return t('monitor.time.last_n_days', { n: range });
    }
  };

  return (
    <div className={styles.timeRangeSelector}>
      <div className={styles.timeButtons}>
        {(['dayBeforeYesterday', 'yesterday', 1, 7, 14, 30, 'custom'] as TimeRange[]).map(
          (range) => (
            <button
              key={range}
              className={`${styles.timeButton} ${value === range ? styles.active : ''}`}
              onClick={() => handleTimeClick(range)}
            >
              {getButtonLabel(range)}
            </button>
          )
        )}
      </div>
      {showCustom && (
        <div className={styles.customDatePicker}>
          <input
            type="date"
            className={styles.dateInput}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <span className={styles.dateSeparator}>{t('monitor.time.to')}</span>
          <input
            type="date"
            className={styles.dateInput}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
          <button className={styles.dateApplyBtn} onClick={handleApplyCustom}>
            {t('monitor.time.apply')}
          </button>
        </div>
      )}
    </div>
  );
}

function formatDateForInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 根据时间范围过滤数据的工具函数
export function filterByTimeRange<T extends { timestamp?: string }>(
  items: T[],
  range: TimeRange,
  customRange?: DateRange
): T[] {
  const now = new Date();
  let cutoffStart: Date;
  let cutoffEnd: Date = new Date(now.getTime());
  cutoffEnd.setHours(23, 59, 59, 999);

  if (range === 'custom' && customRange) {
    cutoffStart = customRange.start;
    cutoffEnd = customRange.end;
  } else if (range === 'yesterday' && customRange) {
    cutoffStart = customRange.start;
    cutoffEnd = customRange.end;
  } else if (range === 'dayBeforeYesterday' && customRange) {
    cutoffStart = customRange.start;
    cutoffEnd = customRange.end;
  } else if (typeof range === 'number') {
    // range=1 表示"今天"，应该从今天 00:00 开始
    // range=7 表示"最近7天"，应该从 6 天前的 00:00 开始（包含今天共7天）
    const daysBack = range - 1;
    cutoffStart = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
    cutoffStart.setHours(0, 0, 0, 0);
  } else {
    // 默认7天
    cutoffStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    cutoffStart.setHours(0, 0, 0, 0);
  }

  return items.filter((item) => {
    if (!item.timestamp) return false;
    const timestamp = new Date(item.timestamp);
    return timestamp >= cutoffStart && timestamp <= cutoffEnd;
  });
}

// 格式化时间范围显示
export function formatTimeRangeCaption(
  range: TimeRange,
  customRange?: DateRange,
  t?: (key: string, options?: any) => string
): string {
  if (range === 'custom' && customRange) {
    const startStr = formatDateForDisplay(customRange.start);
    const endStr = formatDateForDisplay(customRange.end);
    return `${startStr} - ${endStr}`;
  }
  if (range === 1) {
    return t ? t('monitor.time.today') : '今天';
  }
  if (range === 'yesterday') {
    return t ? t('monitor.time.yesterday') : '昨天';
  }
  if (range === 'dayBeforeYesterday') {
    return t ? t('monitor.time.dayBeforeYesterday') : '前天';
  }
  return t ? t('monitor.time.last_n_days', { n: range }) : `最近 ${range} 天`;
}

function formatDateForDisplay(date: Date): string {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${month}/${day}`;
}

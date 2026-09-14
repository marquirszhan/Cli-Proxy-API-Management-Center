/**
 * 有界并发 + 同 key 去重的请求闸门。
 * 用于监控中心这类「多组件齐射同一 SQLite」的场景，避免并发打爆后端。
 */

export interface RequestGate {
  run<T>(key: string, task: () => Promise<T>): Promise<T>;
  /** 测试/调试用：当前在途 + 排队数量 */
  pendingCount(): number;
}

export function createRequestGate(concurrency: number): RequestGate {
  const limit = Math.max(1, Math.floor(concurrency));
  let active = 0;
  const queue: Array<() => void> = [];
  const inflight = new Map<string, Promise<unknown>>();

  const pump = () => {
    while (active < limit && queue.length > 0) {
      const next = queue.shift();
      if (next) next();
    }
  };

  const acquire = (): Promise<void> => {
    if (active < limit) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      queue.push(() => {
        active += 1;
        resolve();
      });
    });
  };

  const release = () => {
    active = Math.max(0, active - 1);
    pump();
  };

  return {
    run<T>(key: string, task: () => Promise<T>): Promise<T> {
      const normalizedKey = key || '';
      if (normalizedKey) {
        const existing = inflight.get(normalizedKey);
        if (existing) {
          return existing as Promise<T>;
        }
      }

      const promise = (async () => {
        await acquire();
        try {
          return await task();
        } finally {
          release();
          if (normalizedKey) {
            inflight.delete(normalizedKey);
          }
        }
      })();

      if (normalizedKey) {
        inflight.set(normalizedKey, promise);
      }
      return promise;
    },

    pendingCount() {
      return active + queue.length;
    },
  };
}

/** 监控接口默认闸门：单连接 SQLite 上最多 2 路并行 */
export const monitorRequestGate = createRequestGate(2);

export function buildMonitorRequestKey(
  path: string,
  params?: Record<string, unknown> | object
): string {
  if (!params) return path;
  const entries = Object.entries(params as Record<string, unknown>)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return [key, [...value].map(String).sort().join(',')] as const;
      }
      return [key, String(value)] as const;
    })
    .sort(([a], [b]) => a.localeCompare(b));
  return `${path}?${entries.map(([k, v]) => `${k}=${v}`).join('&')}`;
}

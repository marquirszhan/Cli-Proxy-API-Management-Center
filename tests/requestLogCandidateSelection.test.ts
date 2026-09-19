import { describe, expect, test } from 'bun:test';
import { selectCandidateHintIds, type RequestIdHint } from '../src/utils/requestLogUpstreamModel';

const T = (iso: string) => Date.parse(iso);

const hint = (
  id: string,
  first: string,
  last: string,
  models: string[],
  completed = true
): RequestIdHint => ({
  id,
  firstTs: T(first),
  lastTs: T(last),
  models,
  apiRequest: true,
  completed,
});

describe('selectCandidateHintIds', () => {
  test('模型名对不上的 hint 不再被直接排除', () => {
    // 取自真实数据：openai-compatibility 的 session-affinity 日志记的是上游别名
    // `gp/Cursor Grok 4.6`，正则只抓到 `gp`，与客户端请求的 grok-4.6 对不上。
    // 旧实现据此把它踢出候选，那一行就永远拿不到 dump。
    const rows = [{ id: 'r1', timestampMs: T('2026-09-19T16:33:05Z'), model: 'grok-4.6' }];
    const hints = [hint('1398d52c', '2026-09-19T16:33:05Z', '2026-09-19T16:33:10Z', ['gp'])];

    expect(selectCandidateHintIds(rows, hints)).toContain('1398d52c');
  });

  test('每一行都能分到抓取名额，不被请求量大的模型挤掉', () => {
    // 19 行 gemini + 1 行 grok。抓取名额有限（loadDumps 只取前若干个），
    // 纯全局排序会让 gemini 占满名额，grok 那行永远是空的。
    const rows = [];
    const hints: RequestIdHint[] = [];
    for (let i = 0; i < 19; i += 1) {
      const at = `2026-09-19T16:${String(10 + i).padStart(2, '0')}:00Z`;
      rows.push({ id: `g${i}`, timestampMs: T(at), model: 'gemini-3.8-flash-high' });
      hints.push(hint(`gh${i}`, at, at, ['gemini-3.8-flash-high']));
    }
    rows.push({ id: 'grok', timestampMs: T('2026-09-19T16:33:05Z'), model: 'grok-4.6' });
    hints.push(hint('grokhint', '2026-09-19T16:33:05Z', '2026-09-19T16:33:10Z', ['gp']));

    const ids = selectCandidateHintIds(rows, hints);
    // 第一轮每行各取一个，因此 20 行的最佳候选都落在前 20 个里。
    expect(ids.slice(0, 20)).toContain('grokhint');
  });

  test('覆盖了页面行的 hint 排在不覆盖的前面', () => {
    const rows = [{ id: 'r1', timestampMs: T('2026-09-19T16:20:00Z'), model: 'm1' }];
    const hints = [
      hint('far', '2026-09-19T16:18:00Z', '2026-09-19T16:18:30Z', ['m1']),
      hint('covering', '2026-09-19T16:19:58Z', '2026-09-19T16:20:05Z', ['other']),
    ];

    expect(selectCandidateHintIds(rows, hints)[0]).toBe('covering');
  });

  test('时间窗仍是硬条件：差出几小时的 hint 直接排除', () => {
    // 放宽的只是模型名校验，时间窗没有放宽——否则候选会被无关的历史请求灌满。
    const rows = [{ id: 'r1', timestampMs: T('2026-09-19T16:20:00Z'), model: 'm1' }];
    const hints = [
      hint('stale', '2026-09-19T10:00:00Z', '2026-09-19T10:00:05Z', ['m1']),
      hint('covering', '2026-09-19T16:19:58Z', '2026-09-19T16:20:05Z', ['m1']),
    ];

    const ids = selectCandidateHintIds(rows, hints);
    expect(ids[0]).toBe('covering');
    expect(ids).not.toContain('stale');
  });

  test('结果不含重复 id', () => {
    const rows = [
      { id: 'r1', timestampMs: T('2026-09-19T16:20:00Z'), model: 'm1' },
      { id: 'r2', timestampMs: T('2026-09-19T16:20:02Z'), model: 'm1' },
    ];
    // 同一个 hint 同时罩住两行，轮询时不能被加入两次。
    const hints = [hint('shared', '2026-09-19T16:19:58Z', '2026-09-19T16:20:05Z', ['m1'])];

    const ids = selectCandidateHintIds(rows, hints);
    expect(ids).toEqual(['shared']);
  });
});

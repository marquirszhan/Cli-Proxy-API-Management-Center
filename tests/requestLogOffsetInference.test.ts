import { describe, expect, test } from 'bun:test';
import { collectRequestIdHints, inferLogOffsetMinutes } from '../src/utils/requestLogUpstreamModel';

/** CPA 的 app log 行：时间戳不带时区，这正是需要推断的原因。 */
const logLine = (naive: string, id = '7f72c271') =>
  `[${naive}] [${id}] [info ] 200 | GET "/v1/responses"`;

const localOffset = -new Date().getTimezoneOffset();

describe('inferLogOffsetMinutes', () => {
  test('日志写于 -07:00 的服务器时，推断出 -420', () => {
    // 服务器墙钟 09:11:49 对应真实时刻 16:11:49Z，日志滞后 4 秒。
    const now = Date.parse('2026-09-19T16:11:53Z');
    expect(inferLogOffsetMinutes([logLine('2026-09-19 09:11:49')], now)).toBe(-7 * 60);
  });

  test('同一份日志换成 +08:00 的服务器也能认出来', () => {
    const now = Date.parse('2026-09-19T01:11:53Z');
    expect(inferLogOffsetMinutes([logLine('2026-09-19 09:11:49')], now)).toBe(8 * 60);
  });

  test('支持半小时偏移的时区', () => {
    // Asia/Kolkata = +05:30，正是这台服务器宿主机原先的时区。
    const now = Date.parse('2026-09-19T14:56:20Z');
    expect(inferLogOffsetMinutes([logLine('2026-09-19 20:26:17')], now)).toBe(5 * 60 + 30);
  });

  test('取最新的一行，不被旧行带偏', () => {
    const now = Date.parse('2026-09-19T16:11:53Z');
    const lines = [
      logLine('2026-09-19 03:00:00'),
      logLine('2026-09-19 09:11:49'),
      logLine('2026-09-19 07:30:00'),
    ];
    expect(inferLogOffsetMinutes(lines, now)).toBe(-7 * 60);
  });

  test('日志滞后 10 分钟仍能推准——靠的是排除「写于未来」的候选', () => {
    // 真实偏移 -420 的滞后是 10 分钟；若只比差值，-435 只差 5 分钟会胜出，
    // 但它意味着日志写于 now 之后 5 分钟，超出时钟漂移容差，应被排除。
    const now = Date.parse('2026-09-19T16:21:49Z');
    expect(inferLogOffsetMinutes([logLine('2026-09-19 09:11:49')], now)).toBe(-7 * 60);
  });

  test('所有候选都落在未来时回退到本地时区', () => {
    // 服务器时钟比本地快出一天，没有任何偏移能解释，不硬猜。
    const now = Date.parse('2026-09-18T00:00:00Z');
    expect(inferLogOffsetMinutes([logLine('2026-09-19 09:11:49')], now)).toBe(localOffset);
  });

  test('没有可识别的日志行时回退到本地时区', () => {
    expect(inferLogOffsetMinutes([], Date.now())).toBe(localOffset);
    expect(inferLogOffsetMinutes(['这不是一行 CPA 日志'], Date.now())).toBe(localOffset);
  });
});

describe('collectRequestIdHints 的偏移处理', () => {
  test('显式传入偏移时按它解析', () => {
    const hints = collectRequestIdHints([logLine('2026-09-19 09:11:49')], -7 * 60);
    expect(hints[0].firstTs).toBe(Date.parse('2026-09-19T09:11:49-07:00'));
  });

  test('同一份日志给不同偏移会得到不同时刻——这正是之前整列变空的原因', () => {
    const line = [logLine('2026-09-19 09:11:49')];
    const shanghai = collectRequestIdHints(line, 8 * 60)[0].firstTs;
    const losAngeles = collectRequestIdHints(line, -7 * 60)[0].firstTs;
    // 15 小时的落差，远超 matchUpstreamModels 的 120 秒时间窗。
    expect(losAngeles - shanghai).toBe(15 * 60 * 60 * 1000);
  });
});

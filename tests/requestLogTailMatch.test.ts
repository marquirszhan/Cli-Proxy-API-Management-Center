import { describe, expect, test } from 'bun:test';
import { matchUpstreamModels, type RequestLogDump } from '../src/utils/requestLogUpstreamModel';

/**
 * 用 Range 只取 dump 尾部后，`=== REQUEST BODY ===` 落在被丢弃的头部，
 * 解析器会把响应里的模型当成「请求的模型」——而那恰恰是被替换后的名字。
 * matchUpstreamModels 拿 requestedModels 做相关性校验，于是「上游换了模型」
 * 这个唯一需要检测的场景反而必然被判为不相关。
 *
 * 取自真实数据：客户端请求 gemini-3.8-flash-high，上游返回 gemini-3.8-flash。
 */
const row = {
  id: 'row-1',
  timestampMs: Date.parse('2026-09-19T16:24:58Z'),
  model: 'gemini-3.8-flash-high',
};

const tailDump = (requestedModels: string[]): RequestLogDump => ({
  id: '6e0619dc',
  startedAt: Date.parse('2026-09-19T16:24:58Z'),
  endedAt: Date.parse('2026-09-19T16:25:02Z'),
  requestedModels,
  upstreamEvents: [{ at: Date.parse('2026-09-19T16:25:00Z'), model: 'gemini-3.8-flash' }],
});

describe('尾部 dump 的相关性校验', () => {
  test('把上游返回的模型当成 requestedModels 会丢掉这条匹配', () => {
    // 这是回归前的行为，保留它是为了说明为什么必须置空。
    const matched = matchUpstreamModels([row], [tailDump(['gemini-3.8-flash'])]);
    expect(matched['row-1']).toBe('');
  });

  test('置空 requestedModels 后能正确识别出模型被替换', () => {
    const matched = matchUpstreamModels([row], [tailDump([])]);
    expect(matched['row-1']).toBe('gemini-3.8-flash');
  });

  test('请求与返回同名时两种写法都能匹配', () => {
    // gpt-6-astra 请求响应同名，所以此前侥幸没暴露问题。
    const sameNameRow = { ...row, model: 'gpt-6-astra' };
    const dump: RequestLogDump = {
      ...tailDump(['gpt-6-astra']),
      upstreamEvents: [{ at: Date.parse('2026-09-19T16:25:00Z'), model: 'gpt-6-astra' }],
    };
    expect(matchUpstreamModels([sameNameRow], [dump])['row-1']).toBe('gpt-6-astra');
    expect(matchUpstreamModels([sameNameRow], [{ ...dump, requestedModels: [] }])['row-1']).toBe(
      'gpt-6-astra'
    );
  });

  test('完整 dump 仍保留 requestedModels 校验，不相关的 dump 不会被误用', () => {
    // 头部完整时 requestedModels 是可信的客户端请求模型，该挡的仍要挡住。
    const unrelated: RequestLogDump = {
      id: 'other',
      startedAt: Date.parse('2026-09-19T16:24:58Z'),
      endedAt: Date.parse('2026-09-19T16:25:02Z'),
      requestedModels: ['claude-sonnet-5'],
      upstreamEvents: [{ at: Date.parse('2026-09-19T16:25:00Z'), model: 'claude-sonnet-5' }],
    };
    expect(matchUpstreamModels([row], [unrelated])['row-1']).toBe('');
  });
});

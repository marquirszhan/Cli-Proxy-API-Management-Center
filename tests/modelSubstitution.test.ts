import { describe, expect, test } from 'bun:test';
import {
  detectModelConsistency,
  isModelSubstituted,
  normalizeModelName,
} from '../src/utils/modelSubstitution';

describe('normalizeModelName', () => {
  test('trims, lowercases and drops the thinking suffix', () => {
    expect(normalizeModelName('  Claude-Sonnet-5(16384) ')).toBe('claude-sonnet-5');
    expect(normalizeModelName('gpt-6-astra(high)')).toBe('gpt-6-astra');
  });

  test('only treats a trailing parenthesised group as a suffix', () => {
    // 后端 thinking.ParseSuffix 要求以 ')' 结尾，否则原样保留。
    expect(normalizeModelName('gpt-6(high')).toBe('gpt-6(high');
    expect(normalizeModelName('gemini-3.8-flash-high')).toBe('gemini-3.8-flash-high');
  });
});

describe('isModelSubstituted - 不算替换的情况', () => {
  test('完全相同', () => {
    expect(isModelSubstituted('claude-sonnet-5', 'claude-sonnet-5')).toBe(false);
  });

  test('大小写与空格差异', () => {
    expect(isModelSubstituted(' Claude-Sonnet-5 ', 'claude-sonnet-5')).toBe(false);
  });

  test('thinking 括号后缀', () => {
    expect(isModelSubstituted('claude-sonnet-5(16384)', 'claude-sonnet-5')).toBe(false);
  });

  test('YYYY-MM-DD 日期别名（双向）', () => {
    expect(isModelSubstituted('claude-sonnet-4-5', 'claude-sonnet-4-5-2025-09-29')).toBe(false);
    expect(isModelSubstituted('claude-sonnet-4-5-2025-09-29', 'claude-sonnet-4-5')).toBe(false);
  });

  test('YYYYMMDD 日期别名（双向）', () => {
    expect(isModelSubstituted('claude-haiku-4-5', 'claude-haiku-4-5-20251001')).toBe(false);
    expect(isModelSubstituted('claude-haiku-4-5-20251001', 'claude-haiku-4-5')).toBe(false);
  });

  test('三位数字版本号后缀', () => {
    expect(isModelSubstituted('gemini-2.5-pro', 'gemini-2.5-pro-002')).toBe(false);
  });

  test('provider 前缀', () => {
    expect(isModelSubstituted('opusmax/claude-fable-5', 'claude-fable-5')).toBe(false);
    expect(isModelSubstituted('limit/claude-fable-5', 'opusmax/claude-fable-5')).toBe(false);
  });

  test('-latest 后缀', () => {
    expect(isModelSubstituted('minimax-m3-latest', 'minimax-m3')).toBe(false);
  });

  test('provider 前缀 + 日期别名叠加', () => {
    expect(isModelSubstituted('vendor/claude-sonnet-4-5', 'claude-sonnet-4-5-20250929')).toBe(
      false
    );
  });

  test('任一侧为空都不算替换', () => {
    expect(isModelSubstituted('', 'claude-sonnet-5')).toBe(false);
    expect(isModelSubstituted('claude-sonnet-5', '')).toBe(false);
    expect(isModelSubstituted('claude-sonnet-5', '   ')).toBe(false);
  });
});

describe('isModelSubstituted - 算替换的情况', () => {
  test('不同模型', () => {
    expect(isModelSubstituted('claude-opus-5', 'claude-sonnet-5')).toBe(true);
  });

  test('档位后缀不是括号形式时算不同模型', () => {
    // 对应本部署 antigravity 实测到的后端 warn：
    // upstream served model "gemini-3.8-flash" for requested model "gemini-3.8-flash-high"
    expect(isModelSubstituted('gemini-3.8-flash-high', 'gemini-3.8-flash')).toBe(true);
  });

  test('后缀既不是日期也不是三位版本号', () => {
    expect(isModelSubstituted('gemini-2.5-pro', 'gemini-2.5-pro-preview')).toBe(true);
    expect(isModelSubstituted('gemini-2.5-pro', 'gemini-2.5-pro-0021')).toBe(true);
    expect(isModelSubstituted('claude-sonnet-4-5', 'claude-sonnet-4-5-2025-13')).toBe(true);
  });

  test('日期位不是数字', () => {
    expect(isModelSubstituted('claude-sonnet-4-5', 'claude-sonnet-4-5-20251a01')).toBe(true);
  });
});

describe('detectModelConsistency', () => {
  test('拿不到上游模型时是 unknown，不是 match', () => {
    expect(detectModelConsistency('claude-sonnet-5', '')).toBe('unknown');
    expect(detectModelConsistency('claude-sonnet-5', '  ')).toBe('unknown');
  });

  test('请求模型为空同样是 unknown', () => {
    expect(detectModelConsistency('', 'claude-sonnet-5')).toBe('unknown');
  });

  test('一致与不一致', () => {
    expect(detectModelConsistency('claude-sonnet-5', 'claude-sonnet-5')).toBe('match');
    expect(detectModelConsistency('claude-sonnet-4-5', 'claude-sonnet-4-5-20250929')).toBe('match');
    expect(detectModelConsistency('gemini-3.8-flash-high', 'gemini-3.8-flash')).toBe('substituted');
  });
});

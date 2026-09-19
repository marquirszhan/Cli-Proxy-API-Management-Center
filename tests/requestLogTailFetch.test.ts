import { afterEach, describe, expect, test } from 'bun:test';
import { apiClient } from '../src/services/api/client';
import { logsApi } from '../src/services/api/logs';

const BASE = 'http://panel.test/v0/management';
const TAIL_HEADER = 'bytes=-262144';

const originalFetch = globalThis.fetch;
const originalGetBaseUrl = apiClient.getBaseUrl;
const originalGetManagementKey = apiClient.getManagementKey;

interface Call {
  url: string;
  range: string | null;
  authorization: string | null;
}

/** 装一个假的 fetch，按调用次序返回预设响应，并记录每次请求头。 */
const stubFetch = (responses: Response[]): Call[] => {
  const calls: Call[] = [];
  let index = 0;
  apiClient.getBaseUrl = () => BASE;
  apiClient.getManagementKey = () => 'test-key';
  globalThis.fetch = (async (input: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      range: headers.get('Range'),
      authorization: headers.get('Authorization'),
    });
    const response = responses[index];
    index += 1;
    if (!response) throw new Error(`unexpected fetch call #${index}`);
    return response;
  }) as unknown as typeof fetch;
  return calls;
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  apiClient.getBaseUrl = originalGetBaseUrl;
  apiClient.getManagementKey = originalGetManagementKey;
});

describe('fetchRequestLogText', () => {
  test('先用 Range 取尾部，206 时标记为 partial', async () => {
    const calls = stubFetch([
      new Response('tail-chunk', {
        status: 206,
        headers: { 'Content-Range': 'bytes 2177270-2439413/2439414' },
      }),
    ]);

    const result = await logsApi.fetchRequestLogText('c26c2100');

    expect(result.text).toBe('tail-chunk');
    expect(result.partial).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].range).toBe(TAIL_HEADER);
    expect(calls[0].authorization).toBe('Bearer test-key');
    expect(calls[0].url).toBe(`${BASE}/request-log-by-id/c26c2100`);
  });

  test('服务端忽略 Range 直接返回 200 时不标记 partial', async () => {
    // 文件比请求的尾部还小，或部署在不支持 Range 的反代后面，都会走到这里。
    const calls = stubFetch([new Response('whole-file', { status: 200 })]);

    const result = await logsApi.fetchRequestLogText('abc');

    expect(result.text).toBe('whole-file');
    expect(result.partial).toBe(false);
    expect(calls).toHaveLength(1);
  });

  test('416 时回退成不带 Range 的整文件请求', async () => {
    const calls = stubFetch([
      new Response('', { status: 416 }),
      new Response('whole-file', { status: 200 }),
    ]);

    const result = await logsApi.fetchRequestLogText('abc');

    expect(result.text).toBe('whole-file');
    expect(result.partial).toBe(false);
    expect(calls).toHaveLength(2);
    expect(calls[0].range).toBe(TAIL_HEADER);
    expect(calls[1].range).toBeNull();
  });

  test('404 原样抛出并带上 status，供调用方识别缺失', async () => {
    stubFetch([new Response('', { status: 404 })]);

    await expect(logsApi.fetchRequestLogText('missing')).rejects.toMatchObject({ status: 404 });
  });

  test('回退请求本身失败时也带上 status', async () => {
    stubFetch([new Response('', { status: 416 }), new Response('', { status: 500 })]);

    await expect(logsApi.fetchRequestLogText('boom')).rejects.toMatchObject({ status: 500 });
  });

  test('超长响应被截断到上限', async () => {
    const oversized = 'x'.repeat(1_500_000 + 500);
    stubFetch([new Response(oversized, { status: 200 })]);

    const result = await logsApi.fetchRequestLogText('big');

    expect(result.text.length).toBe(1_500_000);
  });
});

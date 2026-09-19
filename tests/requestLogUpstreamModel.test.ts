import { describe, expect, test } from 'bun:test';
import {
  collectRequestIdHints,
  matchUpstreamModels,
  parseRequestLogDump,
  readProvidedUpstreamModel,
  selectCandidateHintIds,
} from '../src/utils/requestLogUpstreamModel';

const dumpA = `=== REQUEST INFO ===
Version: v8.90.0-dirty
URL: /v1/responses
Method: GET
Timestamp: 2026-09-19T01:25:42.625+08:00

=== API WEBSOCKET TIMELINE ===
Timestamp: 2026-09-19T01:25:51.194+08:00
Event: api.websocket.request
{"type":"response.create","model":"gpt-6-astra","input":[]}

Timestamp: 2026-09-19T01:26:05.324+08:00
Event: api.websocket.response
{"id":"resp_1","object":"response","created_at":1,"status":"completed","model":"gpt-6-astra"}

Timestamp: 2026-09-19T01:26:12.780+08:00
Event: api.websocket.response
{"id":"resp_2","object":"response","created_at":2,"status":"completed","model":"gpt-6-astra"}
`;

const dumpB = `=== REQUEST INFO ===
URL: /v1/responses
Timestamp: 2026-09-19T01:26:14.905+08:00

=== API WEBSOCKET TIMELINE ===
Timestamp: 2026-09-19T01:26:16.534+08:00
Event: api.websocket.request
{"type":"response.create","model":"gpt-6-astra","input":[]}

Timestamp: 2026-09-19T01:26:17.260+08:00
Event: api.websocket.response
{"headers":{"x-codex-safety-buffering-faster-model":"gpt-5.6-luna"},"type":"response.created","response":{"id":"resp_3","object":"response","status":"in_progress","model":"gpt-6-astra"}}
`;

const snapshotDump = `=== REQUEST INFO ===
Timestamp: 2026-09-19T02:00:00.000+08:00

=== RESPONSE ===
{"id":"chatcmpl-1","object":"chat.completion","model":"gpt-4o-2024-08-06","choices":[]}
`;

describe('parseRequestLogDump', () => {
  test('reads upstream response.model from api websocket frames', () => {
    const parsed = parseRequestLogDump(dumpA, '7f72c271');
    expect(parsed.requestedModels).toEqual(['gpt-6-astra']);
    expect(parsed.upstreamEvents.map((event) => event.model)).toEqual([
      'gpt-6-astra',
      'gpt-6-astra',
    ]);
    expect(parsed.startedAt).toBe(Date.parse('2026-09-19T01:25:42.625+08:00'));
  });

  test('ignores Codex faster-model headers and keeps response.model', () => {
    const parsed = parseRequestLogDump(dumpB);
    expect(parsed.upstreamEvents.map((event) => event.model)).toEqual(['gpt-6-astra']);
    expect(parsed.upstreamEvents.some((event) => event.model === 'gpt-5.6-luna')).toBe(false);
  });

  test('falls back to a RESPONSE section chat completion model', () => {
    const parsed = parseRequestLogDump(snapshotDump);
    expect(parsed.upstreamEvents.map((event) => event.model)).toEqual(['gpt-4o-2024-08-06']);
  });

  test('scans a long websocket dump for the response model instead of walking every token frame', () => {
    const parsed = parseRequestLogDump(
      `=== REQUEST INFO ===
Timestamp: 2026-09-19T02:24:48.759+08:00

=== API WEBSOCKET TIMELINE ===
Timestamp: 2026-09-19T02:24:52.278+08:00
Event: api.websocket.request
{"type":"response.create","model":"gpt-6-astra","input":[]}

${'n'.repeat(301_000)}
Timestamp: 2026-09-19T02:27:36.922+08:00
Event: api.websocket.response
{"type":"response.completed","response":{"id":"resp_1","object":"response","status":"completed","max_tool_calls":null,"model":"gpt-6-astra"}}
`
    );
    expect(parsed.requestedModels).toEqual(['gpt-6-astra']);
    expect(parsed.upstreamEvents.map((event) => event.model)).toEqual(['gpt-6-astra']);
    expect(parsed.startedAt).toBe(Date.parse('2026-09-19T02:24:48.759+08:00'));
    expect(parsed.endedAt).toBe(Date.parse('2026-09-19T02:27:36.922+08:00'));
  });

  test('reads Gemini modelVersion from API RESPONSE and keeps it distinct from the requested alias', () => {
    const parsed = parseRequestLogDump(`=== REQUEST INFO ===
URL: /v1/messages?beta=true
Timestamp: 2026-09-19T01:57:49.138+08:00

=== REQUEST BODY ===
{"model":"gemini-3.8-flash-high","messages":[]}

=== API REQUEST 1 ===
{"model":"gemini-3.8-flash-high"}

=== API RESPONSE 1 ===
{"candidates":[{"content":{"parts":[{"text":"ok"}]}}],"modelVersion":"gemini-3.8-flash"}

=== RESPONSE ===
{"model":"gemini-3.8-flash"}
`);
    expect(parsed.requestedModels).toEqual(['gemini-3.8-flash-high']);
    expect(
      parseRequestLogDump(`=== API RESPONSE 1 ===
{"usageMetadata":{"thoughtsTokenCount":1},"modelVersion": "gemini-3.8-flash"}
`).upstreamEvents.map((event) => event.model)
    ).toEqual(['gemini-3.8-flash']);
    expect([...new Set(parsed.upstreamEvents.map((event) => event.model))]).toEqual([
      'gemini-3.8-flash',
    ]);
  });
});

describe('collectRequestIdHints', () => {
  test('keeps hex request ids from app logs and skips dashed placeholders', () => {
    // 显式给出偏移，断言才不依赖运行环境的时区或当前时刻。
    const hints = collectRequestIdHints(
      [
        '[2026-09-19 01:22:12] [--------] [info ] GET "/v0/management/config.yaml"',
        '[2026-09-19 01:26:04] [7f72c271] [info ] session-affinity model=gpt-6-astra',
        '[2026-09-19 01:27:13] [7f72c271] [info ] 200 | GET "/v1/responses"',
      ],
      8 * 60
    );
    expect(hints).toEqual([
      {
        id: '7f72c271',
        firstTs: Date.parse('2026-09-19T01:26:04+08:00'),
        lastTs: Date.parse('2026-09-19T01:27:13+08:00'),
        models: ['gpt-6-astra'],
        apiRequest: true,
        completed: true,
      },
    ]);
  });
});

describe('matchUpstreamModels', () => {
  test('fills a row when its time sits inside one dump', () => {
    const dumps = [parseRequestLogDump(dumpA, 'a'), parseRequestLogDump(dumpB, 'b')];
    const matched = matchUpstreamModels(
      [
        {
          id: 'row-1',
          timestampMs: Date.parse('2026-09-19T01:25:52+08:00'),
          model: 'gpt-6-astra',
        },
      ],
      dumps
    );
    expect(matched['row-1']).toBe('gpt-6-astra');
  });

  test('overlapping websocket dumps pick the latest start that still precedes the row', () => {
    const dumps = [parseRequestLogDump(dumpA, 'a'), parseRequestLogDump(dumpB, 'b')];
    const matched = matchUpstreamModels(
      [
        {
          id: 'early',
          timestampMs: Date.parse('2026-09-19T01:26:04+08:00'),
          model: 'gpt-6-astra',
        },
        {
          id: 'late',
          timestampMs: Date.parse('2026-09-19T01:26:16+08:00'),
          model: 'gpt-6-astra',
        },
      ],
      dumps
    );
    expect(matched.early).toBe('gpt-6-astra');
    expect(matched.late).toBe('gpt-6-astra');
  });

  test('leaves the cell blank when no dump covers the row', () => {
    const matched = matchUpstreamModels(
      [
        {
          id: 'old',
          timestampMs: Date.parse('2026-09-19T01:15:00+08:00'),
          model: 'gpt-6-astra',
        },
      ],
      [parseRequestLogDump(dumpA, 'a')]
    );
    expect(matched.old).toBe('');
  });

  test('leaves the cell blank when the dump has no upstream model', () => {
    const empty = parseRequestLogDump(
      `=== REQUEST INFO ===
Timestamp: 2026-09-19T01:25:42.625+08:00
=== API WEBSOCKET TIMELINE ===
Timestamp: 2026-09-19T01:25:51.194+08:00
Event: api.websocket.request
{"type":"response.create","model":"gpt-6-astra","input":[]}
`
    );
    const matched = matchUpstreamModels(
      [
        {
          id: 'row',
          timestampMs: Date.parse('2026-09-19T01:25:52+08:00'),
          model: 'gpt-6-astra',
        },
      ],
      [empty]
    );
    expect(matched.row).toBe('');
  });
});

describe('readProvidedUpstreamModel', () => {
  test('prefers an explicit upstream field and ignores empty values', () => {
    expect(
      readProvidedUpstreamModel({ model: 'gpt-6-astra', upstream_model: 'gpt-4o-2024-08-06' })
    ).toBe('gpt-4o-2024-08-06');
    expect(readProvidedUpstreamModel({ model: 'gpt-6-astra', responseModel: '  ' })).toBe('');
    expect(readProvidedUpstreamModel({ model: 'gpt-6-astra' })).toBe('');
  });
});

describe('selectCandidateHintIds', () => {
  test('prefers completed dumps with a model over newer in-flight ids', () => {
    const pageTs = Date.parse('2026-09-19T02:04:53+08:00');
    const ids = selectCandidateHintIds(
      [{ id: 'row', timestampMs: pageTs, model: 'gemini-3.8-flash-high' }],
      [
        {
          id: 'inflight',
          firstTs: Date.parse('2026-09-19T02:40:00+08:00'),
          lastTs: Date.parse('2026-09-19T02:40:00+08:00'),
          models: [],
          apiRequest: true,
          completed: false,
        },
        {
          id: 'ready',
          firstTs: Date.parse('2026-09-19T02:04:46+08:00'),
          lastTs: Date.parse('2026-09-19T02:04:53+08:00'),
          models: ['gemini-3.8-flash-high'],
          apiRequest: true,
          completed: true,
        },
      ]
    );
    expect(ids[0]).toBe('ready');
  });

  test('only keeps ids that overlap the visible page', () => {
    const ids = selectCandidateHintIds(
      [{ id: 'row', timestampMs: Date.parse('2026-09-19T01:26:04+08:00'), model: 'gpt-6-astra' }],
      [
        {
          id: 'keep',
          firstTs: Date.parse('2026-09-19T01:26:04+08:00'),
          lastTs: Date.parse('2026-09-19T01:27:13+08:00'),
          models: ['gpt-6-astra'],
          apiRequest: true,
          completed: true,
        },
        {
          id: 'drop',
          firstTs: Date.parse('2026-09-18T10:00:00+08:00'),
          lastTs: Date.parse('2026-09-18T10:01:00+08:00'),
          models: ['gpt-6-astra'],
          apiRequest: true,
          completed: true,
        },
      ]
    );
    expect(ids).toEqual(['keep']);
  });
});

import {
  collectRequestIdHints,
  matchUpstreamModels,
  parseRequestLogDump,
  selectCandidateHintIds,
} from '../src/utils/requestLogUpstreamModel';

type Payload = {
  rows: Array<{ id: string; timestampMs: number; model: string }>;
  lines: string[];
  dumps: Array<{ id: string; text: string }>;
};

const path = process.argv[2];
if (!path) {
  throw new Error('usage: bun scripts/verify-upstream-from-payload.ts <payload.json>');
}

const payload = (await Bun.file(path).json()) as Payload;
const hints = collectRequestIdHints(payload.lines);
const ids = selectCandidateHintIds(payload.rows, hints);
const dumps = payload.dumps.map((dump) => parseRequestLogDump(dump.text, dump.id));
const matched = matchUpstreamModels(payload.rows, dumps, hints);
const filled = payload.rows.filter((row) => matched[row.id]);
const blank = payload.rows.filter((row) => !matched[row.id]);

console.log(
  JSON.stringify(
    {
      hintCount: hints.length,
      candidateIds: ids.slice(0, 12),
      dumpModels: dumps.map((dump) => ({
        id: dump.id,
        requested: dump.requestedModels,
        upstream: [...new Set(dump.upstreamEvents.map((event) => event.model))],
        startedAt: dump.startedAt,
        endedAt: dump.endedAt,
      })),
      filled: filled.map((row) => ({ id: row.id, model: row.model, upstream: matched[row.id] })),
      blank: blank.map((row) => ({ id: row.id, model: row.model, ts: row.timestampMs })),
      filledCount: filled.length,
      blankCount: blank.length,
    },
    null,
    2
  )
);

if (filled.length === 0) {
  throw new Error('upstream match filled 0 rows');
}
const geminiBlank = blank.filter((row) => row.model.includes('gemini'));
if (geminiBlank.length) {
  throw new Error(`gemini rows still blank: ${geminiBlank.map((row) => row.id).join(',')}`);
}

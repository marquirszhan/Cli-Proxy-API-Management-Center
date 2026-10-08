import { describe, expect, test } from 'bun:test';
import { parse as parseYaml } from 'yaml';
import { runVisualConfig } from './helpers/visualConfig';

const SAMPLE_YAML = `config-version: 8
server:
  port: 8317
models:
  local-model: true
oauth:
  auth-load-workers: 8
  delete-unauthorized-auth: true
  providers:
    codex:
      identity-confuse: true
      strip-intermediary-updates: true
observability:
  logs:
    request-log: true
  usage:
    usage-persistence-enabled: true
routing:
  session-affinity: true
  session-affinity-subagents: false
  cooldown:
    save-cooldown-status: true
    transient-error-cooldown-seconds: -1
multimedia:
  video-result-auth-cache-ttl: 3h
plugins:
  enabled: true
  dir: /data/plugins
upstream:
  claude:
    disable-claude-cloak-mode: true
    header-defaults:
      timezone: Asia/Shanghai
  xai:
    inject-x-search: true
  codex:
    disable-codex-cloaking: true
    stream-bootstrap-buffering: true
    stream-bootstrap-timeout: 20s
    orphan-delegation-compatibility: true
    model-level-cooling: true
client:
  codex:
    optimize-multi-agent-v2: true
`;

describe('visual config high/medium fields', () => {
  test('loads v8 keys into the visual form', () => {
    const config = runVisualConfig(SAMPLE_YAML);
    expect(config.visualValues.usagePersistenceEnabled).toBe(true);
    expect(config.visualValues.requestLog).toBe(true);
    expect(config.visualValues.localModel).toBe(true);
    expect(config.visualValues.authLoadWorkers).toBe('8');
    expect(config.visualValues.deleteUnauthorizedAuth).toBe(true);
    expect(config.visualValues.saveCooldownStatus).toBe(true);
    expect(config.visualValues.transientErrorCooldownSeconds).toBe('-1');
    expect(config.visualValues.videoResultAuthCacheTTL).toBe('3h');
    expect(config.visualValues.claudeDisableCloakMode).toBe(true);
    expect(config.visualValues.routingSessionAffinitySubagents).toBe(false);
    expect(config.visualValues.pluginsDir).toBe('/data/plugins');
    expect(config.visualValues.xaiInjectXSearch).toBe(true);
    expect(config.visualValues.claudeHeaderTimezone).toBe('Asia/Shanghai');
    expect(config.visualValues.codexIdentityConfuse).toBe(true);
    expect(config.visualValues.codexStripIntermediaryUpdates).toBe(true);
    expect(config.visualValues.codexDisableCloaking).toBe(true);
    expect(config.visualValues.codexStreamBootstrapBuffering).toBe(true);
    expect(config.visualValues.codexStreamBootstrapTimeout).toBe('20s');
    expect(config.visualValues.codexOptimizeMultiAgentV2).toBe(true);
    expect(config.visualValues.codexOrphanDelegationCompatibility).toBe(true);
    expect(config.visualValues.codexModelLevelCooling).toBe(true);
    expect(config.visualDirty).toBe(false);
  });

  test('writes only the dirty high/medium fields on v8 paths', () => {
    const yaml = 'server:\n  port: 8317\n';
    const config = runVisualConfig(yaml, [
      {
        usagePersistenceEnabled: true,
        requestLog: true,
        routingSessionAffinitySubagents: false,
        claudeDisableCloakMode: true,
        deleteUnauthorizedAuth: true,
        saveCooldownStatus: true,
        transientErrorCooldownSeconds: '-1',
        localModel: true,
        authLoadWorkers: '12',
        pluginsDir: 'custom-plugins',
        xaiInjectXSearch: true,
        claudeHeaderTimezone: 'Asia/Shanghai',
        videoResultAuthCacheTTL: '6h',
        codexIdentityConfuse: true,
        codexOptimizeMultiAgentV2: true,
        codexStreamBootstrapBuffering: true,
        codexStreamBootstrapTimeout: '20s',
        codexModelLevelCooling: true,
      },
    ]);

    expect(parseYaml(config.applyVisualChangesToYaml(yaml))).toEqual({
      server: { port: 8317 },
      observability: {
        logs: { 'request-log': true },
        usage: { 'usage-persistence-enabled': true },
      },
      routing: {
        'session-affinity-subagents': false,
        cooldown: {
          'save-cooldown-status': true,
          'transient-error-cooldown-seconds': -1,
        },
      },
      oauth: {
        'auth-load-workers': 12,
        'delete-unauthorized-auth': true,
        providers: { codex: { 'identity-confuse': true } },
      },
      models: { 'local-model': true },
      plugins: { dir: 'custom-plugins' },
      upstream: {
        claude: {
          'disable-claude-cloak-mode': true,
          'header-defaults': { timezone: 'Asia/Shanghai' },
        },
        xai: { 'inject-x-search': true },
        codex: {
          'stream-bootstrap-buffering': true,
          'stream-bootstrap-timeout': '20s',
          'model-level-cooling': true,
        },
      },
      client: { codex: { 'optimize-multi-agent-v2': true } },
      multimedia: { 'video-result-auth-cache-ttl': '6h' },
    });
  });

  test('unrelated edits do not materialize omitted high/medium keys', () => {
    const yaml = 'server:\n  port: 8317\n';
    const config = runVisualConfig(yaml, [{ debug: true }]);
    expect(parseYaml(config.applyVisualChangesToYaml(yaml))).toEqual({
      server: { port: 8317 },
      observability: { logs: { debug: true } },
    });
  });
});

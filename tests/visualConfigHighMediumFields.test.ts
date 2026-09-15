import { describe, expect, test } from 'bun:test';
import { parse as parseYaml } from 'yaml';
import { runVisualConfig } from './helpers/visualConfig';

const SAMPLE_YAML = `port: 8317
usage-persistence-enabled: true
request-log: true
local-model: true
auth-load-workers: 8
delete-unauthorized-auth: true
save-cooldown-status: true
transient-error-cooldown-seconds: -1
video-result-auth-cache-ttl: 3h
disable-claude-cloak-mode: true
routing:
  session-affinity: true
  session-affinity-subagents: false
plugins:
  enabled: true
  dir: /data/plugins
xai:
  inject-x-search: true
claude-header-defaults:
  timezone: Asia/Shanghai
codex:
  identity-confuse: true
  strip-intermediary-updates: true
  disable-codex-cloaking: true
  stream-bootstrap-buffering: true
  stream-bootstrap-timeout: 20s
  optimize-multi-agent-v2: true
  orphan-delegation-compatibility: true
  model-level-cooling: true
`;

describe('visual config high/medium fields', () => {
  test('loads backend keys into the visual form', () => {
    const config = runVisualConfig(SAMPLE_YAML);
    expect(config.visualValues.usagePersistenceEnabled).toBe(true);
    expect(config.visualValues.requestLog).toBe(true);
    expect(config.visualValues.localModel).toBe(true);
    expect(config.visualValues.authLoadWorkers).toBe('8');
    expect(config.visualValues.deleteUnauthorizedAuth).toBe(true);
    expect(config.visualValues.saveCooldownStatus).toBe(true);
    expect(config.visualValues.transientErrorCooldownSeconds).toBe('-1');
    expect(config.visualValues.videoResultAuthCacheTtl).toBe('3h');
    expect(config.visualValues.disableClaudeCloakMode).toBe(true);
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

  test('writes only the dirty high/medium fields', () => {
    const yaml = 'port: 8317\n';
    const config = runVisualConfig(yaml, [
      {
        usagePersistenceEnabled: true,
        requestLog: true,
        routingSessionAffinitySubagents: false,
        disableClaudeCloakMode: true,
        deleteUnauthorizedAuth: true,
        saveCooldownStatus: true,
        transientErrorCooldownSeconds: '-1',
        localModel: true,
        authLoadWorkers: '12',
        pluginsDir: 'custom-plugins',
        xaiInjectXSearch: true,
        claudeHeaderTimezone: 'Asia/Shanghai',
        videoResultAuthCacheTtl: '6h',
        codexIdentityConfuse: true,
        codexOptimizeMultiAgentV2: true,
        codexStreamBootstrapBuffering: true,
        codexStreamBootstrapTimeout: '20s',
        codexModelLevelCooling: true,
      },
    ]);

    expect(parseYaml(config.applyVisualChangesToYaml(yaml))).toEqual({
      port: 8317,
      'usage-persistence-enabled': true,
      'request-log': true,
      routing: { 'session-affinity-subagents': false },
      'disable-claude-cloak-mode': true,
      'delete-unauthorized-auth': true,
      'save-cooldown-status': true,
      'transient-error-cooldown-seconds': -1,
      'local-model': true,
      'auth-load-workers': 12,
      plugins: { dir: 'custom-plugins' },
      xai: { 'inject-x-search': true },
      'claude-header-defaults': { timezone: 'Asia/Shanghai' },
      'video-result-auth-cache-ttl': '6h',
      codex: {
        'identity-confuse': true,
        'optimize-multi-agent-v2': true,
        'stream-bootstrap-buffering': true,
        'stream-bootstrap-timeout': '20s',
        'model-level-cooling': true,
      },
    });
  });

  test('unrelated edits do not materialize omitted high/medium keys', () => {
    const yaml = 'port: 8317\n';
    const config = runVisualConfig(yaml, [{ debug: true }]);
    expect(parseYaml(config.applyVisualChangesToYaml(yaml))).toEqual({
      port: 8317,
      debug: true,
    });
  });
});

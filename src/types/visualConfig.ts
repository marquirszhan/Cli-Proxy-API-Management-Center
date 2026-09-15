export type PayloadParamValueType = 'string' | 'number' | 'boolean' | 'json';
export type DisableImageGenerationMode = 'false' | 'true' | 'chat' | 'passthrough';
export type RoutingStrategy = 'round-robin' | 'weighted-round-robin' | 'fill-first';
export type PluginStoreAuthType = 'none' | 'bearer' | 'basic' | 'header' | 'github-token';
export type PluginStoreAuthApplyTo = 'registry' | 'metadata' | 'artifact';
export type PayloadParamValidationErrorCode =
  'payload_invalid_number' | 'payload_invalid_boolean' | 'payload_invalid_json';

export type VisualConfigFieldPath =
  | 'port'
  | 'errorLogsMaxFiles'
  | 'logsMaxTotalSizeMb'
  | 'redisUsageQueueRetentionSeconds'
  | 'requestRetry'
  | 'maxRetryCredentials'
  | 'maxRetryInterval'
  | 'authAutoRefreshWorkers'
  | 'authLoadWorkers'
  | 'transientErrorCooldownSeconds'
  | 'streaming.keepaliveSeconds'
  | 'streaming.bootstrapRetries'
  | 'streaming.nonstreamKeepaliveInterval';

export type VisualConfigValidationErrorCode =
  | 'port_range'
  | 'integer'
  | 'non_negative_integer'
  | 'integer_range_1_3600'
  | 'integer_range_1_64';

export type VisualConfigValidationErrors = Partial<
  Record<VisualConfigFieldPath, VisualConfigValidationErrorCode>
>;

export type PayloadParamEntry = {
  id: string;
  path: string;
  valueType: PayloadParamValueType;
  value: string;
};

export type PayloadHeaderEntry = {
  id: string;
  name: string;
  value: string;
};

export type PayloadModelEntry = {
  id: string;
  name: string;
  protocol?: string;
  fromProtocol?: string;
  headers?: PayloadHeaderEntry[];
  match?: PayloadParamEntry[];
  notMatch?: PayloadParamEntry[];
  exist?: string[];
  notExist?: string[];
};

export type PayloadRule = {
  id: string;
  models: PayloadModelEntry[];
  params: PayloadParamEntry[];
};

export type PayloadFilterRule = {
  id: string;
  models: PayloadModelEntry[];
  params: string[];
};

export interface StreamingConfig {
  keepaliveSeconds: string;
  bootstrapRetries: string;
  nonstreamKeepaliveInterval: string;
}

export type PluginStoreAuthRule = {
  id: string;
  match: string;
  applyTo: PluginStoreAuthApplyTo[];
  type: PluginStoreAuthType;
  tokenEnv: string;
  usernameEnv: string;
  passwordEnv: string;
  headerName: string;
  headerValueEnv: string;
  allowInsecure: boolean;
};

export type VisualConfigValues = {
  host: string;
  port: string;
  tlsEnable: boolean;
  tlsCert: string;
  tlsKey: string;
  rmAllowRemote: boolean;
  rmSecretKey: string;
  rmDisableControlPanel: boolean;
  rmDisableAutoUpdatePanel: boolean;
  rmPanelRepo: string;
  authDir: string;
  apiKeysText: string;
  pluginsEnabled: boolean;
  pluginsDir: string;
  pluginStoreSources: string[];
  pluginStoreAuth: PluginStoreAuthRule[];
  debug: boolean;
  commercialMode: boolean;
  loggingToFile: boolean;
  logsMaxTotalSizeMb: string;
  errorLogsMaxFiles: string;
  usageStatisticsEnabled: boolean;
  usagePersistenceEnabled: boolean;
  requestLog: boolean;
  redisUsageQueueRetentionSeconds: string;
  proxyUrl: string;
  forceModelPrefix: boolean;
  passthroughHeaders: boolean;
  requestRetry: string;
  maxRetryCredentials: string;
  maxRetryInterval: string;
  disableCooling: boolean;
  deleteUnauthorizedAuth: boolean;
  saveCooldownStatus: boolean;
  transientErrorCooldownSeconds: string;
  disableImageGeneration: DisableImageGenerationMode;
  gptImage2BaseModel: string;
  authAutoRefreshWorkers: string;
  authLoadWorkers: string;
  localModel: boolean;
  videoResultAuthCacheTtl: string;
  quotaSwitchProject: boolean;
  quotaSwitchPreviewModel: boolean;
  quotaAntigravityCredits: boolean;
  routingStrategy: RoutingStrategy;
  routingSessionAffinity: boolean;
  routingSessionAffinityTTL: string;
  routingSessionAffinitySubagents: boolean;
  wsAuth: boolean;
  antigravitySensitiveWords: string[];
  devinSensitiveWords: string[];
  antigravitySignatureCacheEnabled: boolean;
  antigravitySignatureBypassStrict: boolean;
  claudeHeaderUserAgent: string;
  claudeHeaderPackageVersion: string;
  claudeHeaderRuntimeVersion: string;
  claudeHeaderOs: string;
  claudeHeaderArch: string;
  claudeHeaderTimeout: string;
  claudeHeaderTimezone: string;
  claudeHeaderStabilizeDeviceProfile: boolean;
  disableClaudeCloakMode: boolean;
  xaiInjectXSearch: boolean;
  codexIdentityConfuse: boolean;
  codexStripIntermediaryUpdates: boolean;
  codexDisableCloaking: boolean;
  codexStreamBootstrapBuffering: boolean;
  codexStreamBootstrapTimeout: string;
  codexOptimizeMultiAgentV2: boolean;
  codexOrphanDelegationCompatibility: boolean;
  codexModelLevelCooling: boolean;
  codexHeaderUserAgent: string;
  codexHeaderBetaFeatures: string;
  payloadDefaultRules: PayloadRule[];
  payloadDefaultRawRules: PayloadRule[];
  payloadOverrideRules: PayloadRule[];
  payloadOverrideRawRules: PayloadRule[];
  payloadFilterRules: PayloadFilterRule[];
  streaming: StreamingConfig;
};

export const makeClientId = () => {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};

export const DEFAULT_VISUAL_VALUES: VisualConfigValues = {
  host: '',
  port: '',
  tlsEnable: false,
  tlsCert: '',
  tlsKey: '',
  rmAllowRemote: false,
  rmSecretKey: '',
  rmDisableControlPanel: false,
  rmDisableAutoUpdatePanel: false,
  rmPanelRepo: '',
  authDir: '',
  apiKeysText: '',
  pluginsEnabled: false,
  pluginsDir: '',
  pluginStoreSources: [],
  pluginStoreAuth: [],
  debug: false,
  commercialMode: false,
  loggingToFile: false,
  logsMaxTotalSizeMb: '',
  errorLogsMaxFiles: '',
  usageStatisticsEnabled: false,
  usagePersistenceEnabled: false,
  requestLog: false,
  redisUsageQueueRetentionSeconds: '',
  proxyUrl: '',
  forceModelPrefix: false,
  passthroughHeaders: false,
  requestRetry: '',
  maxRetryCredentials: '',
  maxRetryInterval: '',
  disableCooling: false,
  deleteUnauthorizedAuth: false,
  saveCooldownStatus: false,
  transientErrorCooldownSeconds: '',
  disableImageGeneration: 'false',
  gptImage2BaseModel: '',
  authAutoRefreshWorkers: '',
  authLoadWorkers: '',
  localModel: false,
  videoResultAuthCacheTtl: '',
  quotaSwitchProject: false,
  quotaSwitchPreviewModel: false,
  quotaAntigravityCredits: false,
  routingStrategy: 'round-robin',
  routingSessionAffinity: false,
  routingSessionAffinityTTL: '',
  routingSessionAffinitySubagents: true,
  wsAuth: true,
  antigravitySensitiveWords: [],
  devinSensitiveWords: [],
  antigravitySignatureCacheEnabled: true,
  antigravitySignatureBypassStrict: false,
  claudeHeaderUserAgent: '',
  claudeHeaderPackageVersion: '',
  claudeHeaderRuntimeVersion: '',
  claudeHeaderOs: '',
  claudeHeaderArch: '',
  claudeHeaderTimeout: '',
  claudeHeaderTimezone: '',
  claudeHeaderStabilizeDeviceProfile: false,
  disableClaudeCloakMode: false,
  xaiInjectXSearch: false,
  codexIdentityConfuse: false,
  codexStripIntermediaryUpdates: false,
  codexDisableCloaking: false,
  codexStreamBootstrapBuffering: false,
  codexStreamBootstrapTimeout: '',
  codexOptimizeMultiAgentV2: false,
  codexOrphanDelegationCompatibility: false,
  codexModelLevelCooling: false,
  codexHeaderUserAgent: '',
  codexHeaderBetaFeatures: '',
  payloadDefaultRules: [],
  payloadDefaultRawRules: [],
  payloadOverrideRules: [],
  payloadOverrideRawRules: [],
  payloadFilterRules: [],
  streaming: {
    keepaliveSeconds: '',
    bootstrapRetries: '',
    nonstreamKeepaliveInterval: '',
  },
};

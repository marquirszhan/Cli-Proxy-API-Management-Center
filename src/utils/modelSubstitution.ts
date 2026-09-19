/**
 * 上游模型替换检测。
 *
 * 判定规则逐条对齐后端 CLIProxyAPI 的
 * `internal/runtime/executor/helps/response_model.go` 中的 `IsModelSubstituted`：
 * 后端在发布 usage 记录时用同一套规则决定要不要打出
 * `upstream served model %q for requested model %q` 这条 warn 日志。
 *
 * 之所以复刻而不是做朴素字符串比较：后端会把日期别名、provider 前缀、
 * `-latest` 后缀和 thinking 括号后缀都视作同一个模型。直接比字符串会把
 * `claude-sonnet-4-5` 与 `claude-sonnet-4-5-20250929` 误报成替换。
 *
 * 该文件只做纯判定，不涉及取值来源。
 */

/** 与后端 `thinking.ParseSuffix` 一致：只识别 `model(value)` 这种括号后缀。 */
const stripThinkingSuffix = (model: string): string => {
  const lastOpen = model.lastIndexOf('(');
  if (lastOpen === -1) return model;
  if (!model.endsWith(')')) return model;
  return model.slice(0, lastOpen);
};

/** 与后端 `normalizeModelName` 一致：trim -> 小写 -> 去括号后缀 -> 再 trim。 */
export const normalizeModelName = (model: string): string =>
  stripThinkingSuffix(model.trim().toLowerCase()).trim();

/** 与后端 `stripModelProviderPrefix` 一致：取最后一个 `/` 之后的部分，结尾斜杠不算。 */
const stripModelProviderPrefix = (model: string): string => {
  const idx = model.lastIndexOf('/');
  if (idx >= 0 && idx < model.length - 1) return model.slice(idx + 1);
  return model;
};

/** 与后端 `isModelDigits` 一致：非空且全为 ASCII 数字。 */
const isModelDigits = (value: string): boolean => {
  if (value === '') return false;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 48 || code > 57) return false;
  }
  return true;
};

/** 与后端 `isModelDateSuffix` 一致：`YYYY-MM-DD` 或 `YYYYMMDD`。 */
const isModelDateSuffix = (suffix: string): boolean => {
  if (suffix.length === 'YYYY-MM-DD'.length) {
    if (suffix[4] !== '-' || suffix[7] !== '-') return false;
    return (
      isModelDigits(suffix.slice(0, 4)) &&
      isModelDigits(suffix.slice(5, 7)) &&
      isModelDigits(suffix.slice(8))
    );
  }
  if (suffix.length === 'YYYYMMDD'.length) return isModelDigits(suffix);
  return false;
};

/** 与后端 `isModelNumericVersionSuffix` 一致：恰好三位数字。 */
const isModelNumericVersionSuffix = (suffix: string): boolean =>
  suffix.length === 3 && isModelDigits(suffix);

/** 与后端 `isDatedModelAlias` 一致：dated 是 base 加上日期或三位版本号后缀。 */
const isDatedModelAlias = (base: string, dated: string): boolean => {
  const prefix = `${base}-`;
  if (!dated.startsWith(prefix)) return false;
  const suffix = dated.slice(prefix.length);
  return isModelDateSuffix(suffix) || isModelNumericVersionSuffix(suffix);
};

/**
 * 与后端 `IsModelSubstituted` 一致：判断上游返回的模型是否不是请求的那个。
 *
 * 任一侧为空都返回 false —— 后端把"没拿到模型名"当作无从判断，不是替换。
 */
export const isModelSubstituted = (requested: string, served: string): boolean => {
  const servedModel = normalizeModelName(served);
  if (servedModel === '') return false;
  const requestedModel = normalizeModelName(requested);
  if (requestedModel === '') return false;
  if (requestedModel === servedModel) return false;

  if (isDatedModelAlias(requestedModel, servedModel)) return false;
  if (isDatedModelAlias(servedModel, requestedModel)) return false;

  const cleanReq = stripModelProviderPrefix(requestedModel);
  const cleanSrv = stripModelProviderPrefix(servedModel);
  if (cleanReq === cleanSrv) return false;
  if (isDatedModelAlias(cleanReq, cleanSrv)) return false;
  if (isDatedModelAlias(cleanSrv, cleanReq)) return false;

  const reqNoLatest = cleanReq.endsWith('-latest')
    ? cleanReq.slice(0, -'-latest'.length)
    : cleanReq;
  const srvNoLatest = cleanSrv.endsWith('-latest')
    ? cleanSrv.slice(0, -'-latest'.length)
    : cleanSrv;
  if (reqNoLatest === srvNoLatest) return false;
  if (isDatedModelAlias(reqNoLatest, srvNoLatest)) return false;
  if (isDatedModelAlias(srvNoLatest, reqNoLatest)) return false;

  return true;
};

/** 请求日志里一行的上游一致性状态。 */
export type ModelConsistency = 'match' | 'substituted' | 'unknown';

/**
 * 判定一行日志的上游一致性。
 *
 * 拿不到上游返回的模型名时是 `unknown` 而不是 `match`：那代表没有证据，
 * 不代表上游给对了。请求模型为空同理。
 */
export const detectModelConsistency = (requested: string, served: string): ModelConsistency => {
  if (normalizeModelName(served) === '' || normalizeModelName(requested) === '') return 'unknown';
  return isModelSubstituted(requested, served) ? 'substituted' : 'match';
};

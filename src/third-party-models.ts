export type ThirdPartyModel = {
  id: string;
  display_name: string;
  reasoning_effort: string;
  context_window: number;
};

export type DiscoveredModel = Pick<ThirdPartyModel, "id" | "display_name">;

export function newThirdPartyModel(id: string, displayName = id): ThirdPartyModel {
  return { id: id.trim(), display_name: displayName.trim(), reasoning_effort: "none", context_window: 32768 };
}

export function normalizeThirdPartyBaseUrl(value: string): string {
  const input = value.trim();
  if (!input) throw new Error("请填写第三方 API 的 openai_base_url。");
  let url: URL;
  try { url = new URL(input.includes("://") ? input : `http://${input}`); }
  catch { throw new Error("接口地址格式不正确。"); }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) {
    throw new Error("请使用不含账号、查询参数或片段的 HTTP/HTTPS 接口地址。");
  }
  url.pathname = url.pathname.replace(/\/+$/, "") || "/v1";
  return url.toString().replace(/\/+$/, "");
}

export function validateThirdPartyModels(models: ThirdPartyModel[], defaultModel: string): void {
  if (models.length < 1 || models.length > 100) throw new Error("请选择 1 至 100 个第三方模型。");
  const ids = new Set<string>();
  for (const model of models) {
    if (!model.id || model.id !== model.id.trim() || model.id.length > 256 || /[\x00-\x1f\x7f]/.test(model.id) || ids.has(model.id)) {
      throw new Error("模型名称不能为空、重复或包含控制字符。");
    }
    ids.add(model.id);
    if (!model.display_name.trim() || model.display_name.length > 256) throw new Error("请填写有效的模型显示名称。");
    if (!["none", "minimal", "low", "medium", "high", "xhigh"].includes(model.reasoning_effort)) throw new Error("推理设置不正确。");
    if (!Number.isInteger(model.context_window) || model.context_window < 4096 || model.context_window > 2000000) {
      throw new Error("上下文预算应为 4096 至 2000000 之间的整数。");
    }
  }
  if (!ids.has(defaultModel)) throw new Error("默认模型必须在所选模型列表中。");
}

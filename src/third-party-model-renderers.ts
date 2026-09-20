import { escapeHtml } from "./html-utils";
import type { EditorState } from "./profile-editor-state";

export function renderThirdPartyModels(editor: EditorState, disabled: string): string {
  const models = editor.thirdParty.models ?? [];
  const discovered = editor.discoveredModels ?? [];
  const loading = Boolean(editor.modelsLoading);
  return `<div class="third-party-models full-width" data-role="third-party-models">
    <div class="third-party-model-toolbar">
      <button type="button" class="button button-secondary" data-action="discover-third-party-models" ${disabled || loading ? "disabled" : ""}>${loading ? "正在获取…" : "获取模型列表"}</button>
      <span class="field-hint">列表只说明接口提供此名称；保存后可用测速检查响应。</span>
    </div>
    <p class="field-hint" role="status">${escapeHtml(editor.modelDiscoveryMessage ?? "也可以手动填写完整模型名称。")}</p>
    ${discovered.length ? `<label class="field"><span>筛选模型</span><input id="third-party-model-search" type="search" placeholder="输入 Grok、Gemini 或模型名称" value="${escapeHtml(editor.modelSearch ?? "")}" ${disabled}/></label>
    <div class="third-party-model-choices">${discovered.map((model) => `<label class="third-party-model-choice" data-model-search="${escapeHtml(`${model.id} ${model.display_name}`.toLowerCase())}" ${`${model.id} ${model.display_name}`.toLowerCase().includes((editor.modelSearch ?? "").toLowerCase()) ? "" : "hidden"}>
      <input type="checkbox" data-model-choice="${escapeHtml(model.id)}" ${models.some((m) => m.id === model.id) ? "checked" : ""} ${disabled}/>
      <span>${escapeHtml(model.display_name)}<small>${escapeHtml(model.id)}</small></span>
    </label>`).join("")}</div>` : ""}
    <div class="third-party-model-toolbar">
      <input id="third-party-manual-model" aria-label="手动模型名称" type="text" placeholder="例如 gemini-3.8-flash-high" value="${escapeHtml(editor.manualModelId ?? "")}" ${disabled}/>
      <button type="button" class="button button-secondary" data-action="add-third-party-model" ${disabled}>添加模型</button>
    </div>
    <label class="field"><span>默认模型</span><select id="third-party-model" ${disabled}>
      <option value="" ${editor.thirdParty.model ? "" : "selected"}>请选择默认模型</option>
      ${models.map((m) => `<option value="${escapeHtml(m.id)}" ${editor.thirdParty.model === m.id ? "selected" : ""}>${escapeHtml(m.display_name)}</option>`).join("")}
    </select></label>
    <p class="field-hint">已选 ${models.length} 个。上下文预算默认 32,768，是本地保守预算，请按接口实际限制调整。只有确认接口支持后再设置推理强度。</p>
    <div class="third-party-selected-models">${models.map((m, i) => `<fieldset class="third-party-model-settings" ${disabled}>
      <legend>${escapeHtml(m.id)}</legend>
      <label class="field"><span>显示名称</span><input data-model-name="${i}" value="${escapeHtml(m.display_name)}" /></label>
      <label class="field"><span>推理设置</span><select data-model-reasoning="${i}">${["none", "minimal", "low", "medium", "high", "xhigh"].map((effort) => `<option value="${effort}" ${m.reasoning_effort === effort ? "selected" : ""}>${effort === "none" ? "不启用额外推理（none）" : effort}</option>`).join("")}</select></label>
      <label class="field"><span>上下文预算（token）</span><input data-model-context="${i}" type="number" min="4096" max="2000000" step="1" value="${m.context_window}" /></label>
      <button type="button" class="button button-ghost" data-action="remove-third-party-model" data-model-id="${escapeHtml(m.id)}">移除</button>
    </fieldset>`).join("")}</div>
  </div>`;
}

import { expect, test } from "vitest";
import { newThirdPartyModel, normalizeThirdPartyBaseUrl, reasoningEffortsForModel, setReasoningEffortEnabled, validateThirdPartyModels } from "../src/third-party-models";
import { standaloneThirdPartyConfigInputFromDraft } from "../src/profile-input-builders";
import { createEditorState, createEditorFromDocument } from "../src/profile-editor-state";
import { renderThirdPartyModels } from "../src/third-party-model-renderers";

test("normalizes a LAN gateway without damaging custom paths", () => {
  expect(normalizeThirdPartyBaseUrl(" 10.12.0.20:8317 ")).toBe("http://10.12.0.20:8317/v1");
  expect(normalizeThirdPartyBaseUrl("https://example.com/custom/v1/")).toBe("https://example.com/custom/v1");
  for (const input of ["", "file:///tmp/config", "http://key@host", "http://host?key=x"]) expect(() => normalizeThirdPartyBaseUrl(input)).toThrow();
});

test("creates a portable two-model config without inventing permissions or capabilities", () => {
  const editor = createEditorState();
  editor.thirdParty = { ...editor.thirdParty, baseUrl: "10.12.0.20:8317", apiKey: "test-only", model: "grok-4.6", models: [newThirdPartyModel("grok-4.6", "Grok 4.6"), newThirdPartyModel("gemini-3.8-flash-high")] };
  const input = standaloneThirdPartyConfigInputFromDraft(editor);
  expect(input.configToml).toContain('openai_base_url = "http://10.12.0.20:8317/v1"');
  expect(JSON.parse(input.configToml.split("\n")[0].slice("# codex-auth-switch-models: ".length)).models).toHaveLength(2);
  expect(input.configToml).toContain('model_reasoning_effort = "none"');
  for (const forbidden of ["danger-full-access", "approval_policy", "1000000", 'web_search = "live"', "xhigh", "test-only"]) expect(input.configToml).not.toContain(forbidden);
  expect(JSON.parse(input.authJson).OPENAI_API_KEY).toBe("test-only");
});

test("rejects missing defaults, duplicate ids and invalid context budgets", () => {
  const model = newThirdPartyModel("test");
  expect(() => validateThirdPartyModels([model], "missing")).toThrow("默认模型");
  expect(() => validateThirdPartyModels([model, model], "test")).toThrow("重复");
  expect(() => validateThirdPartyModels([{ ...model, context_window: NaN }], "test")).toThrow("预算");
});

test("keeps legacy defaults and prevents invalid reasoning menus", () => {
  const model = { ...newThirdPartyModel("grok"), reasoning_effort: "high" };
  expect(reasoningEffortsForModel(model)).toEqual(["high"]);
  for (const levels of [[], ["high", "high"], ["low"], ["high", "made-up"]]) {
    expect(() => validateThirdPartyModels([{ ...model, supported_reasoning_efforts: levels }], "grok")).toThrow("推理档位");
  }
  setReasoningEffortEnabled(model, "low", true);
  setReasoningEffortEnabled(model, "high", false);
  expect(model.reasoning_effort).toBe("low");
  setReasoningEffortEnabled(model, "low", false);
  expect(reasoningEffortsForModel(model)).toEqual(["low"]);
});

test("escapes service-provided names and preserves selected model capabilities when reopening", () => {
  const editor = createEditorState();
  editor.thirdParty.models = [newThirdPartyModel("grok-4.6", '<script>alert("x")</script>')];
  editor.thirdParty.model = "grok-4.6";
  editor.discoveredModels = [{ id: "grok-4.6", display_name: "Grok" }];
  document.body.innerHTML = renderThirdPartyModels(editor, "");
  expect(document.querySelector("script")).toBeNull();
  expect(document.querySelector<HTMLInputElement>("[data-model-choice]")?.checked).toBe(true);
  expect(document.querySelector<HTMLSelectElement>("#third-party-model")?.value).toBe("grok-4.6");
  const reopened = createEditorFromDocument({ id: "test", name: "Test", notes: "", authTypeLabel: "第三方 API", authJson: "{}", configToml: "", createdAt: "now", updatedAt: "now", loadedFromTarget: false, hasTargetChanges: false, thirdPartyDraft: editor.thirdParty });
  expect(reopened.managedThirdParty).toBe(true);
  expect(reopened.thirdParty.models).toEqual(editor.thirdParty.models);
});

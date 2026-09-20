# 独立第三方模型配置

在“新建配置 → 独立第三方 API”填写接口地址和密钥，点击“获取模型列表”，勾选需要的模型并选择默认模型。没有模型列表接口时，可以手动添加完整模型名称。已保存的新配置可再次打开并修改模型设置。

例如服务器 20：地址为 `http://10.12.0.20:8317/v1`，模型名称为 `grok-4.6` 和 `gemini-3.8-flash-high`。直接填写 `10.12.0.20:8317` 也会补全为这个地址；自定义路径会保留。密钥由用户填写，不应写进源码、文档或日志。

接口需要兼容响应接口（Responses API）。获取列表仅确认服务提供模型名称，不证明工具调用、图像、联网搜索或上下文能力。保存后可以测速；投入编码任务前应验证实际工具调用。

## 参数和切换

- 新配置默认关闭额外推理（`none`），上下文预算设为 32,768。这是本地保守预算，不是服务商能力声明。确认接口能力后可逐模型调整。
- 每个模型可勾选多个“可选推理强度”，再从中选择“默认推理强度”。取消默认档位时改用剩余档位中的第一档；至少保留一档。旧配置未提供档位列表时保留原来唯一的推理设置。
- 服务器 20 已验证的配置：`grok-4.6` 使用 `low/medium/high/xhigh`，默认 `xhigh`；`gemini-3.8-flash-high` 使用 `low/medium/high`，默认 `high`。其他网关不可直接套用此能力声明。
- 生成的目录只包含选中的模型；输入能力保守设为文本。不自动宣称图像或原生联网搜索能力。
- 创建独立配置不会自动修改当前登录。点击启用后会切换整套配置；官方账号仍保存在原来的配置档案中。官方和第三方同时出现在一个菜单并分别路由不在本次实现范围。
- 配置切换管理 `model_catalog_json`；切回官方时恢复官方配置自己的目录，通常为未指定目录、由 Codex 自动发现模型。切入或切出新第三方配置时保留当前工具、项目、审批和沙箱设置。
- 保存的密钥会随配置共享，请只共享给预期接收者。用量接口缺失不代表模型不可用。

## 存储和跨机器导入

模型设置存于 `config.toml` 首行的 `# codex-auth-switch-models: {...}` 注释。Codex 忽略该注释；助手读取其中经过校验的模型设置，在本机应用数据目录 `model-catalogs/` 生成 JSON，并写入 `model_catalog_json`。

模型定义的 `reasoning_effort` 是默认档位，`supported_reasoning_efforts` 是完整的可选档位数组；数组不得为空、重复或包含未知值，默认档位必须包含在数组中。共享服务端保留经过校验的档位数组。只带绝对路径的旧配置需要先补入模型定义，单独修改路径不会使文件可迁移。

目录按内容摘要命名，保留旧版本供配置备份恢复。导入、更新和切换会重新生成本机路径。共享端仅保留有效模型元数据，不分发本机绝对路径；客户端和共享服务端都需要包含本次改动，旧服务端会过滤这条注释。旧配置没有元数据时保持原有编辑方式。

## 验证

```sh
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path cli/Cargo.toml
npm --prefix website test
```

可选的真实网关测试会发送少量请求，仅使用临时配置，不切换实际 Codex 登录：

```sh
CODEX_AUTH_SWITCH_TEST_GATEWAY=http://10.12.0.20:8317/v1 \
CODEX_AUTH_SWITCH_TEST_KEY_FILE=/path/to/private-key-file \
cargo test --manifest-path src-tauri/Cargo.toml --test third_party_models_tests \
  live_gateway_models_and_responses -- --ignored --nocapture
```

官方配置字段参考：[配置参考（Configuration Reference）](https://learn.chatgpt.com/docs/config-file/config-reference)。模型目录格式另经本机内置 Codex 后端读取验证；不同版本仍应做兼容测试。

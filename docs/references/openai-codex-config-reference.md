# OpenAI（OpenAI）Codex（Codex）配置参考记录

这个文件用于记录 OpenAI（OpenAI）官方 `config-reference`（Configuration Reference）里和本项目最相关的内容，方便后续开发时快速查阅。

说明：

- 这不是官网全文镜像，而是本地摘要。
- 如果这里的内容与官方文档冲突，以官方文档为准。
- 本记录整理时间：2026-04-27。

## 官方入口

- 配置参考（Configuration Reference）：
  [https://developers.openai.com/codex/config-reference](https://developers.openai.com/codex/config-reference)
- 配置基础（Config Basics）：
  [https://developers.openai.com/codex/config-basic](https://developers.openai.com/codex/config-basic)
- 高级配置（Advanced Config）：
  [https://developers.openai.com/codex/config-advanced](https://developers.openai.com/codex/config-advanced)
- 配置结构定义（JSON Schema）：
  [https://developers.openai.com/codex/config-schema.json](https://developers.openai.com/codex/config-schema.json)

## 核心结论

### `config.toml`

- 用户级配置文件位于 `~/.codex/config.toml`。
- 项目级覆盖可放在 `.codex/config.toml`。
- 只有在项目被信任时，Codex（Codex）才会加载项目级 `.codex/config.toml`。

### `requirements.toml`

- `requirements.toml` 是管理员强制配置，用来约束用户不能覆盖的安全相关设置。
- `requirements.toml` 里的 `[features]` 使用和 `config.toml` 相同的规范键名（canonical keys）。
- 没有写出的 feature 不会被强制约束。

### 快速模式（Fast mode）

- `features.fast_mode` 的类型是布尔值（boolean）。
- 这个开关控制快速模式（Fast mode）选择，以及 `service_tier = "fast"` 路径是否可用。
- 官方说明里它是稳定特性，并且默认开启。
- 如果需要默认关闭，显式写法是：

```toml
[features]
fast_mode = false
```

### 其他后续常用点

- 编辑 `config.toml` 时，可以使用官方 `config-schema.json` 做自动补全和校验。
- 官方文档提示旧键 `experimental_instructions_file` 已废弃，应改用 `model_instructions_file`。
- 如果后续项目支持 `requirements.toml`，feature 开关名称应直接复用 `config.toml` 的同名键。

## 对本项目的意义

本项目管理的是 Codex（Codex）配置快照，因此下面这些规则后续都应保持一致：

- profile 里的 `config.toml` 要按官方键名保存，不要自造别名。
- 新增 feature 开关时，优先放到 `[features]` 表下。
- 如果界面里暴露快速模式（Fast mode）或其他 feature 开关，默认值要和实际导出的 `config.toml` 保持一致。
- 如果未来支持管理员限制，`requirements.toml` 和 `config.toml` 的 feature 键需要共用同一套映射。

## 推荐用法

后续遇到下面几类工作时，优先先看这份记录，再回官方文档确认细节：

- 新增或修改 `config.toml` 字段
- 新增 feature 开关
- 处理项目级 `.codex/config.toml`
- 增加 `requirements.toml` 支持
- 处理配置兼容或废弃键迁移

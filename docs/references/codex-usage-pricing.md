# Codex Token 费用表维护说明

Codex 会话费用统计使用内置、带版本号的价格表：

- 数据文件：`src-tauri/resources/codex-model-pricing.json`
- 计算实现：`src-tauri/src/core/usage_stats.rs`
- 金额精度：使用十进制定点数（Decimal），最终保留 6 位小数

## 当前计费维度

每条请求分别计算并保存：

1. 新输入（input）
2. 缓存读取（cached input / cache read）
3. 缓存写入（cache creation / cache write）
4. 输出（output）

对价格表中声明了长上下文规则的模型，应用还会记录基础成本、提示词输入总量、阈值以及输入/输出倍率。当前 GPT-5.6 全家族、GPT-5.5 和 GPT-5.4 在提示词输入超过 272,000 tokens 时，对整条请求应用输入 2 倍、输出 1.5 倍的价格；刚好等于阈值时不触发。

如果日志中的模型不在价格表中，请求会标记为“未定价（unpriced）”。这类请求仍计入 token 和请求数，但不会被误报为零成本。

## 更新步骤

1. 以 [OpenAI 模型比较页](https://developers.openai.com/api/docs/models/compare)及对应模型详情页为准，核对每百万 token 的输入、缓存输入、缓存写入和输出价格。
2. 更新 `codex-model-pricing.json` 中的模型记录；模型改名时优先补充 `aliases`，避免历史日志失去价格映射。
3. 每次调整任何价格或别名，都递增顶层 `version` 并更新 `updatedAt`。应用下次刷新统计时会自动重新计算旧记录。
4. 补充或调整 `usage_stats.rs` 与 `codex_usage_stats_tests.rs` 的价格回归用例。
5. 运行：

   ```bash
   cd src-tauri
   cargo test --test codex_usage_stats_tests
   cargo test usage_stats::tests
   ```

## 边界

- 这里展示的是按公开 API 单价得到的估算值，不等同于账单。
- 价格表没有匹配到模型时，必须保留“未定价”状态，不能用 `$0` 代替。
- 长上下文阈值以新输入、缓存读取和缓存写入三部分之和判断；触发后，三类输入成本统一使用输入倍率，输出成本使用输出倍率。

## 远程更新策略

客户端不静默下载并覆盖价格表。建议通过持续集成（CI）定期检查官方文档或可信价格源，发现差异后生成待审核变更；只有经过人工确认、递增版本并通过回归测试的价格表才随应用发布。这样可以避免远程格式变化或错误价格直接重算用户历史数据。

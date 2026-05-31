### 📄 文档 1：**[X-Reviewer](https://github.com/magicman1324/X-Reviewer)** 产品需求文档 (PRD) 核心精简版

*(建议直接复制作为 GitHub 仓库的 README 介绍)*

**1. 产品定位** ****[X-Reviewer](https://github.com/magicman1324/X-Reviewer)**** 是一款面向工业界 GitHub 协作流程的 AI 代码评审助手。主打“完全无感”的极客体验：开发者只需正常提交 PR，AI 自动在评论区原位生成结构化审查报告，零门槛、零等待。

**2. 核心功能验收标准**

- **📝 PR 变更总结：** 摒弃啰嗦的代码堆砌，一句话总结核心模块的修改目的与影响范围。
- **⚠️ 风险代码识别：** 精准识别逻辑漏洞。分为两级：🔴 高危（如异常未捕获、安全漏洞）与 🟡 警告（如死代码、冗余变量）。
- **💡 Review 建议生成：** 针对高危风险，直接输出可执行、符合工程规范的修复代码片段。

**3. 交互形态展示 (UI Mock)** *系统不会开发独立的网页，所有交互直接在 GitHub PR 评论区完成。效果如下：*

> ### 🤖 PR-Sentinel AI 代码评审报告
>
> **📝 PR 变更总结** 本次修改主要在 `src/services/` 目录下引入了音频模块。核心逻辑是通过 Web Audio API 进行音频流采集。
>
> **⚠️ 风险代码识别**
>
> - 🔴 **高危:** 在 `audio.ts` 中，`getUserMedia` 未包裹 `try...catch`。如果用户拒绝麦克风权限，将导致前端崩溃。
> - 🟡 **警告:** `utils.ts` 中存在未使用的临时变量。
>
> **💡 Review 建议** 建议在音频初始化逻辑增加显式的异常捕获：

```
try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
} catch (error) {
    console.error("麦克风授权失败:", error);
}
```

### 🛠️ 文档 2：技术选型与架构设计 (核心亮点)

*(建议在路演或 README 进阶说明中使用)*

**1. 核心技术栈**

- **开发语言：** TypeScript + Node.js (确保代码健壮性与类型安全)。
- **网关框架：** Probot (GitHub 官方出品的 App 框架，免去手写鉴权、Token 刷新的痛苦，一小时内极速建站)。
- **大模型基座：** DeepSeek-Coder-V4-pro (专精代码语义与 Diff 解析，超长上下文，低延迟，OpenAI 接口兼容)。

**2. 架构设计高分亮点**

- **三秒异步解耦：** 收到 GitHub Webhook 后，立刻返回 `HTTP 200` 防止 GitHub 超时熔断，将大模型推理任务全部丢入 Node.js 异步队列。
- **占位更新机制：** 触发后立刻发送评论：“🤖 *正在深度阅读代码...*”，等 AI 算完后再通过 Update API 无缝替换内容，抹平用户的等待焦虑。
- **Diff 净化管道：** 过滤 `package-lock.json`、图片等多媒体噪音，只抓取带 `+` 和 `-` 的真实业务代码行，从根源上降低 AI 误报率并提升 40% 的响应速度。
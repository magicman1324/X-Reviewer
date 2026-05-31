# X-Reviewer Demo 录制方案

---

## 一、录制前准备清单

### 环境检查

| 检查项 | 命令/操作 | 状态 |
|--------|----------|------|
| Node.js ≥ 22 | `node -v` | ☐ |
| 依赖已安装 | `npm install` | ☐ |
| .env 配置正确 | `cat .env` 确认 API Key | ☐ |
| 服务可启动 | `npm run dev` 一次热身 | ☐ |
| DeepSeek API 可达 | 提前触发一次 Review 预热 | ☐ |
| ngrok 隧道 | `ngrok http 3000` (如需外网) | ☐ |
| GitHub App 已安装 | 目标仓库 Settings → GitHub Apps | ☐ |

### 桌面布局

```
┌─────────────────────┬──────────────┐
│                     │              │
│   VS Code           │  终端        │
│   (user-handler.ts  │  (npm run    │
│    源码展示)         │   dev 日志)  │
│                     │              │
├─────────────────────┴──────────────┤
│                                    │
│   Chrome 浏览器                    │
│   GitHub PR 页面 + 审查报告         │
│                                    │
└────────────────────────────────────┘
```

### 演示仓库

- 仓库：`magicman1324/X-Reviewer`
- 测试文件：`src/services/user-handler.ts`（含 5 个故意漏洞）
- 测试文件：`scripts/test-user-handler.ts`（15 个单元测试）

---

## 二、演示 PR 内容

### PR 标题

```
feat(user): add user management service with password hashing and form processing
```

### PR 描述

```markdown
## Summary

Add a new user management module that provides:
- User lookup by username and ID
- User creation with role assignment
- Password hashing utility
- SQL query builder for user search
- Form input processing
- File deletion helper

## Changes

- `src/services/user-handler.ts` — 65 lines, new module
- `scripts/test-user-handler.ts` — 78 lines, unit tests

## Testing

All 15 unit tests pass locally.
```

### 核心代码（user-handler.ts 漏洞点）

```typescript
// 漏洞1: SQL 注入 — 字符串拼接构建SQL (L47-49)
export function buildUserQuery(username: string): string {
  const sql = "SELECT * FROM users WHERE username = '" + username + "'";
  return sql;
}

// 漏洞2: XSS — 原始输入直接拼入HTML (L52-56)
export function processFormInput(rawInput: string): string {
  const html = '<div class="user-content">' + rawInput + '</div>';
  return html;
}

// 漏洞3: 命令注入 — 用户输入拼入shell命令 (L59-63)
export function deleteUserFile(filename: string): string {
  const cmd = `rm -f /tmp/user-files/${filename}`;
  return cmd;
}

// 漏洞4: 弱加密 — SHA1 用于密码哈希 (L39-43)
export function hashPassword(plaintext: string): string {
  const hash = createHash('sha1');
  hash.update(plaintext);
  return hash.digest('hex');
}

// 漏洞5: 竞态条件 — users.length + 1 作为ID (L29-30)
const newUser: User = {
  id: users.length + 1,
  // ...
};
```

---

## 三、逐字稿

### Part 1 — 项目简介 (0:00-0:30)

> 大家好，我带来的是 **X-Reviewer**，一个基于 AI 的 GitHub 代码评审助手。
>
> 它的核心价值很简单：**开发者正常提 PR，AI 自动在评论区生成结构化的审查报告**——不需要安装任何东西，不需要额外操作，零配置、零感知。
>
> 我选择这个方向，是因为在调研中发现了一个关键痛点：**市面上很多 AI 审查工具误报太多，开发者每周要花 5 小时以上处理误报，甚至直接忽略 40% 以上的警报**。
>
> 所以在 X-Reviewer 里，我专门设计了 **SignalBooster 信号增强器**来解决警报疲劳问题。这个后面会展示。

---

### Part 2 — 现场演示 (0:30-2:30)

#### 2.1 展示测试代码 (0:30-1:00)

> 我先给大家看一下测试用的代码。这个 `user-handler.ts` 是我故意写的，里面藏了 5 个漏洞——
>
> 第一个是 **SQL 注入**，用字符串拼接构建查询语句。
>
> 第二个是 **XSS 跨站脚本**，用户输入直接拼进 HTML。
>
> 第三个是**命令注入**，文件名直接拼进 shell 命令。
>
> 还有 **SHA1 弱加密**做密码哈希，以及用 `users.length + 1` 生成 ID 的**竞态条件**问题。
>
> 这些都是真实开发中常见的安全隐患。

#### 2.2 创建 PR (1:00-1:15)

> 现在我把这个代码推上去，创建一个 PR。
>
> —— *操作：git push，在 GitHub 上创建 Pull Request* ——
>
> 好，PR 已经创建了。注意，我没有任何额外操作，就是正常提了一个 PR。

#### 2.3 Webhook 触发 + 占位评论 (1:15-1:45)

> 大家看左下角的终端——这是 X-Reviewer 的服务器日志。
>
> —— *指终端日志* ——
>
> 可以看到已经收到了 `pull_request.opened` 事件。Webhook 在**毫秒级**就返回了 200，不会触发 GitHub 的超时重试。
>
> 同时，评论区已经出现了一条占位评论：*"AI is reasoning about every + / − line... stand by."*
>
> 这是为了给用户即时反馈。但其实背后 AI 已经开始工作了——只是 DeepSeek 推理需要 30 到 60 秒。

#### 2.4 审查报告展示 (1:45-2:30)

> 好，报告已经生成了。大家看，原来的占位评论被**无缝替换**成了完整的审查报告。
>
> —— *滚动展示报告* ——
>
> 最上面是**信号质量徽章**——信噪比 100%，可信度 85%。这意味着这份报告的质量很高，几乎没有噪音。
>
> 下面是 **PR 变更总结**——一句话概括了这次修改的目的。
>
> 然后是**风险代码识别表格**——SQL 注入、XSS、命令注入、SHA1 弱加密、竞态条件，**五个问题全部识别出来了**。每个问题都标了文件路径、行号、严重级别。
>
> 再往下是**修复建议**——不是泛泛的"建议修复"，而是直接给出了可执行的代码。比如 SQL 注入这里建议用参数化查询，XSS 这里建议用 HTML 转义。
>
> 最后是**综合评分**——3/10，很低的分数，因为这个文件确实问题很多。
>
> 底部还有一个折叠区域——**已抑制的噪音警报**。这些是 SignalBooster 认为置信度太低、不值得关注的告警，但保留了透明度。

---

### Part 3 — 特色功能讲解 (2:30-4:00)

#### 3.1 SignalBooster 信号增强器 (2:30-3:15)

> 现在重点介绍一下 SignalBooster，这是我针对「警报疲劳」痛点做的核心创新。
>
> —— *打开 `src/services/signal-booster.ts`* ——
>
> 它有五个核心能力：
>
> **第一，智能去重。** 同样的 SQL 注入模式在 3 个文件里出现，不会报 3 次，而是合并为 1 个告警，标注"also in file B, file C"。
>
> **第二，复合评分。** 每个告警不是只看严重度，而是综合了严重度、AI 置信度、标题特异性三个维度，算出一个 0 到 100 的分数。
>
> **第三，噪音抑制。** 评分低于 25 或者置信度低于 20% 的告警，自动抑制，并给出可读的原因——比如"置信度 15% + 标题模糊 + 已标记为疑似误报"。
>
> **第四，风险聚类。** 相关告警归为一组，比如"SQL 注入 × 4 个文件"，让你一眼看清问题的分布。
>
> **第五，信号质量。** 每次审查都有信噪比和可信度指标，可以量化评估这份报告值不值得信任。
>
> —— *切换到 `scripts/test-signal-booster.ts`* ——
>
> SignalBooster 有 **21 个单元测试**，覆盖了所有场景，全部通过。

#### 3.2 安全规则库 + FP 控制 (3:15-3:40)

> —— *打开 `src/security/rules-engine.ts`* ——
>
> X-Reviewer 内置了 **14 条安全规则**——SQL 注入、XSS、命令注入、SSRF、路径遍历、弱加密、硬编码密钥等等，每条规则都有 CWE/OWASP 编号。
>
> 规则引擎在 AI 分析之后运行，对 AI 的结果做**交叉校验**——如果规则引擎命中了同样的位置，就给 AI 的告警加分；如果 AI 漏掉了规则引擎发现的问题，就补充进去。
>
> —— *打开 `src/services/review-post-processor.ts`* ——
>
> 另外还有**误报后处理器**——5 条启发式规则判断一个告警是不是误报，比如测试文件里的问题通常是故意写的，配置文件里的 Warning 通常没那么严重。

#### 3.3 异步解耦 + 占位更新 (3:40-4:00)

> —— *快速指一下 `src/index.ts` 和 `src/queue/review-queue.ts`* ——
>
> GitHub Webhook 要求 **10 秒内返回响应**，但 AI 推理通常需要 30 到 60 秒。所以 X-Reviewer 用了异步解耦——
>
> Webhook 到达 → 参数校验 → 立即返回 200 → AI 推理丢入队列异步执行。
>
> 同时，评论区先发一条占位评论让用户知道 AI 在工作，等推理完成后用 GitHub API 无缝替换成完整报告。
>
> 如果 60 秒还没完成，还会发一条延迟提醒："Still working... 已经分析 60 秒了"。

---

### Part 4 — 架构与技术选型 (4:00-4:30)

> 最后快速讲一下架构。
>
> —— *打开 技术方案.md 或画架构图* ——
>
> 整条管线是：**GitHub Webhook → Probot 网关 → 异步队列 → Diff 净化 → 上下文构建 → Prompt 拼装 → DeepSeek v4-pro 推理 → 输出解析 → PostProcessor 误报控制 → SignalBooster 信号增强 → 评论发布**。
>
> 选 DeepSeek v4-pro 有三个原因：
> 1. **代码审查精度顶级**，实测对安全漏洞的识别率很高
> 2. **OpenAI 接口兼容**，未来可以无缝切换到 Claude 或 GPT
> 3. **成本极低**，每次 PR 审查约 $0.02
>
> 上下文获取采用四级级联：L0 PR 元数据 → L1 关联 Issue → L2 完整文件源码 → L3 项目技术栈检测。

---

### Part 5 — 总结 (4:30-5:00)

> 总结一下，X-Reviewer 解决了三个核心问题：
>
> **第一，效率。** 开发者提 PR 后自动获得 AI 审查，零额外操作，30-60 秒出结果。
>
> **第二，质量。** SignalBooster 大幅降低误报率，让开发者不再被海量低质量告警淹没。
>
> **第三，安全。** 14 条安全规则 + 交叉校验机制，确保高危问题不被遗漏。
>
> 未来计划支持 GitLab MR、Claude 仲裁模型、以及基于 Embedding 的相似问题检索。
>
> 谢谢大家。

---

## 四、备用：快速应急方案

如果 DeepSeek API 在录制时超时或报错，可以用**预录的审查报告截图**替代：

1. 提前跑一次完整的 PR Review
2. 截取完整的审查报告评论
3. 录制时如果 API 挂了，直接切到截图，说"这是之前跑出来的结果"

---

## 五、评分标准对照

| 评审维度 | X-Reviewer 表现 | 演示位置 |
|---------|----------------|---------|
| PR 变更总结 | AI 自动生成一句话总结 | Part 2.4 |
| 风险代码识别 | 5/5 漏洞全部检出 | Part 2.4 |
| Review 建议生成 | 可执行修复代码 + 语法高亮 | Part 2.4 |
| 分析准确性 | SignalBooster 去重 + 置信度评分 | Part 3.1 |
| 上下文理解 | L0-L3 四级级联获取 | Part 4 |
| 误报控制 | PostProcessor 5 条启发式规则 | Part 3.2 |
| 漏报控制 | 14 条安全规则 + 交叉校验 | Part 3.2 |
| 响应速度 | 异步解耦 + 占位更新 → 秒级反馈 | Part 3.3 |
| 使用体验 | GitHub App 零配置安装 | Part 2.2 |
| 模型选择 | DeepSeek v4-pro 成本/精度分析 | Part 4 |
| 扩展方向 | 多平台、仲裁模型、知识图谱 | Part 5 |

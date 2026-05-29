const XLSX = require('xlsx');
const path = require('path');

const schedule = [
  // Day 1 Morning — Project Scaffolding
  {
    day: 'Day1 上午\n(5/29)',
    pr: 'PR #1',
    title: '初始化 Probot + TypeScript 项目脚手架',
    module: '项目基础设施',
    description: '初始化 Probot 项目，tsconfig.json 配置、ESLint + Prettier 规则、package.json scripts、.env.example 模板、Dockerfile 骨架',
    deliverables: '可运行的 Probot 空 App，能接收 Webhook 并返回 200',
    acceptanceCriteria: 'npm run dev 启动成功；GitHub Webhook 接收正常',
    estimatedHours: '1.5h',
  },
  {
    day: 'Day1 上午\n(5/29)',
    pr: 'PR #2',
    title: 'GitHub App 注册与 Webhook 签名校验',
    module: '项目基础设施',
    description: '注册 GitHub App，配置 Webhook secret，实现签名校验中间件、Payload 反序列化、权限声明（Issues R/W + PR R/W + Metadata R）',
    deliverables: 'GitHub App ID + Private Key 配置就绪；Webhook 签名校验通过',
    acceptanceCriteria: 'GitHub 发送测试 Webhook，服务端校验签名通过；非法签名返回 401',
    estimatedHours: '1h',
  },
  {
    day: 'Day1 上午\n(5/29)',
    pr: 'PR #3',
    title: '定义核心 TypeScript 类型与接口',
    module: '项目基础设施',
    description: '定义 ReviewRequest、ReviewReport、RiskItem、ChangedFile、FilteredDiff、QueueJob、AIProvider 接口等全局类型，枚举 RiskLevel、TriggerSource',
    deliverables: 'src/types/index.ts 完整类型文件',
    acceptanceCriteria: 'TypeScript 编译零错误；所有接口 export 可被其他模块引用',
    estimatedHours: '0.5h',
  },
  // Day 1 Afternoon — Core Services
  {
    day: 'Day1 下午\n(5/29)',
    pr: 'PR #4',
    title: '实现 Diff 净化管道',
    module: 'Diff 处理',
    description: '实现文件过滤（package-lock.json/yarn.lock/二进制/图片丢弃）、变更类型分类（逻辑变更 vs 纯 import vs 纯格式）、提取 +/- 行并保留前后 3 行上下文、大文件按优先级截断',
    deliverables: 'src/services/diff-pipeline.ts',
    acceptanceCriteria: 'package-lock.json 被正确丢弃；图片文件被过滤；纯格式化变更被标记；输出仅含业务代码 +/- 行',
    estimatedHours: '2h',
  },
  {
    day: 'Day1 下午\n(5/29)',
    pr: 'PR #5',
    title: '封装 GitHub API 客户端（Octokit）',
    module: 'GitHub 集成',
    description: '封装 Octokit 实例创建、Token 自动刷新、条件请求缓存、重试策略、PR Diff 获取、文件完整源码获取、Comment CRUD 操作',
    deliverables: 'src/utils/github-client.ts',
    acceptanceCriteria: 'getPRDiff() 返回正确 diff；getFileContent() 获取指定 ref 文件内容；API 限流时自动重试',
    estimatedHours: '1.5h',
  },
  {
    day: 'Day1 下午\n(5/29)',
    pr: 'PR #6',
    title: '实现上下文构建器（L0-L3 级联获取）',
    module: '上下文引擎',
    description: 'L0: PR Title+Body+Diff；L1: 关联 Issue 提取（解析 fixes/closes #123）；L2: 修改文件完整源码；L3: 项目技术栈识别（package.json/go.mod 解析）；按 Token 预算 64K 截断',
    deliverables: 'src/services/context-builder.ts',
    acceptanceCriteria: '正确提取关联 Issue 内容；正确识别项目语言和框架；超过 64K 时按优先级截断',
    estimatedHours: '2h',
  },
  // Day 2 Morning — AI Engine
  {
    day: 'Day2 上午\n(5/30)',
    pr: 'PR #7',
    title: '实现 Prompt 模板管理',
    module: 'AI 引擎',
    description: 'System Prompt 模板（审查原则+风险分级+输出约束）、User Prompt 模板（PR 信息注入）、JSON Schema 输出约束、支持 .x-reviewer.yml 自定义规则注入',
    deliverables: 'src/services/prompt-builder.ts + src/templates/',
    acceptanceCriteria: 'Prompt 生成包含完整 PR 上下文；JSON Schema 约束正确；自定义规则正确注入',
    estimatedHours: '1.5h',
  },
  {
    day: 'Day2 上午\n(5/30)',
    pr: 'PR #8',
    title: '实现 AI 推理引擎（deepseek-v4-pro）',
    module: 'AI 引擎',
    description: 'deepseek-v4-pro OpenAI 兼容 API 对接、请求构建（含 cache control）、超时控制（30s 无首 Token 则 fallback）、Token 用量统计、响应流式处理',
    deliverables: 'src/services/ai-engine.ts + src/providers/deepseek.ts',
    acceptanceCriteria: 'API 调用成功返回审查结果；超时自动 fallback；Token 用量日志记录正常',
    estimatedHours: '2h',
  },
  {
    day: 'Day2 上午\n(5/30)',
    pr: 'PR #9',
    title: '实现结构化输出解析器',
    module: 'AI 引擎',
    description: 'JSON 解析（主路径）、正则兜底提取（JSON 格式异常时从 Markdown 中提取关键字段）、输出校验（ReviewReport Schema 验证）、降级为纯文本评论（完全解析失败时）',
    deliverables: 'src/services/output-parser.ts',
    acceptanceCriteria: '正常 JSON 输出解析正确；Markdown 包裹的 JSON 也能提取；完全失败时降级为纯文本不报错',
    estimatedHours: '1.5h',
  },
  // Day 2 Afternoon — Queue & Comments
  {
    day: 'Day2 下午\n(5/30)',
    pr: 'PR #10',
    title: '实现异步 Review 任务队列',
    module: '异步队列',
    description: 'BullMQ 队列初始化、Review Job 数据结构定义、Worker 处理逻辑、重试策略（3次指数退避）、去重（(commit_sha, file, line_hash) 组合键）、死信队列',
    deliverables: 'src/queue/review-queue.ts',
    acceptanceCriteria: 'Webhook 收到后立即返回 200；AI 推理异步执行；重试 3 次后进入死信队列；同一 commit 去重',
    estimatedHours: '2h',
  },
  {
    day: 'Day2 下午\n(5/30)',
    pr: 'PR #11',
    title: '实现占位评论与无缝更新机制',
    module: '评论系统',
    description: '占位评论发送（带语气文案+Emoji）、AI 完成后通过 PATCH API 替换评论内容、更新失败重试、超时兜底（60s 未完成则更新占位文案说明延迟）',
    deliverables: 'src/services/comment-manager.ts',
    acceptanceCriteria: 'T+0s 占位评论出现；T+30s 内容自动替换；用户无闪烁跳变感知；超时时有提示',
    estimatedHours: '1.5h',
  },
  {
    day: 'Day2 下午\n(5/30)',
    pr: 'PR #12',
    title: '实现结构化评论 Markdown 渲染',
    module: '评论系统',
    description: 'ReviewReport → GitHub Markdown 渲染（表格化风险列表、代码块修复建议、评分 Badge）、多语言语法高亮、长报告折叠（details/summary 标签）',
    deliverables: 'src/services/report-renderer.ts',
    acceptanceCriteria: '渲染结果符合 PRD UI Mock 样式；代码块语法高亮正确；长报告自动折叠',
    estimatedHours: '1h',
  },
  // Day 3 Morning — Quality & Rules
  {
    day: 'Day3 上午\n(5/31)',
    pr: 'PR #13',
    title: '实现安全规则库与危险模式检测',
    module: '安全审查',
    description: '硬编码正则检测（SQL 拼接、eval() 调用、innerHTML 赋值、硬编码密钥/Token）、敏感路径标记（middleware/auth/db 目录全量审查）、XSS/CSRF 模式匹配',
    deliverables: 'src/rules/security.ts + src/rules/patterns.ts',
    acceptanceCriteria: 'SQL 拼接被检测；eval() 调用被标记高危；硬编码密码/Token 被识别',
    estimatedHours: '2h',
  },
  {
    day: 'Day3 上午\n(5/31)',
    pr: 'PR #14',
    title: '实现误报/漏报控制机制',
    module: '质量控制',
    description: '白名单过滤（ESLint/Prettier 覆盖项直接丢弃）、置信度阈值（<0.7 降级为 info）、变更范围限定（只分析 diff 行）、Redis 去重缓存、多维审查清单注入 Prompt',
    deliverables: 'src/services/quality-controller.ts',
    acceptanceCriteria: '风格类问题被过滤；低置信度 warning 降级；同一行重复审查被去重',
    estimatedHours: '1.5h',
  },
  {
    day: 'Day3 上午\n(5/31)',
    pr: 'PR #15',
    title: '实现斜杠命令支持',
    module: '交互体验',
    description: '/review 手动全量审查、/deep-review 增强模式（完整上下文+仲裁模型）、/re-review 重审最近提交、命令解析与鉴权（仅 PR 参与者可触发）',
    deliverables: 'src/handlers/commands.ts',
    acceptanceCriteria: '/review 触发全量审查；/deep-review 启用 Claude 仲裁；非参与者命令被忽略',
    estimatedHours: '1h',
  },
  // Day 3 Afternoon — Polish & Ship
  {
    day: 'Day3 下午\n(5/31)',
    pr: 'PR #16',
    title: '实现限频与滥用防护',
    module: '安全与运维',
    description: '单仓库限频（3 PR/min 滑动窗口）、单用户限频（10 reviews/h）、GitHub API 配额监控、异常流量告警日志',
    deliverables: 'src/middleware/rate-limiter.ts',
    acceptanceCriteria: '超过限频阈值返回 429；API 配额低于 10% 时告警',
    estimatedHours: '1h',
  },
  {
    day: 'Day3 下午\n(5/31)',
    pr: 'PR #17',
    title: '实现错误处理、日志与优雅关闭',
    module: '安全与运维',
    description: '全局异常捕获与分级日志（debug/info/warn/error）、结构化日志（JSON 格式含 traceId）、SIGTERM 优雅关闭（等待队列排空）、健康检查端点 /health',
    deliverables: 'src/utils/logger.ts + src/middleware/error-handler.ts',
    acceptanceCriteria: '异常不导致进程崩溃；日志含 traceId 可追踪；/health 返回 200 + 队列深度',
    estimatedHours: '1.5h',
  },
  {
    day: 'Day3 下午\n(5/31)',
    pr: 'PR #18',
    title: '编写 README、配置文档与 Demo 准备',
    module: '文档',
    description: 'README（快速开始+架构图+配置说明）、.x-reviewer.yml 配置规范文档、路演 PPT 大纲、Demo 录制脚本准备',
    deliverables: 'README.md + docs/CONFIG.md + docs/ARCHITECTURE.md',
    acceptanceCriteria: 'README 包含一键部署步骤；配置文件文档完整；架构图清晰',
    estimatedHours: '1h',
  },
];

// Create workbook
const wb = XLSX.utils.book_new();

// Convert to worksheet data
const headers = ['Day', 'PR', 'PR 标题', '所属模块', '详细描述', '交付物', '验收标准', '预估工时'];
const data = [headers];

schedule.forEach(row => {
  data.push([
    row.day.replace(/\n/g, ' '),
    row.pr,
    row.title,
    row.module,
    row.description,
    row.deliverables,
    row.acceptanceCriteria,
    row.estimatedHours,
  ]);
});

const ws = XLSX.utils.aoa_to_sheet(data);

// Column widths
ws['!cols'] = [
  { wch: 14 },
  { wch: 8 },
  { wch: 42 },
  { wch: 16 },
  { wch: 60 },
  { wch: 45 },
  { wch: 50 },
  { wch: 12 },
];

// Style header row (bold + fill color)
const headerStyle = {
  font: { bold: true, color: { rgb: 'FFFFFF' } },
  fill: { fgColor: { rgb: '2563EB' } },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
};

headers.forEach((_, i) => {
  const cellRef = XLSX.utils.encode_cell({ r: 0, c: i });
  if (!ws[cellRef]) ws[cellRef] = { t: 's', v: headers[i] };
  ws[cellRef].s = headerStyle;
});

// Day color bands
const dayColors = {
  'Day1 上午': 'F0F9FF',
  'Day1 下午': 'EFF6FF',
  'Day2 上午': 'F0FDF4',
  'Day2 下午': 'ECFDF5',
  'Day3 上午': 'FFF7ED',
  'Day3 下午': 'FEF2F2',
};

schedule.forEach((row, i) => {
  const dayKey = row.day.replace(/\n/g, ' ');
  const color = dayColors[dayKey] || 'FFFFFF';
  headers.forEach((_, j) => {
    const cellRef = XLSX.utils.encode_cell({ r: i + 1, c: j });
    if (!ws[cellRef]) ws[cellRef] = { t: 's', v: data[i + 1][j] };
    ws[cellRef].s = {
      fill: { fgColor: { rgb: color } },
      alignment: { vertical: 'top', wrapText: true },
    };
  });
});

// Add a summary sheet
const summaryData = [
  ['X-Reviewer 项目排期总览'],
  [''],
  ['阶段', 'PR 范围', 'PR 数量', '预估总工时'],
  ['Day1 上午 — 项目脚手架', 'PR #1 ~ #3', 3, '3h'],
  ['Day1 下午 — 核心服务', 'PR #4 ~ #6', 3, '5.5h'],
  ['Day2 上午 — AI 引擎', 'PR #7 ~ #9', 3, '5h'],
  ['Day2 下午 — 队列与评论', 'PR #10 ~ #12', 3, '4.5h'],
  ['Day3 上午 — 质量与安全', 'PR #13 ~ #15', 3, '4.5h'],
  ['Day3 下午 — 文档与发布', 'PR #16 ~ #18', 3, '3.5h'],
  [''],
  ['合计', '', 18, '26h'],
  [''],
  ['工作流规范'],
  ['• 每个 PR 从 main 新建 feature 分支：feature/pr-{N}-{short-name}'],
  ['• PR 标题格式：[Day{X}] PR#{N} {描述}'],
  ['• 合并前必须：本地测试通过 + 类型检查零错误 + 代码 Review'],
  ['• 提交信息：<type>(<scope>): <description> （遵循 Conventional Commits）'],
];

const ws2 = XLSX.utils.aoa_to_sheet(summaryData);
ws2['!cols'] = [{ wch: 40 }, { wch: 20 }, { wch: 12 }, { wch: 16 }];

// Title style
ws2['A1'].s = { font: { bold: true, sz: 16, color: { rgb: '1E3A5F' } } };

XLSX.utils.book_append_sheet(wb, ws, '详细排期');
XLSX.utils.book_append_sheet(wb, ws2, '总览');

const outputPath = path.join(__dirname, '..', '项目排期表.xlsx');
XLSX.writeFile(wb, outputPath);
console.log(`XLSX written to: ${outputPath}`);

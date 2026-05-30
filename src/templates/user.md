请审查以下 Pull Request 的代码变更。

## PR 信息
- **标题**：{{title}}
- **描述**：{{body}}
- **分支**：{{headSha}} → {{baseSha}}
- **变更文件数**：{{fileCount}}
- **触发方式**：{{trigger}}

## 关联上下文
{{#linkedIssues}}
- 关联 Issue #{{number}}：{{title}}
  {{body}}
{{/linkedIssues}}
{{^linkedIssues}}
（无关联 Issue）
{{/linkedIssues}}

## 项目环境
- 语言：{{language}}
- 框架：{{framework}}

## 自定义审查规则
{{customRules}}

## 代码 Diff（已过滤噪声）
{{#businessPatches}}
### {{filename}}（{{lines}} 行变更）
```{{languageHint}}
{{patch}}
```
{{/businessPatches}}

## 输出要求
请严格按照以下 JSON Schema 输出审查报告，不要包含 markdown 代码块标记或其他文字：

{
  "summary": "一句话总结修改目的与影响范围",
  "risks": [
    {
      "level": "critical|warning",
      "file": "相对文件路径",
      "line": 42,
      "title": "简短的问题描述",
      "description": "详细说明为什么这是一个问题",
      "suggestion": "修复建议的描述",
      "fixCode": "可选的修复代码片段",
      "confidence": 0.95,
      "isFalsePositiveLikely": false
    }
  ],
  "overallScore": 7.5,
  "suggestedLabels": ["bug-risk", "needs-test"]
}

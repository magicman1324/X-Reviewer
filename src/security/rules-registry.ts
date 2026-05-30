import { RiskLevel } from '../types/index.js';

export interface SecurityRule {
  id: string;
  /** Human-readable title for the review report. */
  title: string;
  /** Markdown description of the risk. */
  description: string;
  /** Suggested fix / remediation. */
  suggestion: string;
  level: RiskLevel;
  /** Regex patterns to match against code lines. */
  patterns: RegExp[];
  /** File globs this rule applies to. Empty = all files. */
  fileGlobs: string[];
  /** CWE reference for the vulnerability class. */
  cwe?: string;
  /** OWASP Top 10 category. */
  owasp?: string;
  /** When true, this rule can provide auto-fix code. */
  hasAutoFix: boolean;
}

const XSS_RULES: SecurityRule[] = [
  {
    id: 'SEC-XSS-001',
    title: 'innerHTML 可能导致 XSS 漏洞',
    description: '直接赋值 innerHTML 会执行 HTML 字符串中的脚本。使用 textContent 或 DOM API 替代。',
    suggestion: '使用 textContent 替代 innerHTML，或通过 DOMPurify 对内容进行净化后再赋值。',
    level: RiskLevel.Critical,
    patterns: [/\.innerHTML\s*=\s*(?!\s*['"`]\s*['"`]\s*;)/],
    fileGlobs: ['*.ts', '*.tsx', '*.js', '*.jsx'],
    cwe: 'CWE-79',
    owasp: 'A03:2021 – Injection',
    hasAutoFix: false,
  },
  {
    id: 'SEC-XSS-002',
    title: 'dangerouslySetInnerHTML 存在 XSS 风险',
    description: 'React 的 dangerouslySetInnerHTML 如其名所示具有危险性，仅应在内容完全可信时使用。',
    suggestion: '使用 React 组件渲染替代 dangerouslySetInnerHTML，或对内容进行 HTML 实体编码。',
    level: RiskLevel.Critical,
    patterns: [/dangerouslySetInnerHTML/],
    fileGlobs: ['*.tsx', '*.jsx'],
    cwe: 'CWE-79',
    owasp: 'A03:2021 – Injection',
    hasAutoFix: false,
  },
  {
    id: 'SEC-XSS-003',
    title: 'document.write() 存在 XSS 风险',
    description: 'document.write() 在页面加载后调用会覆盖整个文档，且可被用于注入恶意脚本。',
    suggestion: '使用 DOM API（如 createElement + appendChild）替代 document.write()。',
    level: RiskLevel.Warning,
    patterns: [/document\.write\s*\(/],
    fileGlobs: ['*.ts', '*.tsx', '*.js', '*.jsx'],
    cwe: 'CWE-79',
    owasp: 'A03:2021 – Injection',
    hasAutoFix: false,
  },
];

const INJECTION_RULES: SecurityRule[] = [
  {
    id: 'SEC-INJ-001',
    title: 'eval() 动态代码执行风险',
    description: 'eval() 会执行任意字符串代码。若输入来自用户，可导致远程代码执行（RCE）。',
    suggestion: '完全避免使用 eval()。如需动态逻辑，使用策略模式、函数映射表等安全替代方案。',
    level: RiskLevel.Critical,
    patterns: [/\beval\s*\(/],
    fileGlobs: ['*.ts', '*.tsx', '*.js', '*.jsx', '*.py'],
    cwe: 'CWE-95',
    owasp: 'A03:2021 – Injection',
    hasAutoFix: false,
  },
  {
    id: 'SEC-INJ-002',
    title: 'new Function() 动态代码执行风险',
    description: 'Function 构造函数与 eval() 类似，可执行任意代码。',
    suggestion: '避免使用 Function 构造函数。使用闭包或高阶函数替代。',
    level: RiskLevel.Critical,
    patterns: [/\bnew\s+Function\s*\(/],
    fileGlobs: ['*.ts', '*.tsx', '*.js', '*.jsx'],
    cwe: 'CWE-95',
    owasp: 'A03:2021 – Injection',
    hasAutoFix: false,
  },
  {
    id: 'SEC-INJ-003',
    title: 'SQL 字符串拼接存在注入风险',
    description: '使用字符串拼接或模板字面量构建 SQL 查询，攻击者可通过输入注入恶意 SQL。',
    suggestion: '使用参数化查询（Prepared Statements）或 ORM 的安全查询方法替代字符串拼接。',
    level: RiskLevel.Critical,
    patterns: [
      /['"`].*(?:SELECT|INSERT|UPDATE|DELETE|DROP)\b.*(?:\+|`\$\{)/i,
      /`\$\{.*SELECT|INSERT|UPDATE|DELETE|DROP\b/i,
    ],
    fileGlobs: ['*.ts', '*.tsx', '*.js', '*.jsx', '*.py', '*.go', '*.java'],
    cwe: 'CWE-89',
    owasp: 'A03:2021 – Injection',
    hasAutoFix: false,
  },
  {
    id: 'SEC-INJ-004',
    title: 'child_process.exec 命令注入风险',
    description: 'exec() 将字符串传给 shell 执行。若拼接了用户输入，攻击者可注入任意系统命令。',
    suggestion: '使用 execFile() 或 spawn() 替代 exec()，并确保用户输入经过严格校验和转义。',
    level: RiskLevel.Critical,
    patterns: [
      /\.exec\s*\(\s*[^)]*(?:\$\{|\+)/,
      /child_process\s*\.\s*exec/,
      /\bexec\s*\(\s*[^)]*(?:\$\{|\+)/,
    ],
    fileGlobs: ['*.ts', '*.tsx', '*.js', '*.jsx'],
    cwe: 'CWE-78',
    owasp: 'A03:2021 – Injection',
    hasAutoFix: false,
  },
];

const SECRET_RULES: SecurityRule[] = [
  {
    id: 'SEC-SCR-001',
    title: '硬编码密钥/凭据',
    description: '代码中包含疑似 API Key、Token 或密码的硬编码字符串。这些凭据可能泄露到版本控制系统中。',
    suggestion: '将敏感凭据移至环境变量（process.env）或密钥管理服务（如 Vault、AWS Secrets Manager）。',
    level: RiskLevel.Critical,
    patterns: [
      /(?:api[_-]?key|apikey|secret|token|password|passwd)\s*[:=]\s*['"`][A-Za-z0-9_\-+=/]{16,}['"`]/i,
      /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/,
    ],
    fileGlobs: [],
    cwe: 'CWE-798',
    owasp: 'A07:2021 – Identification and Authentication Failures',
    hasAutoFix: false,
  },
  {
    id: 'SEC-SCR-002',
    title: 'JWT Secret 硬编码',
    description: 'JWT 签名密钥硬编码在源代码中。攻击者可获取该密钥后伪造任意 JWT Token。',
    suggestion: '将 JWT Secret 存储在环境变量中，并使用足够强度的随机密钥（≥256 bits）。',
    level: RiskLevel.Critical,
    patterns: [
      /jwt.*secret.*[:=]\s*['"`][A-Za-z0-9_\-+=]{8,}['"`]/i,
      /secret.*jwt.*[:=]\s*['"`][A-Za-z0-9_\-+=]{8,}['"`]/i,
    ],
    fileGlobs: [],
    cwe: 'CWE-798',
    owasp: 'A07:2021',
    hasAutoFix: false,
  },
];

const SSRF_RULES: SecurityRule[] = [
  {
    id: 'SEC-SSRF-001',
    title: '用户输入直接用于 HTTP 请求 URL（SSRF 风险）',
    description: '用户可控制的输入被直接用于构造 HTTP 请求 URL，攻击者可利用此漏洞访问内部网络资源。',
    suggestion: '对用户输入的 URL 进行白名单校验，禁止访问内网地址（127.0.0.1、10.x、192.168.x 等）。',
    level: RiskLevel.Warning,
    patterns: [
      /fetch\s*\(\s*(?:req\.|ctx\.|request\.).*/i,
      /axios\s*\.\s*(?:get|post|put|delete)\s*\(\s*(?:req\.|ctx\.|request\.).*/i,
    ],
    fileGlobs: ['*.ts', '*.tsx', '*.js', '*.jsx'],
    cwe: 'CWE-918',
    owasp: 'A10:2021 – Server-Side Request Forgery',
    hasAutoFix: false,
  },
];

const PATH_TRAVERSAL_RULES: SecurityRule[] = [
  {
    id: 'SEC-PATH-001',
    title: '路径遍历风险',
    description: '文件路径由用户输入直接拼接而成，攻击者可使用 ../ 访问任意文件。',
    suggestion: '使用 path.resolve() 规范化路径后，验证其是否在允许的目录范围内。',
    level: RiskLevel.Critical,
    patterns: [
      /path\s*\.\s*join\s*\([^)]*(?:req\.|ctx\.|request\.|params\.|query\.|body\.)/i,
      /fs\s*\.\s*(?:readFile|writeFile|createReadStream|createWriteStream)\s*\([^)]*(?:req\.|ctx\.|request\.)/i,
    ],
    fileGlobs: ['*.ts', '*.tsx', '*.js', '*.jsx'],
    cwe: 'CWE-22',
    owasp: 'A01:2021 – Broken Access Control',
    hasAutoFix: false,
  },
];

const AUTH_RULES: SecurityRule[] = [
  {
    id: 'SEC-AUTH-001',
    title: '缺失鉴权检查',
    description: '路由处理器未进行身份验证/授权检查，可能导致越权访问。',
    suggestion: '在路由处理开始前添加身份验证中间件，或显式调用鉴权函数检查用户权限。',
    level: RiskLevel.Warning,
    patterns: [/(?:router\.|app\.)(?:get|post|put|delete|patch)\s*\(\s*['"`][^'"]*['"`]\s*,\s*(?:async\s*)?\(/],
    fileGlobs: ['*.ts', '*.tsx', '*.js', '*.jsx'],
    cwe: 'CWE-306',
    owasp: 'A01:2021 – Broken Access Control',
    hasAutoFix: false,
  },
];

const DEPENDENCY_RULES: SecurityRule[] = [
  {
    id: 'SEC-DEP-001',
    title: '使用已弃用的不安全依赖',
    description: '检测到使用已知有安全漏洞的 API（如 crypto.createCipher 而非 createCipheriv）。',
    suggestion: '使用安全的替代 API。例如 crypto.createCipheriv() 替代 crypto.createCipher()。',
    level: RiskLevel.Warning,
    patterns: [/crypto\s*\.\s*createCipher\s*\(/],
    fileGlobs: ['*.ts', '*.tsx', '*.js', '*.jsx'],
    cwe: 'CWE-327',
    owasp: 'A02:2021 – Cryptographic Failures',
    hasAutoFix: false,
  },
];

/** All registered security rules in priority order. */
export const ALL_RULES: SecurityRule[] = [
  ...XSS_RULES,
  ...INJECTION_RULES,
  ...SECRET_RULES,
  ...SSRF_RULES,
  ...PATH_TRAVERSAL_RULES,
  ...AUTH_RULES,
  ...DEPENDENCY_RULES,
];

/** Look up a rule by its ID. */
export function getRuleById(id: string): SecurityRule | undefined {
  return ALL_RULES.find((r) => r.id === id);
}

/** Returns the total count of registered rules. */
export function getRuleCount(): number {
  return ALL_RULES.length;
}

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

export interface LoggerOptions {
  /** Minimum log level to output. Default 'info'. */
  level?: LogLevel;
  /** When true, output JSON lines (structured logging). Default false. */
  json?: boolean;
  /** Optional service name for log context. */
  service?: string;
}

/**
 * Lightweight structured logger.
 * Mirrors Probot's log interface for drop-in compatibility.
 */
export class Logger {
  private minWeight: number;
  private json: boolean;
  private service: string;

  constructor(options: LoggerOptions = {}) {
    this.minWeight = LEVEL_WEIGHT[options.level ?? 'info'];
    this.json = options.json ?? false;
    this.service = options.service ?? 'x-reviewer';
  }

  trace(msg: string, ctx?: Record<string, unknown>): void {
    this.write('trace', msg, ctx);
  }

  debug(msg: string, ctx?: Record<string, unknown>): void {
    this.write('debug', msg, ctx);
  }

  info(msg: string, ctx?: Record<string, unknown>): void {
    this.write('info', msg, ctx);
  }

  warn(msg: string, ctx?: Record<string, unknown>): void {
    this.write('warn', msg, ctx);
  }

  error(msg: string, ctx?: Record<string, unknown>): void {
    this.write('error', msg, ctx);
  }

  fatal(msg: string, ctx?: Record<string, unknown>): void {
    this.write('fatal', msg, ctx);
  }

  /**
   * Create a child logger with extra default context.
   */
  child(defaults: Record<string, unknown>): Logger {
    const childLogger = new Logger({
      level: this.logLevelName(),
      json: this.json,
      service: this.service,
    });
    // Wrap write to inject defaults
    const originalWrite = childLogger.write.bind(childLogger);
    childLogger.write = (level: LogLevel, msg: string, ctx?: Record<string, unknown>) => {
      originalWrite(level, msg, { ...defaults, ...ctx });
    };
    return childLogger;
  }

  // ---- internal ----

  private write(level: LogLevel, msg: string, ctx?: Record<string, unknown>): void {
    if (LEVEL_WEIGHT[level] < this.minWeight) return;

    const timestamp = new Date().toISOString();

    if (this.json) {
      const entry: Record<string, unknown> = {
        ts: timestamp,
        level,
        service: this.service,
        msg,
      };
      if (ctx && Object.keys(ctx).length > 0) {
        entry.ctx = ctx;
      }
      process.stdout.write(JSON.stringify(entry) + '\n');
    } else {
      const ctxStr = ctx && Object.keys(ctx).length > 0 ? ' ' + JSON.stringify(ctx) : '';
      const label = level.toUpperCase().padEnd(5);
      process.stdout.write(`${timestamp} ${label} [${this.service}] ${msg}${ctxStr}\n`);
    }
  }

  private logLevelName(): LogLevel {
    const entry = Object.entries(LEVEL_WEIGHT).find(([, w]) => w === this.minWeight);
    return (entry?.[0] as LogLevel) ?? 'info';
  }
}

/** Singleton app logger — configure once at startup. */
let appLogger: Logger = new Logger();

export function setLogger(logger: Logger): void {
  appLogger = logger;
}

export function getLogger(): Logger {
  return appLogger;
}

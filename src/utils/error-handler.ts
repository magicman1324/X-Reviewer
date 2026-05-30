import { getLogger } from './logger.js';

export enum ErrorCategory {
  /** User/input error (bad PR, invalid command). */
  User = 'user',
  /** External service error (API timeout, rate limit). */
  External = 'external',
  /** Internal application error (bug, invariant violation). */
  Internal = 'internal',
  /** Transient error worth retrying. */
  Retryable = 'retryable',
  /** Unknown / unclassified. */
  Unknown = 'unknown',
}

export interface ClassifiedError {
  category: ErrorCategory;
  message: string;
  original: Error;
  /** HTTP status code suggestion. */
  statusCode: number;
  /** When true, the error should be surfaced to the user in a PR comment. */
  userVisible: boolean;
}

/**
 * Classification rules map. Checks error message and name against patterns.
 */
function classify(err: Error): ErrorCategory {
  const msg = err.message.toLowerCase();
  const name = err.name.toLowerCase();

  // User errors
  if (
    msg.includes('validation') ||
    msg.includes('invalid') ||
    msg.includes('empty') ||
    msg.includes('bad request') ||
    msg.includes('not found') ||
    name.includes('validation')
  ) {
    return ErrorCategory.User;
  }

  // External errors
  if (
    msg.includes('timeout') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('rate limit') ||
    msg.includes('429') ||
    msg.includes('503') ||
    msg.includes('502') ||
    name === 'aborterror'
  ) {
    return ErrorCategory.External;
  }

  // Retryable errors
  if (
    msg.includes('eagain') ||
    msg.includes('ebusy') ||
    msg.includes('network') ||
    msg.includes('connection reset') ||
    msg.includes('socket hang up') ||
    msg.includes('too many requests')
  ) {
    return ErrorCategory.Retryable;
  }

  // Internal errors (assertions, type errors, etc.)
  if (
    msg.includes('assert') ||
    name === 'typeerror' ||
    name === 'referenceerror' ||
    name === 'rangeerror'
  ) {
    return ErrorCategory.Internal;
  }

  return ErrorCategory.Unknown;
}

/**
 * Map category to HTTP status code.
 */
function categoryToStatus(category: ErrorCategory): number {
  switch (category) {
    case ErrorCategory.User:
      return 400;
    case ErrorCategory.External:
      return 502;
    case ErrorCategory.Retryable:
      return 503;
    case ErrorCategory.Internal:
      return 500;
    default:
      return 500;
  }
}

/**
 * Classify an error and log it at the appropriate level.
 */
export function handleError(err: Error, context?: Record<string, unknown>): ClassifiedError {
  const category = classify(err);
  const log = getLogger();
  const statusCode = categoryToStatus(category);
  const userVisible = category === ErrorCategory.User || category === ErrorCategory.External;

  const classified: ClassifiedError = {
    category,
    message: err.message,
    original: err,
    statusCode,
    userVisible,
  };

  const logCtx = { ...context, category, statusCode, stack: err.stack?.split('\n').slice(0, 4).join('\n') };

  switch (category) {
    case ErrorCategory.User:
      log.warn(`[UserError] ${err.message}`, logCtx);
      break;
    case ErrorCategory.Internal:
    case ErrorCategory.Unknown:
      log.error(`[${category === ErrorCategory.Internal ? 'InternalError' : 'UnknownError'}] ${err.message}`, logCtx);
      break;
    case ErrorCategory.External:
    case ErrorCategory.Retryable:
      log.warn(`[${category === ErrorCategory.Retryable ? 'RetryableError' : 'ExternalError'}] ${err.message}`, logCtx);
      break;
  }

  return classified;
}

/**
 * Register global handlers for unhandled rejections and uncaught exceptions.
 * Returns a cleanup function that removes the listeners.
 */
export function registerGlobalErrorHandlers(): () => void {
  const log = getLogger();

  const onUnhandledRejection = (reason: unknown, _promise: Promise<unknown>) => {
    log.error(`Unhandled Rejection: ${String(reason)}`, {
      reason: String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
    // Don't crash — the server should stay up for other requests
  };

  const onUncaughtException = (err: Error) => {
    log.fatal(`Uncaught Exception: ${err.message}`, {
      stack: err.stack,
      name: err.name,
    });
    // Uncaught exceptions leave the process in an unknown state — exit after logging
    setTimeout(() => process.exit(1), 1000);
  };

  process.on('unhandledRejection', onUnhandledRejection);
  process.on('uncaughtException', onUncaughtException);

  return () => {
    process.off('unhandledRejection', onUnhandledRejection);
    process.off('uncaughtException', onUncaughtException);
  };
}

/**
 * Format an error for display in a GitHub PR comment.
 */
export function formatErrorForComment(err: Error, classified?: ClassifiedError): string {
  const cat: ErrorCategory = classified?.category ?? classify(err);
  const icon = cat === ErrorCategory.User ? '⚠️' : '❌';
  const label =
    cat === ErrorCategory.User ? 'Input Error' :
    cat === ErrorCategory.External ? 'External Service Error' :
    cat === ErrorCategory.Retryable ? 'Temporary Error' :
    'Internal Error';

  return [
    `## ${icon} X-Reviewer ${label}`,
    '',
    `> ${err.message}`,
    '',
    cat === ErrorCategory.Retryable
      ? 'This is a temporary error. The review will be retried automatically.'
      : cat === ErrorCategory.External
        ? 'An external service failed. Please try again later.'
        : cat === ErrorCategory.User
          ? 'Please check your PR and try again.'
          : 'An unexpected error occurred. The team has been notified.',
    '',
    '---',
    `<sub>Error ID: \`${Date.now().toString(36)}\` | Category: \`${cat}\`</sub>`,
  ].join('\n');
}

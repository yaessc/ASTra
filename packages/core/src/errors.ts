export class QdrantConnectionError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'QdrantConnectionError';
    this.cause = cause;
  }
}

export class ModelLoadError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'ModelLoadError';
    this.cause = cause;
  }
}

export class ConfigValidationError extends Error {
  issues: { path: string; message: string }[];

  constructor(issues: { path: string; message: string }[]) {
    super('Config validation failed');
    this.name = 'ConfigValidationError';
    this.issues = issues;
  }
}

const CONNECTION_ERROR_CODES = [
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'EHOSTUNREACH',
];

export function isQdrantError(err: unknown): err is NodeJS.ErrnoException {
  if (!(err instanceof Error)) return false;

  const cause = err.cause;
  const code = (err as NodeJS.ErrnoException).code
    ?? (cause && typeof cause === 'object' && 'code' in cause ? (cause as Record<string, unknown>).code as string | undefined : undefined);

  return CONNECTION_ERROR_CODES.includes(code ?? '');
}

export function wrapQdrantError(err: unknown, url: string): QdrantConnectionError {
  const base = `Qdrant is not reachable at ${url}`;
  if (isQdrantError(err)) {
    return new QdrantConnectionError(`${base}\n  Did you forget to start the Docker container?\n  → docker compose up -d`);
  }
  return new QdrantConnectionError(`${base}\n  ${err instanceof Error ? err.message : String(err)}`, err);
}

export function isQdrantNotFoundError(err: unknown): boolean {
  if (!(err instanceof QdrantConnectionError)) return false;
  return err.cause != null
    && typeof err.cause === 'object'
    && (err.cause as Record<string, unknown>).status === 404;
}

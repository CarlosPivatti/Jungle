export function logStructured(
  level: 'info' | 'warn' | 'error',
  message: string,
  context: Record<string, unknown> = {},
): void {
  console[level](JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  }));
}

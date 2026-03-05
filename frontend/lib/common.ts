export class AppError extends Error {
  readonly status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "AppError";
    this.status = status;
  }
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function safeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function extractJsonObject(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new AppError("Model did not return valid JSON.");
    return JSON.parse(text.slice(start, end + 1));
  }
}

export async function retryWithBackoff<T>(args: {
  attempts: number;
  shouldRetry: (message: string) => boolean;
  task: () => Promise<T>;
}): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= args.attempts; attempt += 1) {
    try {
      return await args.task();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (attempt < args.attempts && args.shouldRetry(message)) {
        await sleep(700 * attempt * attempt);
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

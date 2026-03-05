import Anthropic from "@anthropic-ai/sdk";
import { AppError, retryWithBackoff } from "@/lib/common";

let discoveredModelIdsCache: { atMs: number; ids: string[] } | null = null;

function shouldRetryAnthropicError(message: string): boolean {
  const msg = message.toLowerCase();
  return (
    msg.includes("rate limit") ||
    msg.includes("429") ||
    msg.includes("overloaded") ||
    msg.includes("temporarily unavailable") ||
    msg.includes("timeout")
  );
}

function anthropicClient(): Anthropic {
  const apiKey = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  if (!apiKey) throw new AppError("Missing ANTHROPIC_API_KEY.", 500);
  return new Anthropic({ apiKey });
}

async function discoverAvailableModelIds(client: Anthropic): Promise<string[]> {
  const now = Date.now();
  if (discoveredModelIdsCache && now - discoveredModelIdsCache.atMs < 10 * 60 * 1000) {
    return discoveredModelIdsCache.ids;
  }
  try {
    const modelsApi = (client as unknown as { models?: { list: () => Promise<unknown> } }).models;
    if (!modelsApi?.list) return [];
    const listResponse = (await modelsApi.list()) as {
      data?: Array<{ id?: string }>;
      models?: Array<{ id?: string }>;
    };
    const items = listResponse.data || listResponse.models || [];
    const ids = items
      .map((m) => (m.id || "").trim())
      .filter((id) => id.toLowerCase().startsWith("claude-"));
    discoveredModelIdsCache = { atMs: now, ids };
    return ids;
  } catch {
    return [];
  }
}

function prioritizeModels(discoveredIds: string[], preferredConfigured: string, family: "sonnet" | "haiku"): string[] {
  const discoveredFamily = discoveredIds.filter((id) => id.toLowerCase().includes(family));
  const discoveredOther = discoveredIds.filter((id) => !id.toLowerCase().includes(family));
  const defaults =
    family === "sonnet"
      ? ["claude-3-7-sonnet-latest", "claude-3-5-sonnet-20241022", "claude-3-haiku-20240307"]
      : ["claude-3-haiku-20240307", "claude-3-5-sonnet-20241022", "claude-3-7-sonnet-latest"];

  const ordered = [preferredConfigured.trim(), ...discoveredFamily, ...discoveredOther, ...defaults]
    .map((x) => x.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  return ordered.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export async function callClaudeWithFallback(args: {
  prompt: string;
  family: "sonnet" | "haiku";
  preferredModel?: string;
  maxTokens: number;
  temperature: number;
  attemptsPerModel: number;
}): Promise<string> {
  const client = anthropicClient();
  const discovered = await discoverAvailableModelIds(client);
  const models = prioritizeModels(discovered, args.preferredModel ?? "", args.family);

  let lastError: unknown = null;
  for (const model of models) {
    try {
      const text = await retryWithBackoff({
        attempts: args.attemptsPerModel,
        shouldRetry: shouldRetryAnthropicError,
        task: async () => {
          const response = await client.messages.create({
            model,
            max_tokens: args.maxTokens,
            temperature: args.temperature,
            messages: [{ role: "user", content: args.prompt }],
          });
          return response.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("\n")
            .trim();
        },
      });
      return text;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      if (message.includes("not_found")) continue;
      if (
        message.includes("invalid x-api-key") ||
        message.includes("authentication") ||
        message.includes("unauthorized")
      ) {
        throw new AppError(`Anthropic authentication failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  throw new AppError(
    `Anthropic request failed: ${lastError instanceof Error ? lastError.message : "No Claude model is available."}`
  );
}

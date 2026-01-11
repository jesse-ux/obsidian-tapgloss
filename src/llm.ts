import { requestUrl } from "obsidian";

export type LookupMode = "word" | "sentence";

export interface LlmRequestOptions {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  mode: LookupMode;
  selection: string;
  contextLine: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  enableResponseFormat: boolean;
  signal?: AbortSignal;
}

export interface LlmResponse {
  content: string;
  usedResponseFormat: boolean;
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/v1")) {
    return trimmed;
  }
  return `${trimmed}/v1`;
}

function buildUserPrompt(template: string, selection: string, contextLine: string): string {
  return template
    .replace("{selection}", selection)
    .replace("{contextLine}", contextLine ?? "");
}

function extractContent(data: any): string {
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    const errorMessage = data?.error?.message ?? "No content in response.";
    throw new Error(errorMessage);
  }
  return String(content);
}

function isResponseFormatError(error: unknown): boolean {
  if (!error) return false;
  const message = (error as any).message ?? "";
  return typeof message === "string" && message.toLowerCase().includes("response_format");
}

export async function requestLookup(options: LlmRequestOptions): Promise<LlmResponse> {
  const url = `${normalizeBaseUrl(options.baseUrl)}/chat/completions`;
  const messages = [
    { role: "system", content: options.systemPrompt },
    { role: "user", content: buildUserPrompt(options.userPrompt, options.selection, options.contextLine) }
  ];

  const requestBody = (useResponseFormat: boolean) => ({
    model: options.modelId,
    messages,
    temperature: 0.2,
    max_tokens: options.maxTokens,
    ...(useResponseFormat ? { response_format: { type: "json_object" } } : {})
  });

  const doRequest = async (useResponseFormat: boolean): Promise<LlmResponse> => {
    const response = await requestUrl({
      url,
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody(useResponseFormat)),
      signal: options.signal,
      timeout: 20000
    } as any);

    const data = response.json ?? JSON.parse(response.text);
    return { content: extractContent(data), usedResponseFormat: useResponseFormat };
  };

  if (options.enableResponseFormat) {
    try {
      return await doRequest(true);
    } catch (error) {
      if (isResponseFormatError(error)) {
        return await doRequest(false);
      }
      throw error;
    }
  }

  return await doRequest(false);
}

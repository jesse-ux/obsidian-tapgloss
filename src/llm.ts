import { requestUrl, RequestUrlParam } from "obsidian";

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

export interface LlmConnectionResult {
  ok: boolean;
  message: string;
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

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

interface RequestUrlParamWithTimeout extends RequestUrlParam {
  timeout?: number;
  signal?: AbortSignal;
}

function extractContent(data: unknown): string {
  const content = (data as ChatCompletionResponse | null)?.choices?.[0]?.message?.content;
  if (!content) {
    const errorMessage = (data as ChatCompletionResponse | null)?.error?.message ?? "No content in response.";
    throw new Error(errorMessage);
  }
  return String(content);
}

function isResponseFormatError(error: unknown): boolean {
  if (!error) return false;
  const message = (error as { message?: string } | null)?.message ?? "";
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
    const requestParams: RequestUrlParamWithTimeout = {
      url,
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody(useResponseFormat)),
      timeout: 20000,
      signal: options.signal
    };

    const response = await requestUrl(requestParams);

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

export async function testLlmConnection(options: {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  signal?: AbortSignal;
}): Promise<LlmConnectionResult> {
  const url = `${normalizeBaseUrl(options.baseUrl)}/chat/completions`;
  const requestBody = {
    model: options.modelId,
    messages: [
      { role: "system", content: "You are a connectivity test." },
      { role: "user", content: "ping" }
    ],
    temperature: 0,
    max_tokens: 2
  };

  const requestParams: RequestUrlParamWithTimeout = {
    url,
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody),
    timeout: 10000,
    signal: options.signal
  };

  try {
    const response = await requestUrl(requestParams);
    const payload = response.json ?? safeJsonParse(response.text);
    if (response.status >= 200 && response.status < 300) {
      return { ok: true, message: "Connection ok." };
    }
    const errorMessage = extractErrorMessage(payload) || `Request failed (${response.status}).`;
    return { ok: false, message: errorMessage };
  } catch (error) {
    const message = (error as { message?: string } | null)?.message ?? "Request failed.";
    return { ok: false, message };
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractErrorMessage(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const error = (data as { error?: { message?: string } }).error;
  return typeof error?.message === "string" ? error.message : "";
}

import { MarkdownView, Notice, Plugin } from "obsidian";
import { EditorView } from "@codemirror/view";
import { selectionIconPlugin } from "./cm6/selectionIcon";
import { PdfSelectionIcon } from "./pdf/selectionIcon";
import { Popover, SentenceCardData, WordCardData } from "./ui/popover";
import { requestLookup, LookupMode } from "./llm";
import { appendToCanvas } from "./canvas";
import {
  DEFAULT_SENTENCE_PROMPT,
  DEFAULT_SENTENCE_PROMPT_EN,
  DEFAULT_SENTENCE_USER_PROMPT,
  DEFAULT_SENTENCE_USER_PROMPT_EN,
  DEFAULT_SETTINGS,
  DEFAULT_WORD_PROMPT,
  DEFAULT_WORD_PROMPT_EN,
  DEFAULT_WORD_USER_PROMPT,
  DEFAULT_WORD_USER_PROMPT_EN,
  SelectionLookupSettingTab,
  SelectionLookupSettings
} from "./settings";

interface LookupContext {
  selection: string;
  contextLine: string;
  anchorRect: DOMRect;
}

export default class SelectionLlmLookupPlugin extends Plugin {
  settings: SelectionLookupSettings = DEFAULT_SETTINGS;
  private popover: Popover | null = null;
  private cache = new Map<string, WordCardData | SentenceCardData>();
  private activeController: AbortController | null = null;
  private activeRequestKey: string | null = null;
  private lastSelection = "";
  private pdfSelectionIcon: PdfSelectionIcon | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new SelectionLookupSettingTab(this.app, this));
    this.popover = new Popover(() => this.abortActiveRequest());
    this.injectStyles();
    this.applyTheme();

    this.registerEditorExtension(
      selectionIconPlugin({
        onTrigger: (selection, contextLine, anchorRect) => {
          this.runLookup({ selection, contextLine, anchorRect }, null);
        },
        onSelectionChange: (selection) => {
          if (selection !== this.lastSelection) {
            this.lastSelection = selection;
            this.abortActiveRequest();
          }
        },
        getIconText: () => this.settings.iconText
      })
    );

    this.pdfSelectionIcon = new PdfSelectionIcon(this.app, {
      onTrigger: (selection, anchorRect) => {
        this.runLookup({ selection, contextLine: "", anchorRect }, null);
      },
      onSelectionChange: (selection) => {
        if (selection !== this.lastSelection) {
          this.lastSelection = selection;
          this.abortActiveRequest();
        }
      },
      getIconText: () => this.settings.iconText
    });
    this.pdfSelectionIcon.start();
    this.register(() => this.pdfSelectionIcon?.stop());

    this.addCommand({
      id: "smart-lookup",
      name: "Smart Lookup",
      editorCallback: (editor) => {
        const context = this.getContextFromEditor(editor.getSelection());
        if (!context) return;
        this.runLookup(context, null);
      }
    });

    this.addCommand({
      id: "translate-selection",
      name: "Translate Selection",
      editorCallback: (editor) => {
        const context = this.getContextFromEditor(editor.getSelection());
        if (!context) return;
        this.runLookup(context, "sentence");
      }
    });
  }

  onunload(): void {
    this.abortActiveRequest();
    this.popover?.close();
    this.pdfSelectionIcon?.stop();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.applyTheme();
  }

  private injectStyles(): void {
    const style = document.createElement("style");
    style.textContent = `
      .sll-selection-icon {
        position: fixed;
        z-index: 1000;
        background: var(--sll-icon-bg, #111111);
        color: var(--sll-icon-text, #f9f6e8);
        border-radius: 6px;
        padding: 4px 6px;
        font-size: var(--sll-icon-size, 13px);
        font-weight: 600;
        letter-spacing: 0.5px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.18);
        border: 1px solid rgba(255, 255, 255, 0.08);
      }
      .sll-popover {
        position: fixed;
        z-index: 1001;
        min-width: 240px;
        max-width: 360px;
        background: var(--sll-pop-bg, #f9f6e8);
        color: var(--sll-pop-text, #1e1e1e);
        border-radius: 10px;
        padding: 12px 14px;
        box-shadow: 0 16px 32px rgba(0, 0, 0, 0.2);
        border: 1px solid rgba(0, 0, 0, 0.08);
        font-size: 13px;
      }
      .sll-popover-header {
        font-weight: 700;
        margin-bottom: 8px;
        font-size: 14px;
      }
      .sll-popover-body {
        margin-bottom: 10px;
        line-height: 1.5;
      }
      .sll-popover-meaning {
        margin-bottom: 10px;
      }
      .sll-popover-section {
        margin-top: 10px;
      }
      .sll-popover-label {
        font-weight: 600;
        font-size: 12px;
        color: var(--sll-pop-label, #7a6f56);
        margin-bottom: 4px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .sll-issue {
        margin-bottom: 6px;
      }
      .sll-issue-title {
        font-weight: 600;
      }
      .sll-issue-suggestion {
        color: #3a3a3a;
      }
      .sll-popover-muted {
        color: var(--sll-pop-muted, #5a5a5a);
      }
      .sll-inflections {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
      }
      .sll-inflections td {
        padding: 2px 0;
        vertical-align: top;
      }
      .sll-inflections td:first-child {
        color: var(--sll-pop-label, #7a6f56);
        width: 90px;
      }
      .sll-popover-footer {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }
      .sll-btn {
        border: 1px solid rgba(0, 0, 0, 0.2);
        background: transparent;
        color: #1e1e1e;
        padding: 4px 10px;
        border-radius: 6px;
        font-size: 12px;
        cursor: pointer;
      }
      .sll-popover-footer .sll-btn:first-child {
        margin-right: auto;
      }
      .sll-btn-primary {
        background: #1e1e1e;
        color: #f9f6e8;
        border-color: #1e1e1e;
      }
      .sll-btn-danger {
        background: #8c2a2a;
        color: #f9f6e8;
        border-color: #8c2a2a;
      }
    `;
    document.head.appendChild(style);
    this.register(() => style.remove());
  }

  private applyTheme(): void {
    const root = document.documentElement;
    root.style.setProperty("--sll-icon-bg", this.settings.iconBgColor || "#111111");
    root.style.setProperty("--sll-icon-text", this.settings.iconTextColor || "#f9f6e8");
    root.style.setProperty("--sll-icon-size", `${this.settings.iconSize || 13}px`);
    root.style.setProperty("--sll-pop-bg", this.settings.popoverBgColor || "#f9f6e8");
    root.style.setProperty("--sll-pop-text", this.settings.popoverTextColor || "#1e1e1e");
  }

  private getContextFromEditor(selection: string): LookupContext | null {
    const normalized = normalizeSelection(selection);
    if (!normalized) {
      this.popover?.showError("No selection to look up.");
      return null;
    }

    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const editorView = activeView ? ((activeView.editor as any).cm as EditorView | undefined) : undefined;
    const anchorRect =
      editorView && editorView.state.selection.main
        ? getAnchorRect(editorView)
        : fallbackAnchorRect(activeView?.containerEl);
    const contextLine = editorView
      ? editorView.state.doc.lineAt(editorView.state.selection.main.from).text
      : "";

    return { selection: normalized, contextLine, anchorRect };
  }

  private async runLookup(context: LookupContext, forceMode: LookupMode | null): Promise<void> {
    if (!this.popover) return;
    const normalized = normalizeSelection(context.selection);
    if (!normalized) return;

    if (!this.isConfigured()) {
      this.popover.showError("Not configured.", [
        {
          label: "Open Settings",
          onClick: () => {
            const setting = (this.app as any).setting;
            setting?.open();
            setting?.openTabById(this.manifest.id);
          },
          variant: "primary"
        }
      ], context.anchorRect);
      return;
    }

    const mode = forceMode ?? classifySelection(normalized, this.settings.sentenceLengthThreshold);
    const selectionForLookup = mode === "word" ? cleanWordSelection(normalized) || normalized : normalized;
    const cacheKey = `${mode}::${selectionForLookup.toLowerCase()}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.renderResult(mode, cached, context.anchorRect);
      return;
    }

    this.abortActiveRequest();
    const controller = new AbortController();
    this.activeController = controller;
    this.activeRequestKey = cacheKey;

    this.popover.showLoading(context.anchorRect);

    try {
      const response = await requestLookup({
        baseUrl: this.settings.apiBaseUrl,
        apiKey: this.settings.apiKey,
        modelId: this.settings.modelId,
        mode,
        selection: selectionForLookup,
        contextLine: context.contextLine,
        systemPrompt: mode === "word" ? this.settings.wordSystemPrompt : this.settings.sentenceSystemPrompt,
        userPrompt: mode === "word" ? this.settings.wordUserPrompt : this.settings.sentenceUserPrompt,
        maxTokens: mode === "word" ? 400 : 300,
        enableResponseFormat: this.settings.enableResponseFormat,
        signal: controller.signal
      });

      if (controller.signal.aborted || this.activeRequestKey !== cacheKey) {
        return;
      }

      const parsed = tryParseJson(response.content);
      if (!parsed) {
        this.showInvalidJson(response.content, mode, context.anchorRect);
        return;
      }

      const result = mode === "word" ? normalizeWordResult(parsed, selectionForLookup) : normalizeSentenceResult(parsed);
      this.cache.set(cacheKey, result);
      this.renderResult(mode, result, context.anchorRect);
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }
      if (this.activeRequestKey !== cacheKey) {
        return;
      }
      this.handleRequestError(error, () => this.runLookup(context, forceMode), context.anchorRect);
    }
  }

  private renderResult(mode: LookupMode, result: WordCardData | SentenceCardData, anchorRect: DOMRect): void {
    if (!this.popover) return;

    if (mode === "word") {
      const wordData = result as WordCardData;
      this.popover.showWordCard(wordData, anchorRect);
      this.popover.setCopyHandler(() => {
        copyToClipboard(buildWordCopy(wordData));
      });
      this.popover.setAddHandler(() => {
        this.addToCanvas(buildWordCanvas(wordData));
      });
    } else {
      const sentenceData = result as SentenceCardData;
      this.popover.showSentenceCard(sentenceData, anchorRect);
      this.popover.setCopyHandler(() => {
        copyToClipboard(sentenceData.translation_zh);
      });
      this.popover.setAddHandler(() => {
        this.addToCanvas(buildSentenceCanvas(sentenceData));
      });
    }
  }

  private showInvalidJson(raw: string, mode: LookupMode, anchorRect: DOMRect): void {
    if (!this.popover) return;
    this.popover.showError("Invalid JSON output.", [
      {
        label: "Copy raw output",
        onClick: () => copyToClipboard(raw)
      },
      {
        label: "Restore default prompt",
        onClick: async () => {
          if (mode === "word") {
            if (this.settings.language === "en") {
              this.settings.wordSystemPrompt = DEFAULT_WORD_PROMPT_EN;
              this.settings.wordUserPrompt = DEFAULT_WORD_USER_PROMPT_EN;
            } else {
              this.settings.wordSystemPrompt = DEFAULT_WORD_PROMPT;
              this.settings.wordUserPrompt = DEFAULT_WORD_USER_PROMPT;
            }
          } else {
            if (this.settings.language === "en") {
              this.settings.sentenceSystemPrompt = DEFAULT_SENTENCE_PROMPT_EN;
              this.settings.sentenceUserPrompt = DEFAULT_SENTENCE_USER_PROMPT_EN;
            } else {
              this.settings.sentenceSystemPrompt = DEFAULT_SENTENCE_PROMPT;
              this.settings.sentenceUserPrompt = DEFAULT_SENTENCE_USER_PROMPT;
            }
          }
          await this.saveSettings();
        },
        variant: "primary"
      }
    ], anchorRect);
  }

  private handleRequestError(error: unknown, retry: () => void, anchorRect: DOMRect): void {
    if (!this.popover) return;
    const status = (error as any)?.status ?? (error as any)?.response?.status;
    if (status === 401 || status === 403) {
      this.popover.showError("Auth failed. Please check your API Key.", [
        { label: "Retry", onClick: retry, variant: "primary" }
      ], anchorRect);
      return;
    }
    const message = isTimeoutError(error) ? "Request timed out." : (error as Error)?.message || "Request failed.";
    this.popover.showError(message, [{ label: "Retry", onClick: retry, variant: "primary" }], anchorRect);
  }

  private abortActiveRequest(): void {
    if (this.activeController) {
      this.activeController.abort();
      this.activeController = null;
      this.activeRequestKey = null;
    }
  }

  private isConfigured(): boolean {
    return Boolean(this.settings.apiBaseUrl && this.settings.apiKey && this.settings.modelId);
  }

  private async addToCanvas(text: string): Promise<void> {
    try {
      await appendToCanvas(this.app, this.settings.canvasPath, text);
      new Notice("Added to canvas.");
    } catch (error) {
      new Notice((error as Error)?.message || "Failed to add to canvas.");
    }
  }
}

function normalizeSelection(selection: string): string {
  return selection.replace(/\s+/g, " ").trim();
}

function classifySelection(selection: string, threshold: number): LookupMode {
  if (selection.includes("\n")) return "sentence";
  if (selection.length > threshold) return "sentence";
  if (selection.length > 12 && /[.?!。？！]/.test(selection)) return "sentence";
  return "word";
}

function cleanWordSelection(selection: string): string {
  return selection.replace(/^[\s.,?!:;"'()\[\]{}<>]+/, "").replace(/[\s.,?!:;"'()\[\]{}<>]+$/, "");
}

function tryParseJson(content: string): any | null {
  try {
    return JSON.parse(content);
  } catch {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(content.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeWordResult(parsed: any, fallbackSelection: string): WordCardData {
  const inflections = parsed?.inflections ?? {};
  return {
    lemma: parsed?.lemma || fallbackSelection,
    pos: parsed?.pos || "—",
    meaning_zh: parsed?.meaning_zh || parsed?.meaning_en || "—",
    inflections: {
      "3sg": inflections["3sg"] ?? "",
      past: inflections["past"] ?? "",
      pp: inflections["pp"] ?? "",
      ing: inflections["ing"] ?? "",
      plural: inflections["plural"] ?? "",
      comparative: inflections["comparative"] ?? "",
      superlative: inflections["superlative"] ?? ""
    }
  };
}

function normalizeSentenceResult(parsed: any): SentenceCardData {
  const issues = Array.isArray(parsed?.issues) ? parsed.issues : [];
  return {
    translation_zh: parsed?.translation_zh || parsed?.translation_en || "—",
    structure_zh: parsed?.structure_zh || parsed?.structure_en || "",
    selection: parsed?.selection || "",
    issues: issues
      .map((item: any) => ({
        issue: item?.issue || "",
        suggestion: item?.suggestion || ""
      }))
      .filter((item: { issue: string; suggestion: string }) => item.issue || item.suggestion)
  };
}

function buildWordCopy(data: WordCardData): string {
  const inflections = data.inflections ?? {};
  const parts = [
    `3sg ${inflections["3sg"] || "—"}`,
    `past ${inflections["past"] || "—"}`,
    `pp ${inflections["pp"] || "—"}`,
    `ing ${inflections["ing"] || "—"}`,
    `plural ${inflections["plural"] || "—"}`
  ];
  return `**${data.lemma}** (${data.pos}) — ${data.meaning_zh}\n变形: ${parts.join("; ")}`;
}

function buildWordCanvas(data: WordCardData): string {
  const inflections = data.inflections ?? {};
  return [
    `# ${data.lemma} (${data.pos})`,
    ``,
    `**Meaning**: ${data.meaning_zh}`,
    `**3sg** ${inflections["3sg"] || "—"}`,
    `**past** ${inflections["past"] || "—"}`,
    `**pp** ${inflections["pp"] || "—"}`,
    `**ing** ${inflections["ing"] || "—"}`,
    `**plural** ${inflections["plural"] || "—"}`
  ].join("\n");
}

function buildSentenceCanvas(data: SentenceCardData): string {
  const title = data.selection?.trim() || "Sentence";
  const lines = [
    `# ${title}`,
    ``,
    `**Translation**: ${data.translation_zh}`
  ];
  if (data.structure_zh) {
    lines.push(`**Structure**: ${data.structure_zh}`);
  }
  if (data.issues && data.issues.length > 0) {
    lines.push(``, `**Issues**:`);
    data.issues.forEach((issue) => {
      const left = issue.issue ? `Issue: ${issue.issue}` : "Issue: —";
      const right = issue.suggestion ? `Suggestion: ${issue.suggestion}` : "Suggestion: —";
      lines.push(`- ${left}`, `  - ${right}`);
    });
  }
  return lines.join("\n");
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}

function isAbortError(error: unknown): boolean {
  if (!error) return false;
  const name = (error as any).name ?? "";
  return name === "AbortError";
}

function isTimeoutError(error: unknown): boolean {
  const message = (error as any)?.message ?? "";
  return typeof message === "string" && message.toLowerCase().includes("timeout");
}

function getAnchorRect(view: EditorView): DOMRect {
  const selection = view.state.selection.main;
  const coords = view.coordsAtPos(selection.to);
  if (!coords) {
    return fallbackAnchorRect(view.dom.closest(".workspace") as HTMLElement | null);
  }
  return new DOMRect(coords.left, coords.top, coords.right - coords.left, coords.bottom - coords.top);
}

function fallbackAnchorRect(container?: HTMLElement | null): DOMRect {
  if (!container) {
    return new DOMRect(window.innerWidth / 2, window.innerHeight / 2, 1, 1);
  }
  const rect = container.getBoundingClientRect();
  return new DOMRect(rect.left + rect.width / 2, rect.top + rect.height / 2, 1, 1);
}

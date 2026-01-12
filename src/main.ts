import { MarkdownView, Notice, Plugin } from "obsidian";
import { EditorView } from "@codemirror/view";
import { selectionIconPlugin } from "./cm6/selectionIcon";
import { PdfSelectionIcon } from "./pdf/selectionIcon";
import { Popover, SentenceCardData, WordCardData } from "./ui/popover";
import { requestLookup, LookupMode } from "./llm";
import { appendToCanvas } from "./canvas";
import { setCssProps } from "./ui/css";
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

interface EditorWithCm {
  cm?: EditorView;
}

interface AppWithSetting {
  setting?: {
    open: () => void;
    openTabById: (id: string) => void;
  };
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
    this.applyTheme();

    this.registerEditorExtension(
      selectionIconPlugin({
        onTrigger: (selection, contextLine, anchorRect) => {
          void this.runLookup({ selection, contextLine, anchorRect }, null);
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
        void this.runLookup({ selection, contextLine: "", anchorRect }, null);
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
      name: "Smart lookup",
      editorCallback: (editor) => {
        const context = this.getContextFromEditor(editor.getSelection());
        if (!context) return;
        void this.runLookup(context, null);
      }
    });

    this.addCommand({
      id: "translate-selection",
      name: "Translate selection",
      editorCallback: (editor) => {
        const context = this.getContextFromEditor(editor.getSelection());
        if (!context) return;
        void this.runLookup(context, "sentence");
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

  private applyTheme(): void {
    setCssProps(document.documentElement, {
      "--sll-icon-bg": this.settings.iconBgColor || "#111111",
      "--sll-icon-text": this.settings.iconTextColor || "#f9f6e8",
      "--sll-icon-size": `${this.settings.iconSize || 13}px`,
      "--sll-pop-bg": this.settings.popoverBgColor || "#f9f6e8",
      "--sll-pop-text": this.settings.popoverTextColor || "#1e1e1e"
    });
  }

  private getContextFromEditor(selection: string): LookupContext | null {
    const normalized = normalizeSelection(selection);
    if (!normalized) {
      this.popover?.showError("No selection to look up.");
      return null;
    }

    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const editorView = activeView ? (activeView.editor as EditorWithCm).cm : undefined;
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
          label: "Open settings",
          onClick: () => {
            const setting = (this.app as AppWithSetting).setting;
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
      this.handleRequestError(error, () => {
        void this.runLookup(context, forceMode);
      }, context.anchorRect);
    }
  }

  private renderResult(mode: LookupMode, result: WordCardData | SentenceCardData, anchorRect: DOMRect): void {
    if (!this.popover) return;

    if (mode === "word") {
      const wordData = result as WordCardData;
      this.popover.showWordCard(wordData, anchorRect);
      this.popover.setCopyHandler(() => {
        void copyToClipboard(buildWordCopy(wordData));
      });
      this.popover.setAddHandler(() => {
        void this.addToCanvas(buildWordCanvas(wordData));
      });
    } else {
      const sentenceData = result as SentenceCardData;
      this.popover.showSentenceCard(sentenceData, anchorRect);
      this.popover.setCopyHandler(() => {
        void copyToClipboard(sentenceData.translation_zh);
      });
      this.popover.setAddHandler(() => {
        void this.addToCanvas(buildSentenceCanvas(sentenceData));
      });
    }
  }

  private showInvalidJson(raw: string, mode: LookupMode, anchorRect: DOMRect): void {
    if (!this.popover) return;
    this.popover.showError("Invalid JSON output.", [
      {
        label: "Copy raw output",
        onClick: () => {
          void copyToClipboard(raw);
        }
      },
      {
        label: "Restore default prompt",
        onClick: () => {
          void this.restoreDefaultPrompt(mode);
        },
        variant: "primary"
      }
    ], anchorRect);
  }

  private handleRequestError(error: unknown, retry: () => void, anchorRect: DOMRect): void {
    if (!this.popover) return;
    const status = getErrorStatus(error);
    if (status === 401 || status === 403) {
      this.popover.showError("Auth failed. Check your API key.", [
        { label: "Retry", onClick: retry, variant: "primary" }
      ], anchorRect);
      return;
    }
    const message = isTimeoutError(error) ? "Request timed out." : getErrorMessage(error) || "Request failed.";
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

  private async restoreDefaultPrompt(mode: LookupMode): Promise<void> {
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
  const trimChars = new Set([
    " ",
    "\n",
    "\r",
    "\t",
    ".",
    ",",
    "?",
    "!",
    ":",
    ";",
    "\"",
    "'",
    "(",
    ")",
    "[",
    "]",
    "{",
    "}",
    "<",
    ">"
  ]);
  let start = 0;
  let end = selection.length;
  while (start < end && trimChars.has(selection[start])) {
    start += 1;
  }
  while (end > start && trimChars.has(selection[end - 1])) {
    end -= 1;
  }
  return selection.slice(start, end);
}

function tryParseJson(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content);
    return isRecord(parsed) ? parsed : null;
  } catch {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      try {
        const parsed = JSON.parse(content.slice(start, end + 1));
        return isRecord(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeWordResult(parsed: Record<string, unknown>, fallbackSelection: string): WordCardData {
  const inflections = isRecord(parsed.inflections) ? parsed.inflections : {};
  const readInflection = (key: string) => {
    const value = inflections[key];
    return typeof value === "string" ? value : "";
  };
  return {
    lemma: readString(parsed, "lemma") || fallbackSelection,
    pos: readString(parsed, "pos") || "—",
    meaning_zh: readString(parsed, "meaning_zh") || readString(parsed, "meaning_en") || "—",
    inflections: {
      "3sg": readInflection("3sg"),
      past: readInflection("past"),
      pp: readInflection("pp"),
      ing: readInflection("ing"),
      plural: readInflection("plural"),
      comparative: readInflection("comparative"),
      superlative: readInflection("superlative")
    }
  };
}

function normalizeSentenceResult(parsed: Record<string, unknown>): SentenceCardData {
  const issues = Array.isArray(parsed.issues) ? parsed.issues : [];
  return {
    translation_zh: readString(parsed, "translation_zh") || readString(parsed, "translation_en") || "—",
    structure_zh: readString(parsed, "structure_zh") || readString(parsed, "structure_en") || "",
    selection: readString(parsed, "selection") || "",
    issues: issues
      .map((item) => {
        if (!isRecord(item)) return null;
        return {
          issue: readString(item, "issue") || "",
          suggestion: readString(item, "suggestion") || ""
        };
      })
      .filter((item): item is { issue: string; suggestion: string } => Boolean(item && (item.issue || item.suggestion)))
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
    new Notice("Copy failed. Use the context menu to copy.");
  }
}

function isAbortError(error: unknown): boolean {
  return getErrorName(error) === "AbortError";
}

function isTimeoutError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return typeof message === "string" && message.toLowerCase().includes("timeout");
}

function getErrorName(error: unknown): string {
  if (!isRecord(error)) return "";
  const name = error.name;
  return typeof name === "string" ? name : "";
}

function getErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (!isRecord(error)) return "";
  const message = error.message;
  return typeof message === "string" ? message : "";
}

function getErrorStatus(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  const status = error.status;
  if (typeof status === "number") return status;
  const response = error.response;
  if (isRecord(response) && typeof response.status === "number") return response.status;
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function getAnchorRect(view: EditorView): DOMRect {
  const selection = view.state.selection.main;
  const coords = view.coordsAtPos(selection.to);
  if (!coords) {
    const workspace = view.dom.closest(".workspace");
    return fallbackAnchorRect(workspace instanceof HTMLElement ? workspace : null);
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

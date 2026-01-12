import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import { testLlmConnection } from "./llm";

export const DEFAULT_WORD_PROMPT = `你是英语学习助手。请严格输出单个 JSON 对象，不要输出任何多余文本、不要 markdown。

JSON 字段：mode固定为"word"；selection；lemma；pos（仅一个最常用词性：verb/noun/adj/adv/phrase/other）；meaning_zh（中文最常用义，尽量短）；inflections（对象，可能字段：3sg/past/pp/ing/plural/comparative/superlative；不存在则用空字符串）。
`;

export const DEFAULT_WORD_USER_PROMPT = `Selected text: "{selection}"

Context (optional): "{contextLine}"

任务：给出 lemma、最常用词性、最常用中文义、常见词形变化。保持学习笔记风格，简短。`;

export const DEFAULT_WORD_PROMPT_EN = `You are an English learning assistant. Output a single JSON object only. No extra text, no markdown.

Fields: mode must be "word"; selection; lemma; pos (most common POS: verb/noun/adj/adv/phrase/other); meaning_en (short, most common meaning); inflections (object with possible keys: 3sg/past/pp/ing/plural/comparative/superlative; use empty string if not applicable).
`;

export const DEFAULT_WORD_USER_PROMPT_EN = `Selected text: "{selection}"

Context (optional): "{contextLine}"

Task: Provide lemma, most common POS, most common meaning in English, and common inflections. Keep it concise.`;

export const DEFAULT_SENTENCE_PROMPT = `你是英语学习助手。请严格输出单个 JSON 对象，不要输出任何多余文本、不要 markdown。

字段：mode固定为"sentence"；selection；translation_zh（简洁自然的中文翻译）；structure_zh（句子结构中文概述）；issues（数组，元素包含 issue 与 suggestion；如果没有问题返回空数组）。
`;

export const DEFAULT_SENTENCE_USER_PROMPT = `Selected text: "{selection}"

任务：翻译成中文，简洁自然；分析句子结构（中文概述即可）；检查是否有语法/用词问题，若有给出问题与更正建议，若没有则 issues 为空数组。`;

export const DEFAULT_SENTENCE_PROMPT_EN = `You are an English learning assistant. Output a single JSON object only. No extra text, no markdown.

Fields: mode must be "sentence"; selection; translation_en (natural English translation); structure_en (short structure analysis); issues (array of objects with issue and suggestion; empty array if no issues).
`;

export const DEFAULT_SENTENCE_USER_PROMPT_EN = `Selected text: "{selection}"

Task: Translate into natural English; summarize structure; check for grammar/usage issues. If none, return an empty issues array.`;

export interface SelectionLookupSettings {
  apiBaseUrl: string;
  apiKey: string;
  modelId: string;
  wordSystemPrompt: string;
  wordUserPrompt: string;
  sentenceSystemPrompt: string;
  sentenceUserPrompt: string;
  sentenceLengthThreshold: number;
  enableResponseFormat: boolean;
  canvasPath: string;
  language: "zh" | "en";
  iconText: string;
  iconSize: number;
  iconBgColor: string;
  iconTextColor: string;
  popoverBgColor: string;
  popoverTextColor: string;
}

export const DEFAULT_SETTINGS: SelectionLookupSettings = {
  apiBaseUrl: "",
  apiKey: "",
  modelId: "",
  wordSystemPrompt: DEFAULT_WORD_PROMPT,
  wordUserPrompt: DEFAULT_WORD_USER_PROMPT,
  sentenceSystemPrompt: DEFAULT_SENTENCE_PROMPT,
  sentenceUserPrompt: DEFAULT_SENTENCE_USER_PROMPT,
  sentenceLengthThreshold: 28,
  enableResponseFormat: true,
  canvasPath: "TrickyWords.canvas",
  language: "zh",
  iconText: "🤔",
  iconSize: 13,
  iconBgColor: "#111111",
  iconTextColor: "#f9f6e8",
  popoverBgColor: "#f9f6e8",
  popoverTextColor: "#1e1e1e"
};

export class SelectionLookupSettingTab extends PluginSettingTab {
  private readonly plugin: Plugin & { settings: SelectionLookupSettings; saveSettings: () => Promise<void> };

  constructor(app: App, plugin: Plugin & { settings: SelectionLookupSettings; saveSettings: () => Promise<void> }) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const t = getLabels(this.plugin.settings.language);
    new Setting(containerEl).setName(t.title).setHeading();

    new Setting(containerEl)
      .setName(t.apiBaseUrl.name)
      .setDesc(t.apiBaseUrl.desc)
      .addText((text) =>
        text
          .setPlaceholder("https://api.openai.com")
          .setValue(this.plugin.settings.apiBaseUrl)
          .onChange((value) => {
            this.plugin.settings.apiBaseUrl = value.trim();
            void this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t.apiKey.name)
      .setDesc(t.apiKey.desc)
      .addText((text) =>
        text
          .setPlaceholder("Example: sk-...")
          .setValue(this.plugin.settings.apiKey)
          .onChange((value) => {
            this.plugin.settings.apiKey = value.trim();
            void this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t.modelId.name)
      .setDesc(t.modelId.desc)
      .addText((text) =>
        text
          .setPlaceholder("Example: gpt-4o-mini")
          .setValue(this.plugin.settings.modelId)
          .onChange((value) => {
            this.plugin.settings.modelId = value.trim();
            void this.plugin.saveSettings();
          })
      );

    let statusRow: HTMLDivElement;
    let statusIcon: HTMLSpanElement;
    let statusText: HTMLSpanElement;
    let errorBox: HTMLDivElement;

    const testSetting = new Setting(containerEl)
      .setName(t.testConnection.name)
      .setDesc(t.testConnection.desc)
      .addButton((button) => {
        button.setButtonText(t.testConnection.button);
        button.onClick(() => {
          if (!statusRow || !statusIcon || !statusText || !errorBox) return;
          void this.runConnectionTest(button, statusRow, statusIcon, statusText, errorBox);
        });
      });

    statusRow = testSetting.settingEl.createDiv("sll-test-status-row sll-hidden");
    statusIcon = statusRow.createSpan("sll-test-status-icon");
    statusText = statusRow.createSpan("sll-test-status-text");
    errorBox = testSetting.settingEl.createDiv("sll-test-error sll-hidden");

    new Setting(containerEl)
      .setName(t.sentenceThreshold.name)
      .setDesc(t.sentenceThreshold.desc)
      .addText((text) =>
        text
          .setPlaceholder("28")
          .setValue(String(this.plugin.settings.sentenceLengthThreshold))
          .onChange((value) => {
            const parsed = Number.parseInt(value, 10);
            this.plugin.settings.sentenceLengthThreshold = Number.isFinite(parsed) ? parsed : 28;
            void this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t.language.name)
      .setDesc(t.language.desc)
      .addDropdown((dropdown) =>
        dropdown
          .addOption("zh", t.language.zh)
          .addOption("en", t.language.en)
          .setValue(this.plugin.settings.language)
          .onChange((value: string) => {
            this.plugin.settings.language = value === "en" ? "en" : "zh";
            void this.plugin.saveSettings();
            this.display();
          })
      );

    new Setting(containerEl)
      .setName(t.iconText.name)
      .setDesc(t.iconText.desc)
      .addText((text) =>
        text
          .setPlaceholder("🤔")
          .setValue(this.plugin.settings.iconText)
          .onChange((value) => {
            this.plugin.settings.iconText = value.trim() || "🤔";
            void this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t.iconSize.name)
      .setDesc(t.iconSize.desc)
      .addText((text) =>
        text
          .setPlaceholder("13")
          .setValue(String(this.plugin.settings.iconSize))
          .onChange((value) => {
            const parsed = Number.parseInt(value, 10);
            this.plugin.settings.iconSize = Number.isFinite(parsed) ? parsed : 13;
            void this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t.iconBgColor.name)
      .setDesc(t.iconBgColor.desc)
      .addText((text) =>
        text
          .setPlaceholder("#111111")
          .setValue(this.plugin.settings.iconBgColor)
          .onChange((value) => {
            this.plugin.settings.iconBgColor = value.trim();
            void this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t.iconTextColor.name)
      .setDesc(t.iconTextColor.desc)
      .addText((text) =>
        text
          .setPlaceholder("#f9f6e8")
          .setValue(this.plugin.settings.iconTextColor)
          .onChange((value) => {
            this.plugin.settings.iconTextColor = value.trim();
            void this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t.popoverBgColor.name)
      .setDesc(t.popoverBgColor.desc)
      .addText((text) =>
        text
          .setPlaceholder("#f9f6e8")
          .setValue(this.plugin.settings.popoverBgColor)
          .onChange((value) => {
            this.plugin.settings.popoverBgColor = value.trim();
            void this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t.popoverTextColor.name)
      .setDesc(t.popoverTextColor.desc)
      .addText((text) =>
        text
          .setPlaceholder("#1e1e1e")
          .setValue(this.plugin.settings.popoverTextColor)
          .onChange((value) => {
            this.plugin.settings.popoverTextColor = value.trim();
            void this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t.canvasPath.name)
      .setDesc(t.canvasPath.desc)
      .addText((text) =>
        text
          .setPlaceholder("Example: TrickyWords.canvas")
          .setValue(this.plugin.settings.canvasPath)
          .onChange((value) => {
            this.plugin.settings.canvasPath = value.trim();
            void this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t.responseFormat.name)
      .setDesc(t.responseFormat.desc)
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableResponseFormat).onChange((value) => {
          this.plugin.settings.enableResponseFormat = value;
          void this.plugin.saveSettings();
        })
      );

    new Setting(containerEl).setName(t.wordPrompt.title).setHeading();
    new Setting(containerEl)
      .setName(t.wordPrompt.system)
      .addTextArea((text) =>
        text
          .setValue(this.plugin.settings.wordSystemPrompt)
          .onChange((value) => {
            this.plugin.settings.wordSystemPrompt = value;
            void this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t.wordPrompt.user)
      .addTextArea((text) =>
        text
          .setValue(this.plugin.settings.wordUserPrompt)
          .onChange((value) => {
            this.plugin.settings.wordUserPrompt = value;
            void this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .addButton((button) =>
        button.setButtonText(t.wordPrompt.restore).onClick(() => {
          if (this.plugin.settings.language === "en") {
            this.plugin.settings.wordSystemPrompt = DEFAULT_WORD_PROMPT_EN;
            this.plugin.settings.wordUserPrompt = DEFAULT_WORD_USER_PROMPT_EN;
          } else {
            this.plugin.settings.wordSystemPrompt = DEFAULT_WORD_PROMPT;
            this.plugin.settings.wordUserPrompt = DEFAULT_WORD_USER_PROMPT;
          }
          void this.plugin.saveSettings();
          this.display();
        })
      );

    new Setting(containerEl).setName(t.sentencePrompt.title).setHeading();
    new Setting(containerEl)
      .setName(t.sentencePrompt.system)
      .addTextArea((text) =>
        text
          .setValue(this.plugin.settings.sentenceSystemPrompt)
          .onChange((value) => {
            this.plugin.settings.sentenceSystemPrompt = value;
            void this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t.sentencePrompt.user)
      .addTextArea((text) =>
        text
          .setValue(this.plugin.settings.sentenceUserPrompt)
          .onChange((value) => {
            this.plugin.settings.sentenceUserPrompt = value;
            void this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .addButton((button) =>
        button.setButtonText(t.sentencePrompt.restore).onClick(() => {
          if (this.plugin.settings.language === "en") {
            this.plugin.settings.sentenceSystemPrompt = DEFAULT_SENTENCE_PROMPT_EN;
            this.plugin.settings.sentenceUserPrompt = DEFAULT_SENTENCE_USER_PROMPT_EN;
          } else {
            this.plugin.settings.sentenceSystemPrompt = DEFAULT_SENTENCE_PROMPT;
            this.plugin.settings.sentenceUserPrompt = DEFAULT_SENTENCE_USER_PROMPT;
          }
          void this.plugin.saveSettings();
          this.display();
        })
      );
  }

  private async runConnectionTest(
    button: { setDisabled: (disabled: boolean) => void; setButtonText: (text: string) => void },
    statusRow: HTMLDivElement,
    statusIcon: HTMLSpanElement,
    statusText: HTMLSpanElement,
    errorBox: HTMLDivElement
  ): Promise<void> {
    const t = getLabels(this.plugin.settings.language).testConnection;
    button.setDisabled(true);
    button.setButtonText(t.testingButton);
    statusRow.classList.remove("sll-hidden", "sll-test-status--ok", "sll-test-status--error");
    statusRow.classList.add("sll-test-status--ok");
    statusText.textContent = t.testingStatus;
    errorBox.classList.add("sll-hidden");
    errorBox.textContent = "";

    if (!this.plugin.settings.apiBaseUrl || !this.plugin.settings.apiKey || !this.plugin.settings.modelId) {
      statusRow.classList.remove("sll-test-status--ok", "sll-test-status--error");
      statusRow.classList.add("sll-test-status--error");
      statusText.textContent = t.failedStatus;
      errorBox.textContent = t.missingConfig;
      errorBox.classList.remove("sll-hidden");
      button.setDisabled(false);
      button.setButtonText(t.button);
      return;
    }

    const result = await testLlmConnection({
      baseUrl: this.plugin.settings.apiBaseUrl,
      apiKey: this.plugin.settings.apiKey,
      modelId: this.plugin.settings.modelId
    });

    statusRow.classList.remove("sll-test-status--ok", "sll-test-status--error");
    if (result.ok) {
      statusRow.classList.add("sll-test-status--ok");
      statusText.textContent = t.okStatus;
    } else {
      statusRow.classList.add("sll-test-status--error");
      statusText.textContent = t.failedStatus;
      errorBox.textContent = result.message;
      errorBox.classList.remove("sll-hidden");
    }

    button.setDisabled(false);
    button.setButtonText(t.button);
  }
}

function getLabels(language: "zh" | "en") {
  if (language === "en") {
    return {
      title: "TapGloss settings",
      apiBaseUrl: {
        name: "API base URL",
        desc: "OpenAI-compatible base URL, e.g. https://api.openai.com or http://localhost:11434"
      },
      apiKey: { name: "API key", desc: "Stored in plaintext in Obsidian settings." },
      modelId: { name: "Model ID", desc: "Example: gpt-4o-mini" },
      sentenceThreshold: {
        name: "Sentence length threshold",
        desc: "Selections longer than this will be treated as sentences."
      },
      language: {
        name: "Language",
        desc: "Controls UI labels and default prompts.",
        zh: "Chinese",
        en: "English"
      },
      iconText: { name: "Icon text", desc: "Text or emoji shown on the selection icon." },
      iconSize: { name: "Icon size", desc: "Icon font size in px." },
      iconBgColor: { name: "Icon background color", desc: "Background color for the selection icon." },
      iconTextColor: { name: "Icon text color", desc: "Text color for the selection icon." },
      popoverBgColor: { name: "Popover background color", desc: "Background color for the popover." },
      popoverTextColor: { name: "Popover text color", desc: "Text color for the popover." },
      canvasPath: {
        name: "Canvas path",
        desc: "Default .canvas file for saving cards (e.g. TrickyWords.canvas)."
      },
      responseFormat: {
        name: "Enable response_format (JSON)",
        desc: "If unsupported by the API, the plugin will auto-fallback."
      },
      testConnection: {
        name: "Test connection",
        desc: "Send a short request to verify the configuration.",
        button: "Test connection",
        testingButton: "Testing...",
        testingStatus: "Testing connection...",
        okStatus: "Connection ok.",
        failedStatus: "Connection failed.",
        missingConfig: "Fill in the base URL, API key, and model ID."
      },
      wordPrompt: {
        title: "Word prompt",
        system: "System prompt",
        user: "User prompt",
        restore: "Restore default word prompts"
      },
      sentencePrompt: {
        title: "Sentence prompt",
        system: "System prompt",
        user: "User prompt",
        restore: "Restore default sentence prompts"
      }
    };
  }

  return {
    title: "TapGloss 设置",
    apiBaseUrl: { name: "API base URL", desc: "OpenAI 兼容地址，例如 https://api.openai.com 或 https://api.moonshot.cn/v1" },
    apiKey: { name: "API key", desc: "明文存储在 Obsidian 设置中。" },
    modelId: { name: "Model ID", desc: "例如：gpt-4o-mini" },
    sentenceThreshold: { name: "句子判定阈值", desc: "选中文本长度超过阈值将被视为句子。" },
    language: { name: "语言", desc: "控制界面文案与默认提示词。", zh: "中文", en: "英文" },
    iconText: { name: "图标文本", desc: "选区图标显示的文字或 emoji。" },
    iconSize: { name: "图标大小", desc: "图标字体大小（px）。" },
    iconBgColor: { name: "图标背景色", desc: "选区图标的背景颜色。" },
    iconTextColor: { name: "图标文字色", desc: "选区图标的文字颜色。" },
    popoverBgColor: { name: "气泡背景色", desc: "气泡的背景颜色。" },
    popoverTextColor: { name: "气泡文字色", desc: "气泡的文字颜色。" },
    canvasPath: { name: "Canvas 路径", desc: "保存卡片的默认 .canvas 文件（如 TrickyWords.canvas）。" },
    responseFormat: { name: "启用 response_format (JSON)", desc: "若 API 不支持，将自动回退。" },
    testConnection: {
      name: "测试连接",
      desc: "发送一个短请求以验证配置是否可用。",
      button: "测试连接",
      testingButton: "正在测试...",
      testingStatus: "正在测试连接...",
      okStatus: "连接成功。",
      failedStatus: "连接失败。",
      missingConfig: "请填写 API Base URL、API Key 和 Model ID。"
    },
    wordPrompt: { title: "单词提示词", system: "System prompt", user: "User prompt", restore: "恢复默认单词提示词" },
    sentencePrompt: { title: "句子提示词", system: "System prompt", user: "User prompt", restore: "恢复默认句子提示词" }
  };
}

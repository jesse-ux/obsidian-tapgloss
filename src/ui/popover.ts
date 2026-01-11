export interface WordCardData {
  lemma: string;
  pos: string;
  meaning_zh: string;
  inflections: Record<string, string>;
}

export interface SentenceCardData {
  translation_zh: string;
  structure_zh?: string;
  issues?: Array<{ issue: string; suggestion: string }>;
  selection?: string;
}

export interface PopoverAction {
  label: string;
  onClick: () => void;
  variant?: "primary" | "danger";
}

export class Popover {
  private container: HTMLDivElement | null = null;
  private onClose?: () => void;
  private anchorRect: DOMRect | null = null;
  private copyHandler: (() => void) | null = null;
  private addHandler: (() => void) | null = null;
  private boundOutsideClick = this.handleOutsideClick.bind(this);
  private boundKeydown = this.handleKeydown.bind(this);

  constructor(onClose?: () => void) {
    this.onClose = onClose;
  }

  showLoading(anchorRect: DOMRect): void {
    this.anchorRect = anchorRect;
    this.render(`
      <div class="sll-popover-header">Loading…</div>
      <div class="sll-popover-body sll-popover-muted">Fetching response</div>
      <div class="sll-popover-footer">
        <button class="sll-btn" data-action="close">Close</button>
      </div>
    `);
  }

  showWordCard(data: WordCardData, anchorRect: DOMRect): void {
    this.anchorRect = anchorRect;
    this.copyHandler = null;
    this.addHandler = null;
    const inflections = data.inflections ?? {};
    const rows = [
      ["3sg", inflections["3sg"]],
      ["past", inflections["past"]],
      ["pp", inflections["pp"]],
      ["ing", inflections["ing"]],
      ["plural", inflections["plural"]],
      ["comparative", inflections["comparative"]],
      ["superlative", inflections["superlative"]]
    ];

    const tableRows = rows
      .map(([label, value]) => {
        const display = value && value.length > 0 ? value : "—";
        return `<tr><td>${label}</td><td>${display}</td></tr>`;
      })
      .join("");

    this.render(`
      <div class="sll-popover-header">${escapeHtml(data.lemma)} (${escapeHtml(data.pos)})</div>
      <div class="sll-popover-body">
        <div class="sll-popover-meaning">${escapeHtml(data.meaning_zh)}</div>
        <table class="sll-inflections">
          <tbody>
            ${tableRows}
          </tbody>
        </table>
      </div>
      <div class="sll-popover-footer">
        <button class="sll-btn" data-action="add">Add to Canvas</button>
        <button class="sll-btn sll-btn-primary" data-action="copy">Copy</button>
        <button class="sll-btn" data-action="close">Close</button>
      </div>
    `);
  }

  showSentenceCard(data: SentenceCardData, anchorRect: DOMRect): void {
    this.anchorRect = anchorRect;
    this.copyHandler = null;
    this.addHandler = null;
    const structureBlock = data.structure_zh
      ? `<div class="sll-popover-section"><div class="sll-popover-label">Structure</div><div>${escapeHtml(
          data.structure_zh
        )}</div></div>`
      : "";
    const issues = data.issues ?? [];
    const issuesBlock =
      issues.length > 0
        ? `<div class="sll-popover-section"><div class="sll-popover-label">Issues</div>${issues
            .map(
              (item) =>
                `<div class="sll-issue"><div class="sll-issue-title">${escapeHtml(
                  item.issue
                )}</div><div class="sll-issue-suggestion">${escapeHtml(item.suggestion)}</div></div>`
            )
            .join("")}</div>`
        : "";
    this.render(`
      <div class="sll-popover-header">Translation</div>
      <div class="sll-popover-body">
        <div class="sll-popover-meaning">${escapeHtml(data.translation_zh)}</div>
        ${structureBlock}
        ${issuesBlock}
      </div>
      <div class="sll-popover-footer">
        <button class="sll-btn" data-action="add">Add to Canvas</button>
        <button class="sll-btn sll-btn-primary" data-action="copy">Copy</button>
        <button class="sll-btn" data-action="close">Close</button>
      </div>
    `);
  }

  showError(message: string, actions: PopoverAction[] = [], anchorRect?: DOMRect): void {
    if (anchorRect) {
      this.anchorRect = anchorRect;
    }
    this.copyHandler = null;
    this.addHandler = null;
    const actionButtons = actions
      .map((action, index) => {
        const classes = ["sll-btn", action.variant === "danger" ? "sll-btn-danger" : ""]
          .filter(Boolean)
          .join(" ");
        return `<button class="${classes}" data-action="custom-${index}">${escapeHtml(action.label)}</button>`;
      })
      .join("");

    this.render(`
      <div class="sll-popover-header">Error</div>
      <div class="sll-popover-body sll-popover-muted">${escapeHtml(message)}</div>
      <div class="sll-popover-footer">
        ${actionButtons}
        <button class="sll-btn" data-action="close">Close</button>
      </div>
    `);

    actions.forEach((action, index) => {
      const button = this.container?.querySelector(`[data-action="custom-${index}"]`);
      button?.addEventListener("click", () => action.onClick());
    });
  }

  close(): void {
    if (!this.container) return;
    this.container.remove();
    this.container = null;
    document.removeEventListener("mousedown", this.boundOutsideClick, true);
    document.removeEventListener("keydown", this.boundKeydown);
    this.onClose?.();
  }

  private render(html: string): void {
    if (!this.container) {
      this.container = document.createElement("div");
      this.container.className = "sll-popover";
      document.body.appendChild(this.container);
      document.addEventListener("mousedown", this.boundOutsideClick, true);
      document.addEventListener("keydown", this.boundKeydown);
    }

    this.container.innerHTML = html;
    this.container.querySelectorAll("[data-action='copy']").forEach((el) => {
      el.addEventListener("click", () => this.copyHandler?.());
    });
    this.container.querySelectorAll("[data-action='add']").forEach((el) => {
      el.addEventListener("click", () => this.addHandler?.());
    });
    this.container.querySelectorAll("[data-action='close']").forEach((el) => {
      el.addEventListener("click", () => this.close());
    });

    this.position();
  }

  setCopyHandler(handler: () => void): void {
    this.copyHandler = handler;
  }

  setAddHandler(handler: () => void): void {
    this.addHandler = handler;
  }

  private position(): void {
    if (!this.container || !this.anchorRect) return;

    const { innerWidth, innerHeight } = window;
    this.container.style.visibility = "hidden";
    this.container.style.top = "0px";
    this.container.style.left = "0px";

    requestAnimationFrame(() => {
      if (!this.container || !this.anchorRect) return;
      const rect = this.container.getBoundingClientRect();
      let top = this.anchorRect.bottom + 8;
      let left = this.anchorRect.left;

      if (left + rect.width > innerWidth - 8) {
        left = Math.max(8, innerWidth - rect.width - 8);
      }

      if (top + rect.height > innerHeight - 8) {
        top = Math.max(8, this.anchorRect.top - rect.height - 8);
      }

      this.container.style.left = `${left}px`;
      this.container.style.top = `${top}px`;
      this.container.style.visibility = "visible";
    });
  }

  private handleOutsideClick(event: MouseEvent): void {
    if (!this.container) return;
    if (event.target instanceof Node && !this.container.contains(event.target)) {
      this.close();
    }
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      this.close();
    }
  }
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

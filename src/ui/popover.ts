import { setCssProps } from "./css";

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
    const header = this.createDiv("sll-popover-header", "Loading...");
    const body = this.createDiv("sll-popover-body sll-popover-muted", "Fetching response...");
    const footer = this.createDiv("sll-popover-footer");
    footer.appendChild(this.createButton("Close", "sll-btn", () => this.close()));
    this.render([header, body, footer]);
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

    const header = this.createDiv("sll-popover-header", `${data.lemma} (${data.pos})`);
    const body = this.createDiv("sll-popover-body");
    const meaning = this.createDiv("sll-popover-meaning", data.meaning_zh);
    const table = document.createElement("table");
    table.className = "sll-inflections";
    const tbody = document.createElement("tbody");
    rows.forEach(([label, value]) => {
      const display = value && value.length > 0 ? value : "—";
      const row = document.createElement("tr");
      const labelCell = document.createElement("td");
      labelCell.textContent = label;
      const valueCell = document.createElement("td");
      valueCell.textContent = display;
      row.appendChild(labelCell);
      row.appendChild(valueCell);
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    body.appendChild(meaning);
    body.appendChild(table);

    const footer = this.createDiv("sll-popover-footer");
    footer.appendChild(this.createButton("Add to canvas", "sll-btn", () => this.addHandler?.()));
    footer.appendChild(this.createButton("Copy", "sll-btn sll-btn-primary", () => this.copyHandler?.()));
    footer.appendChild(this.createButton("Close", "sll-btn", () => this.close()));
    this.render([header, body, footer]);
  }

  showSentenceCard(data: SentenceCardData, anchorRect: DOMRect): void {
    this.anchorRect = anchorRect;
    this.copyHandler = null;
    this.addHandler = null;
    const issues = data.issues ?? [];
    const header = this.createDiv("sll-popover-header", "Translation");
    const body = this.createDiv("sll-popover-body");
    const meaning = this.createDiv("sll-popover-meaning", data.translation_zh);
    body.appendChild(meaning);

    if (data.structure_zh) {
      const section = this.createDiv("sll-popover-section");
      section.appendChild(this.createDiv("sll-popover-label", "Structure"));
      section.appendChild(this.createDiv("", data.structure_zh));
      body.appendChild(section);
    }

    if (issues.length > 0) {
      const issuesSection = this.createDiv("sll-popover-section");
      issuesSection.appendChild(this.createDiv("sll-popover-label", "Issues"));
      issues.forEach((item) => {
        const issue = this.createDiv("sll-issue");
        issue.appendChild(this.createDiv("sll-issue-title", item.issue));
        issue.appendChild(this.createDiv("sll-issue-suggestion", item.suggestion));
        issuesSection.appendChild(issue);
      });
      body.appendChild(issuesSection);
    }

    const footer = this.createDiv("sll-popover-footer");
    footer.appendChild(this.createButton("Add to canvas", "sll-btn", () => this.addHandler?.()));
    footer.appendChild(this.createButton("Copy", "sll-btn sll-btn-primary", () => this.copyHandler?.()));
    footer.appendChild(this.createButton("Close", "sll-btn", () => this.close()));
    this.render([header, body, footer]);
  }

  showError(message: string, actions: PopoverAction[] = [], anchorRect?: DOMRect): void {
    if (anchorRect) {
      this.anchorRect = anchorRect;
    }
    this.copyHandler = null;
    this.addHandler = null;
    const header = this.createDiv("sll-popover-header", "Error");
    const body = this.createDiv("sll-popover-body sll-popover-muted", message);
    const footer = this.createDiv("sll-popover-footer");
    actions.forEach((action) => {
      const classes = ["sll-btn", action.variant === "danger" ? "sll-btn-danger" : ""]
        .filter(Boolean)
        .join(" ");
      footer.appendChild(
        this.createButton(action.label, classes, () => {
          void action.onClick();
        })
      );
    });
    footer.appendChild(this.createButton("Close", "sll-btn", () => this.close()));
    this.render([header, body, footer]);
  }

  close(): void {
    if (!this.container) return;
    this.container.remove();
    this.container = null;
    document.removeEventListener("mousedown", this.boundOutsideClick, true);
    document.removeEventListener("keydown", this.boundKeydown);
    this.onClose?.();
  }

  private render(nodes: Node[]): void {
    const container = this.ensureContainer();
    container.replaceChildren(...nodes);
    this.position();
  }

  private ensureContainer(): HTMLDivElement {
    if (!this.container) {
      this.container = document.createElement("div");
      this.container.className = "sll-popover";
      document.body.appendChild(this.container);
      document.addEventListener("mousedown", this.boundOutsideClick, true);
      document.addEventListener("keydown", this.boundKeydown);
    }
    return this.container;
  }

  private createDiv(className: string, text?: string): HTMLDivElement {
    const div = document.createElement("div");
    if (className) {
      div.className = className;
    }
    if (typeof text === "string") {
      div.textContent = text;
    }
    return div;
  }

  private createButton(label: string, className: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", () => {
      void onClick();
    });
    return button;
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
    this.container.classList.add("sll-invisible");
    setCssProps(this.container, {
      "--sll-left": "0px",
      "--sll-top": "0px"
    });

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

      setCssProps(this.container, {
        "--sll-left": `${left}px`,
        "--sll-top": `${top}px`
      });
      this.container.classList.remove("sll-invisible");
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

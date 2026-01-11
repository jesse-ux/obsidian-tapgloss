import { App } from "obsidian";

export interface PdfSelectionIconCallbacks {
  onTrigger: (selection: string, anchorRect: DOMRect) => void;
  onSelectionChange: (selection: string) => void;
  getIconText: () => string;
}

export class PdfSelectionIcon {
  private icon: HTMLDivElement;
  private debounceHandle: number | null = null;
  private lastSelection = "";
  private lastAnchorRect: DOMRect | null = null;
  private boundSelectionChange = this.handleSelectionChange.bind(this);
  private boundMouseUp = this.handleSelectionChange.bind(this);
  private boundBlur = this.handleBlur.bind(this);

  constructor(private app: App, private callbacks: PdfSelectionIconCallbacks) {
    this.icon = document.createElement("div");
    this.icon.className = "sll-selection-icon";
    this.icon.textContent = this.callbacks.getIconText();
    this.icon.style.display = "none";

    this.icon.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });

    this.icon.addEventListener("click", () => {
      const selection = this.getSelectionText();
      if (!selection) return;
      const anchorRect = this.lastAnchorRect ?? this.buildAnchorRect();
      if (!anchorRect) return;
      this.hide();
      this.callbacks.onTrigger(selection, anchorRect);
    });
  }

  start(): void {
    document.body.appendChild(this.icon);
    document.addEventListener("selectionchange", this.boundSelectionChange);
    document.addEventListener("mouseup", this.boundMouseUp);
    window.addEventListener("blur", this.boundBlur);
  }

  stop(): void {
    this.clearDebounce();
    document.removeEventListener("selectionchange", this.boundSelectionChange);
    document.removeEventListener("mouseup", this.boundMouseUp);
    window.removeEventListener("blur", this.boundBlur);
    this.icon.remove();
  }

  private handleBlur(): void {
    this.hide();
  }

  private handleSelectionChange(): void {
    this.clearDebounce();
    this.debounceHandle = window.setTimeout(() => {
      if (!this.isPdfActive()) {
        this.hide();
        return;
      }
      const selection = this.getSelectionText();
      this.icon.textContent = this.callbacks.getIconText();
      this.callbacks.onSelectionChange(selection);
      if (!selection) {
        this.hide();
        return;
      }
      if (selection !== this.lastSelection) {
        this.lastSelection = selection;
        this.lastAnchorRect = this.buildAnchorRect();
      }
      this.show();
      this.positionIcon();
    }, 200);
  }

  private clearDebounce(): void {
    if (this.debounceHandle !== null) {
      window.clearTimeout(this.debounceHandle);
      this.debounceHandle = null;
    }
  }

  private isPdfActive(): boolean {
    const leaf = this.app.workspace.getMostRecentLeaf();
    return leaf?.view?.getViewType?.() === "pdf";
  }

  private getSelectionText(): string {
    const selection = window.getSelection();
    if (!selection) return "";
    const text = selection.toString().trim();
    return text.length > 0 ? text : "";
  }

  private buildAnchorRect(): DOMRect | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      const rects = range.getClientRects();
      if (rects.length > 0) {
        return rects[0];
      }
    }
    return rect;
  }

  private show(): void {
    this.icon.style.display = "flex";
  }

  private hide(): void {
    this.icon.style.display = "none";
  }

  private positionIcon(): void {
    const anchorRect = this.lastAnchorRect ?? this.buildAnchorRect();
    if (!anchorRect) return;

    this.icon.style.visibility = "hidden";
    this.icon.style.left = "0px";
    this.icon.style.top = "0px";

    requestAnimationFrame(() => {
      const rect = this.icon.getBoundingClientRect();
      let left = anchorRect.right + 6;
      let top = anchorRect.top - rect.height - 6;

      const maxLeft = window.innerWidth - rect.width - 8;
      const maxTop = window.innerHeight - rect.height - 8;

      if (left > maxLeft) {
        left = Math.max(8, anchorRect.left - rect.width - 6);
      }
      if (top < 8) {
        top = Math.min(maxTop, anchorRect.bottom + 6);
      }

      this.icon.style.left = `${Math.max(8, Math.min(left, maxLeft))}px`;
      this.icon.style.top = `${Math.max(8, Math.min(top, maxTop))}px`;
      this.icon.style.visibility = "visible";
    });
  }
}

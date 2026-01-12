import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { setCssProps } from "../ui/css";

const HIDDEN_CLASS = "sll-hidden";
const INVISIBLE_CLASS = "sll-invisible";

export interface SelectionIconCallbacks {
  onTrigger: (selection: string, contextLine: string, anchorRect: DOMRect) => void;
  onSelectionChange: (selection: string) => void;
  getIconText: () => string;
}

export function selectionIconPlugin(callbacks: SelectionIconCallbacks) {
  return ViewPlugin.fromClass(
    class {
      private view: EditorView;
      private icon: HTMLDivElement;
      private debounceHandle: number | null = null;
      private lastSelection = "";
      private lastSelectionText = "";
      private lastContextLine = "";
      private lastAnchorRect: DOMRect | null = null;
      private isFocused = true;
      private boundBlur = this.handleBlur.bind(this);
      private boundFocus = this.handleFocus.bind(this);

      constructor(view: EditorView) {
        this.view = view;
        this.icon = document.createElement("div");
        this.icon.className = `sll-selection-icon ${HIDDEN_CLASS}`;
        this.icon.textContent = callbacks.getIconText();
        document.body.appendChild(this.icon);

        this.icon.addEventListener("mousedown", (event) => {
          event.preventDefault();
          event.stopPropagation();
        });

        this.icon.addEventListener("click", () => {
          const selection = this.getSelectionText() || this.lastSelectionText;
          if (!selection) return;
          const anchorRect = this.lastAnchorRect ?? this.buildAnchorRect();
          if (!anchorRect) return;
          const contextLine = this.lastContextLine || this.getContextLine();
          this.hide();
          callbacks.onTrigger(selection, contextLine, anchorRect);
        });

        this.view.dom.addEventListener("blur", this.boundBlur, true);
        this.view.dom.addEventListener("focus", this.boundFocus, true);

        this.scheduleUpdate();
      }

      update(update: ViewUpdate): void {
        if (update.selectionSet || update.docChanged || update.viewportChanged) {
          this.scheduleUpdate();
        }
      }

      destroy(): void {
        this.clearDebounce();
        this.icon.remove();
        this.view.dom.removeEventListener("blur", this.boundBlur, true);
        this.view.dom.removeEventListener("focus", this.boundFocus, true);
      }

      private handleBlur(): void {
        this.isFocused = false;
        this.hide();
      }

      private handleFocus(): void {
        this.isFocused = true;
        this.scheduleUpdate();
      }

      private scheduleUpdate(): void {
        this.clearDebounce();
        this.debounceHandle = window.setTimeout(() => {
          const selection = this.getSelectionText();
          const contextLine = this.getContextLine();
          callbacks.onSelectionChange(selection);
          this.icon.textContent = callbacks.getIconText();
          if (!this.isFocused || !selection) {
            this.hide();
            return;
          }
          if (isImageSelection(selection, contextLine)) {
            this.hide();
            return;
          }
          if (selection === this.lastSelection && !this.icon.classList.contains(HIDDEN_CLASS)) {
            this.positionIcon();
            return;
          }
          this.lastSelection = selection;
          this.lastSelectionText = selection;
          this.lastContextLine = contextLine;
          this.lastAnchorRect = this.buildAnchorRect();
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

      private getSelectionText(): string {
        const selection = this.view.state.selection.main;
        if (selection.empty) return "";
        const text = this.view.state.sliceDoc(selection.from, selection.to).trim();
        return text.length > 0 ? text : "";
      }

      private show(): void {
        this.icon.classList.remove(HIDDEN_CLASS);
      }

      private hide(): void {
        this.icon.classList.add(HIDDEN_CLASS);
      }

      private positionIcon(): void {
        const selection = this.view.state.selection.main;
        const coords = this.view.coordsAtPos(selection.to);
        if (!coords) return;

        this.icon.classList.remove(HIDDEN_CLASS);
        this.icon.classList.add(INVISIBLE_CLASS);
        setCssProps(this.icon, {
          "--sll-left": "0px",
          "--sll-top": "0px"
        });

        requestAnimationFrame(() => {
          const rect = this.icon.getBoundingClientRect();
          let left = coords.right + 6;
          let top = coords.top - rect.height - 6;

          const maxLeft = window.innerWidth - rect.width - 8;
          const maxTop = window.innerHeight - rect.height - 8;

          if (left > maxLeft) {
            left = Math.max(8, coords.left - rect.width - 6);
          }
          if (top < 8) {
            top = Math.min(maxTop, coords.bottom + 6);
          }

          setCssProps(this.icon, {
            "--sll-left": `${Math.max(8, Math.min(left, maxLeft))}px`,
            "--sll-top": `${Math.max(8, Math.min(top, maxTop))}px`
          });
          this.icon.classList.remove(INVISIBLE_CLASS);
        });
      }

      private buildAnchorRect(): DOMRect | null {
        const coords = this.view.coordsAtPos(this.view.state.selection.main.to);
        if (!coords) return null;
        return new DOMRect(coords.left, coords.top, coords.right - coords.left, coords.bottom - coords.top);
      }

      private getContextLine(): string {
        return this.view.state.doc.lineAt(this.view.state.selection.main.from).text;
      }
    }
  );
}

function isImageSelection(selection: string, contextLine: string): boolean {
  const text = selection.trim();
  if (text.startsWith("![[") && text.endsWith("]]")) return true;
  if (text.startsWith("![") && text.includes("](") && text.endsWith(")")) return true;
  if (contextLine.includes("![[") && contextLine.includes("]]")) return true;
  if (contextLine.includes("![") && contextLine.includes("](")) return true;
  return false;
}

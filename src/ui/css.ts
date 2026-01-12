export function setCssProps(el: HTMLElement, props: Record<string, string>): void {
  Object.entries(props).forEach(([key, value]) => {
    el.style.setProperty(key, value);
  });
}

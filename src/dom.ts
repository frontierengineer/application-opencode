type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | boolean | ((event: Event) => void) | undefined> = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) continue;
    if (typeof value === 'function') element.addEventListener(name.replace(/^on/, '').toLowerCase(), value);
    else if (value === true) element.setAttribute(name, '');
    else element.setAttribute(name, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    element.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return element;
}

export function withCode(textValue: string): (Node | string)[] {
  return textValue.split(/(`[^`]+`)/).filter((part) => part !== '').map((part) =>
    part.startsWith('`') && part.endsWith('`') ? h('code', {}, part.slice(1, -1)) : part,
  );
}

export function style(css: string): HTMLStyleElement {
  return h('style', {}, css);
}

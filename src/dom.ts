type Child = Node | string | null | undefined | false;
type Attributes = Record<string, string | boolean | ((event: Event) => void) | undefined>;

// A frontier-* element of the Design System, or any HTML element.
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attributes?: Attributes, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K];
export function h(tag: `frontier-${string}`, attributes?: Attributes, ...children: (Child | Child[])[]): HTMLElement;
export function h(tag: string, attributes: Attributes = {}, ...children: (Child | Child[])[]): HTMLElement {
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

// An outline icon on a 24 by 24 grid, sized and stroked by the Design System.
export function icon(path: string): SVGSVGElement {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const shape = document.createElementNS(namespace, 'path');
  shape.setAttribute('d', path);
  svg.append(shape);
  return svg;
}

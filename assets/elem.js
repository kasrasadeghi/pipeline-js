/**
 * Fast HTML Element Builder API
 * 
 * This provides a fluent API for creating DOM elements that's faster than
 * string concatenation and innerHTML assignment. Based on the approach
 * used in /list rendering which uses document.createElement directly.
 */

export class Elem {
  constructor(tagName, className = '', attributes = {}) {
    this.element = document.createElement(tagName);
    if (className) this.element.className = className;
    Object.entries(attributes).forEach(([key, value]) => {
      this.element.setAttribute(key, value);
    });
  }
  
  // Fast chaining methods
  addClass(className) {
    this.element.classList.add(className);
    return this;
  }
  
  removeClass(className) {
    this.element.classList.remove(className);
    return this;
  }
  
  setText(text) {
    this.element.textContent = text;
    return this;
  }
  
  setHTML(html) {
    this.element.innerHTML = html;
    return this;
  }
  
  setAttribute(name, value) {
    this.element.setAttribute(name, value);
    return this;
  }
  
  addChild(child) {
    if (child instanceof Elem) {
      this.element.appendChild(child.element);
    } else {
      this.element.appendChild(child);
    }
    return this;
  }
  
  addChildren(children) {
    children.forEach(child => this.addChild(child));
    return this;
  }
  
  // Event handlers
  onClick(handler) {
    this.element.onclick = handler;
    return this;
  }
  
  on(event, handler) {
    this.element.addEventListener(event, handler);
    return this;
  }
  
  // Style methods
  setStyle(property, value) {
    this.element.style[property] = value;
    return this;
  }
  
  setStyles(styles) {
    Object.entries(styles).forEach(([property, value]) => {
      this.element.style[property] = value;
    });
    return this;
  }
  
  // Get the actual DOM element
  toElement() {
    return this.element;
  }
}

// Specialized element builders
export class DivElem extends Elem {
  constructor(className = '', attributes = {}) {
    super('div', className, attributes);
  }
}

export class SpanElem extends Elem {
  constructor(className = '', attributes = {}) {
    super('span', className, attributes);
  }
}

export class LinkElem extends Elem {
  constructor(href, text, className = '', attributes = {}) {
    super('a', className, { ...attributes, href });
    this.setText(text);
  }
}

export class ButtonElem extends Elem {
  constructor(text, className = '', attributes = {}) {
    super('button', className, attributes);
    this.setText(text);
  }
}

export class ParagraphElem extends Elem {
  constructor(className = '', attributes = {}) {
    super('p', className, attributes);
  }
}

export class ListItemElem extends Elem {
  constructor(className = '', attributes = {}) {
    super('li', className, attributes);
  }
}

export class UnorderedListElem extends Elem {
  constructor(className = '', attributes = {}) {
    super('ul', className, attributes);
  }
}

// Utility function for creating document fragments
export function createFragment(children) {
  const fragment = document.createDocumentFragment();
  children.forEach(child => {
    if (child instanceof Elem) {
      fragment.appendChild(child.element);
    } else {
      fragment.appendChild(child);
    }
  });
  return fragment;
}

// The part of the DOM the three modules actually touch, as plain objects.
//
// The kernel needs the least of it: the five operations place, remove and empty
// nodes and never read a style or a layout, so parents and children are enough
// to run them, and running them here costs milliseconds instead of a browser.
//
// Two layers above it need more. `surface.js` finds controls by attribute, so
// nodes carry attributes and answer `matches`, `closest` and `querySelectorAll`
// over the small selector language below. `on` and `dispatch` need events that
// bubble, so nodes keep listeners and walk the path to the root themselves. The
// events are the platform's own CustomEvent, because Node has one: only the
// walk is faked, and `detail`, `cancelable` and `stopPropagation` behave as a
// browser's do.
//
// The names are the DOM's because domocracy.js calls them: `children` is the
// array the region indexes, `insertBefore(node, null)` appends the way
// Blink's does, and `textContent = ''` is what a clear does.

// One compound selector, of the four kinds these tests use: a tag name,
// `.class`, `#id` and an attribute, with `=` for the whole value and `^=` for a
// prefix. `surface.js` quotes an address into an attribute selector, so the
// value is read with `\"` and `\\` unescaped, which is how a control whose
// address holds a quote is found at all.
const ATTRIBUTE = /^\[([^\]=^]+)(?:(\^?=)"((?:[^"\\]|\\.)*)")?\]$/;

function matchOne(node, selector) {
  const attribute = ATTRIBUTE.exec(selector);
  if (attribute !== null) {
    const held = node.attributes.get(attribute[1]);
    if (held === undefined) return false;
    if (attribute[2] === undefined) return true;
    const value = attribute[3].replace(/\\(.)/g, '$1');
    return attribute[2] === '=' ? held === value : held.startsWith(value);
  }
  if (selector[0] === '.') return (node.attributes.get('class') ?? '').split(' ').includes(selector.slice(1));
  if (selector[0] === '#') return node.attributes.get('id') === selector.slice(1);
  return node.tag === selector;
}

// The path an event takes, read once when the dispatch starts, as the DOM reads
// it: a listener that detaches the target does not shorten the walk.
function bubble(node, event) {
  const path = [];
  for (let n = node; n; n = n.parentNode) {
    path.push(n);
    if (!event.bubbles) break;
  }
  // A dispatched event names its target. The platform's own Event keeps that on
  // a prototype getter, so the fake shadows it with the node for this dispatch.
  Object.defineProperty(event, 'target', { value: node, configurable: true });
  for (let i = 0; i < path.length; i++) {
    const listeners = path[i].listeners.get(event.type);
    // A listener list is copied before it runs, so a handler that registers
    // another one does not extend the loop it is inside.
    if (listeners !== undefined) for (const listener of listeners.slice()) listener.call(path[i], event);
    if (event.cancelBubble) break;
  }
  return !event.defaultPrevented;
}

class FakeNode {
  constructor(tag) {
    this.tag = tag;
    this.nodeType = 1;
    this.parentNode = null;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
  }

  // The parent, when the parent is an element. A node held by a document or by
  // a fragment has a parentNode and no parentElement, which is the difference
  // between having somewhere to be and having a container.
  get parentElement() { return this.parentNode?.nodeType === 1 ? this.parentNode : null; }

  // A tree hanging off `documentTree()` is in a document, anything else is
  // loose, which is what `intent.js` asks of a source.
  get isConnected() { return this.getRootNode().isDocument === true; }

  get nextSibling() {
    const siblings = this.parentNode?.children;
    return siblings ? siblings[siblings.indexOf(this) + 1] ?? null : null;
  }

  // A table section keeps every row's index current, which is the one reason a
  // region indexes some containers differently from the rest.
  get sectionRowIndex() { return this.parentNode ? this.parentNode.children.indexOf(this) : -1; }

  insertBefore(node, before) {
    if (before !== null && before !== undefined && before.parentNode !== this) throw new Error('insertBefore: before is not a child');
    if (node.contains(this)) throw new Error('insertBefore: the node contains the parent');
    node.remove();
    const at = before ? this.children.indexOf(before) : this.children.length;
    this.children.splice(at, 0, node);
    node.parentNode = this;
    return node;
  }

  // What the platform's moveBefore does that insertBefore does not: it keeps
  // the node's state, and it refuses a node from another root. Nothing here has
  // state to keep, so the count is how a test sees which one ran.
  moveBefore(node, before) {
    if (node.getRootNode() !== this.getRootNode()) throw new Error('moveBefore: the node is in another root');
    this.moved = (this.moved ?? 0) + 1;
    return this.insertBefore(node, before);
  }

  append(...nodes) { for (const node of nodes) this.insertBefore(node, null); return this; }

  remove() {
    const siblings = this.parentNode?.children;
    if (siblings) siblings.splice(siblings.indexOf(this), 1);
    this.parentNode = null;
  }

  contains(other) { for (let n = other; n; n = n.parentNode) if (n === this) return true; return false; }

  getRootNode() { let n = this; while (n.parentNode) n = n.parentNode; return n; }

  // Two children of the same parent, which is all a swap compares. Bit 2 is
  // DOCUMENT_POSITION_PRECEDING: set when `other` comes before this node.
  compareDocumentPosition(other) {
    const siblings = this.parentNode?.children ?? [];
    return siblings.indexOf(other) < siblings.indexOf(this) ? 2 : 4;
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); return this; }

  getAttribute(name) { return this.attributes.get(name) ?? null; }

  // Read only, and rebuilt per read: nothing in domocracy writes a data
  // attribute, so a test that wants one sets it with setAttribute.
  get dataset() {
    const data = {};
    for (const [name, value] of this.attributes) {
      if (name.startsWith('data-')) data[name.slice(5).replace(/-./g, dash => dash[1].toUpperCase())] = value;
    }
    return data;
  }

  matches(selector) { return selector.split(',').some(one => matchOne(this, one.trim())); }

  closest(selector) { for (let n = this; n; n = n.parentNode) if (n.matches?.(selector)) return n; return null; }

  querySelectorAll(selector) {
    const found = [];
    const walk = node => {
      for (const child of node.children) {
        if (child.matches(selector)) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }

  addEventListener(type, listener) {
    const held = this.listeners.get(type);
    if (held === undefined) this.listeners.set(type, [listener]); else held.push(listener);
  }

  dispatchEvent(event) { return bubble(this, event); }

  set textContent(text) {
    if (text !== '') throw new Error('the fake tree only supports emptying a node');
    for (const child of this.children) child.parentNode = null;
    this.children.length = 0;
  }

  get textContent() { return this.children.map(child => child.textContent).join(''); }
}

// A text node. It is the one child a region never counts, because `children` is
// elements, and it is what an event target looks like when a pointer lands on
// the text inside a control rather than on the control.
class FakeText {
  constructor(value, parent) {
    this.nodeType = 3;
    this.data = value;
    this.parentNode = parent;
    this.listeners = new Map();
    if (parent !== null) parent.texts = (parent.texts ?? []).concat([this]);
  }

  get textContent() { return this.data; }

  remove() { this.parentNode = null; }

  addEventListener(type, listener) {
    const held = this.listeners.get(type);
    if (held === undefined) this.listeners.set(type, [listener]); else held.push(listener);
  }

  dispatchEvent(event) { return bubble(this, event); }
}

// The Document. It holds a tree and takes listeners, and it is not an Element:
// it answers no selector, which is the case `on` guards for when an event's
// target is the document itself.
class FakeDocument extends FakeNode {
  constructor() {
    super('#document');
    this.nodeType = 9;
    this.isDocument = true;
  }

  get closest() { return undefined; }

  get matches() { return undefined; }
}

export const element = (tag, attributes) => {
  const node = new FakeNode(tag);
  if (attributes !== undefined) for (const name of Object.keys(attributes)) node.setAttribute(name, attributes[name]);
  return node;
};

export const text = (value, parent = null) => new FakeText(value, parent);

// A document fragment. It holds nodes and is not an element, so a node inside
// one has a parent and no container.
export function fragment() {
  const held = new FakeNode('#fragment');
  held.nodeType = 11;
  return held;
}

// A root that counts as a document, so nodes under it are connected.
export function documentTree() {
  return new FakeDocument();
}

// A parent holding `count` children, the shape most of these tests start from.
export function branch(count, tag = 'li') {
  const parent = element('ul');
  for (let i = 0; i < count; i++) parent.append(element(tag));
  return parent;
}

// The adapter the pure tests use: create returns a node carrying its spec, and
// update records what it was handed, so a test can say what the adapter saw.
export function recorder() {
  const created = [], updated = [];
  return {
    created,
    updated,
    create(spec) { const node = element('li'); node.spec = spec; created.push(spec); return node; },
    update(node, data) { node.data = data; updated.push([node, data]); },
  };
}

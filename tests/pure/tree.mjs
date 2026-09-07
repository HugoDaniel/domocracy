// The part of the DOM the kernel actually touches, as plain objects. The five
// operations place, remove and empty nodes and never read an attribute, a
// style or a layout, so a tree of parents and children is enough to run them,
// and running them here costs milliseconds instead of a browser.
//
// The names are the DOM's because domocracy.js calls them: `children` is the
// array the region indexes, `insertBefore(node, null)` appends the way
// Blink's does, and `textContent = ''` is what a clear does.

class FakeNode {
  constructor(tag) {
    this.tag = tag;
    this.parentNode = null;
    this.children = [];
  }

  get parentElement() { return this.parentNode; }

  // What intent.js asks of a source: an element in the document. A tree hanging
  // off `documentTree()` is in one, anything else is loose.
  get nodeType() { return 1; }

  get isConnected() { return this.getRootNode().isDocument === true; }

  get nextSibling() {
    const siblings = this.parentNode?.children;
    return siblings ? siblings[siblings.indexOf(this) + 1] ?? null : null;
  }

  insertBefore(node, before) {
    if (before !== null && before !== undefined && before.parentNode !== this) throw new Error('insertBefore: before is not a child');
    if (node.contains(this)) throw new Error('insertBefore: the node contains the parent');
    node.remove();
    const at = before ? this.children.indexOf(before) : this.children.length;
    this.children.splice(at, 0, node);
    node.parentNode = this;
    return node;
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

  set textContent(text) {
    if (text !== '') throw new Error('the fake tree only supports emptying a node');
    for (const child of this.children) child.parentNode = null;
    this.children.length = 0;
  }

  get textContent() { return this.children.map(child => child.textContent).join(''); }
}

export const element = tag => new FakeNode(tag);

// A root that counts as a document, so nodes under it are connected.
export function documentTree() {
  const root = new FakeNode('#document');
  root.isDocument = true;
  return root;
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

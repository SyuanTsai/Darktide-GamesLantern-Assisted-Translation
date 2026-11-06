// Minimal text-node DOM for renderer unit tests; HTML parsing is deliberately unsupported.
function createDocument() {
  const document = { defaultView: { NodeFilter: { SHOW_TEXT: 4 } } };
  class Node {
    constructor(tag, text) {
      this.ownerDocument = document; this.nodeType = tag ? 1 : 3;
      this.tagName = tag?.toUpperCase(); this.nodeValue = text ?? null;
      this.childNodes = []; this.attributes = new Map(); this.listeners = new Map();
      this.classList = { add: (...values) => { this.className = [this.className || '', ...values].join(' '); } };
    }
    get parentElement() { return this.parentNode?.nodeType === 1 ? this.parentNode : null; }
    get children() { return this.childNodes.filter(n => n.nodeType === 1); }
    get isConnected() { return true; }
    get nextSibling() { const siblings = this.parentNode?.childNodes || []; return siblings[siblings.indexOf(this) + 1] || null; }
    get textContent() { return this.nodeType === 3 ? this.nodeValue : this.childNodes.map(n => n.textContent).join(''); }
    set textContent(value) { this.replaceChildren(document.createTextNode(String(value))); }
    set innerHTML(_) { throw new Error('data must never be parsed as HTML'); }
    append(...nodes) { for (let n of nodes) { if (typeof n === 'string') n = document.createTextNode(n); n.parentNode = this; this.childNodes.push(n); } }
    replaceChildren(...nodes) { for (const n of this.childNodes) n.parentNode = null; this.childNodes = []; this.append(...nodes); }
    insertBefore(node, next) { if (!next) { this.append(node); return; } node.parentNode = this; this.childNodes.splice(this.childNodes.indexOf(next), 0, node); }
    removeChild(node) { this.childNodes.splice(this.childNodes.indexOf(node), 1); node.parentNode = null; }
    remove() { this.parentNode?.removeChild(this); }
    setAttribute(key, value) { this.attributes.set(key, String(value)); }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    hasAttribute(key) { return this.attributes.has(key); }
    closest() { return null; }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    addEventListener(name, fn) { this.listeners.set(name, fn); }
    removeEventListener(name) { this.listeners.delete(name); }
    fire(name) { this.listeners.get(name)?.(); }
  }
  document.createElement = tag => new Node(tag);
  document.createTextNode = text => new Node(null, text);
  document.createTreeWalker = element => {
    const nodes = []; const visit = n => { for (const child of n.childNodes) { if (child.nodeType === 3) nodes.push(child); else visit(child); } }; visit(element);
    let index = -1; return { get currentNode() { return nodes[index]; }, nextNode() { return ++index < nodes.length; } };
  };
  return document;
}
function descendants(node, predicate) { return node.childNodes.flatMap(child => [ ...(predicate(child) ? [child] : []), ...descendants(child, predicate) ]); }
module.exports = { createDocument, descendants };

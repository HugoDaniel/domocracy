// The two globals domocracy.js reads once, at load, to decide how it moves a
// node and how it indexes a container. Node has neither, so the rest of the
// pure suite takes the other side of both choices; this file is what a browser
// looks like from the two lines that ask.
//
// Importing it installs them. A test file that wants those branches imports
// this one first and then reaches domocracy.js with `await import`, because the
// choice is made when that module is evaluated and never again.

// Only `'moveBefore' in Element.prototype` reads this. The call itself lands on
// the node, and the fake tree carries its own moveBefore.
export class Element {
  moveBefore() { throw new Error('platform: nothing calls Element.prototype.moveBefore'); }
}

// A section is a tag here, because a fake tree has no constructors to inherit
// from and `instanceof` is the only question domocracy asks.
export const HTMLTableSectionElement = {
  [Symbol.hasInstance]: node => node?.tag === 'tbody' || node?.tag === 'thead' || node?.tag === 'tfoot',
};

globalThis.Element = Element;
globalThis.HTMLTableSectionElement = HTMLTableSectionElement;

// A toolbar whose buttons mean nothing on their own.
//
//   createToolbar({ key, name })   { element, key, name, buttons, refresh, dispose }
//
// Every button carries the intent it raises in data-intent and nothing else: no
// handler, no callback, no idea what "apply" or "up" does. Activating one raises
// the intent from the button, and the scopes above the toolbar answer. In a form
// Apply commits the fields; in a listbox Up moves the selected option; in the
// dock nothing answers at all. The toolbar is the same element throughout, and
// it changes rooms with moveBefore, so the button you are on keeps its focus
// while its meaning changes.
//
// What the toolbar does own is being a toolbar: one tab stop, arrow keys between
// the buttons, Home and End. It reads the buttons from the tree each time, so
// one that arrives later is reached by the same keys without anything being
// registered for it.
//
// Two toolbars on one page are two of these, and neither knows of the other:
// each raises from its own buttons and is answered by the rooms around it, and
// each shows its own captions. The key and the name are how the page tells
// them apart, in data-toolbar and in the label.
//
// It also owns saying what its buttons would do. `refresh()` asks each button,
// through `explain`, what the rooms around it would answer, and writes the
// answer under the button: the meaning, or why it is refused, or both when a
// room refused after a nearer one had already contributed. A button is marked
// aria-disabled only when the whole action would do nothing but refuse, and it
// still raises when pressed, because the refusal is the plan and the plan is
// what runs. Nothing here decides availability; the interpreters did, once,
// and this only shows it.
import { on } from 'domocracy';
import { caption, explain, raise } from './scopes.js';

export const CONTROLS = Object.freeze([
  { intent: 'ui:apply', label: 'Apply' },
  { intent: 'ui:cancel', label: 'Cancel' },
  { intent: 'ui:up', label: 'Up' },
  { intent: 'ui:down', label: 'Down' },
  { intent: 'ui:remove', label: 'Remove' },
  { intent: 'toolbar:next', label: 'Next room', travel: true },
]);

const KEYS = { ArrowRight: 1, ArrowLeft: -1, Home: 0, End: 0 };

let instances = 0;

export function createToolbar({ key = 'a', name = 'A' } = {}) {
  const prefix = `tb-${++instances}`;
  const element = document.createElement('div');
  element.className = 'toolbar';
  element.dataset.toolbar = key;
  element.dataset.label = `toolbar ${name}`;

  const bar = document.createElement('div');
  bar.className = 'tb-buttons';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', `Toolbar ${name}`);
  const tag = document.createElement('span');
  tag.className = 'tb-tag';
  tag.setAttribute('aria-hidden', 'true');
  tag.textContent = name;
  bar.append(tag);

  // One caption per button, and the button is described by it.
  const captions = document.createElement('ul');
  captions.className = 'tb-captions';
  const captionOf = new WeakMap();

  CONTROLS.forEach((control, i) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = control.travel ? 'tb-button tb-travel' : 'tb-button';
    button.dataset.intent = control.intent;
    button.textContent = control.label;
    // Roving tabindex: the toolbar is one tab stop and the arrows move inside it.
    button.tabIndex = i === 0 ? 0 : -1;
    bar.append(button);

    const caption = document.createElement('li');
    caption.className = 'tb-caption';
    const name = document.createElement('span');
    name.className = 'tb-caption-for';
    name.setAttribute('aria-hidden', 'true');
    name.textContent = control.label;
    const text = document.createElement('span');
    text.className = 'tb-caption-text';
    text.id = `${prefix}-${i}`;
    caption.append(name, text);
    captions.append(caption);
    captionOf.set(button, caption);
    button.setAttribute('aria-describedby', text.id);
  });
  element.append(bar, captions);

  const buttons = () => Array.from(bar.querySelectorAll('.tb-button:not([disabled])'));
  const rove = (to) => { for (const button of buttons()) button.tabIndex = button === to ? 0 : -1; };

  const offs = [
    // The toolbar raises and reports. It does not know what the answer was.
    on(bar, 'click', '.tb-button', (event, button) => raise(button, button.dataset.intent, undefined, element)),
    on(bar, 'focusin', '.tb-button', (event, button) => rove(button)),
    on(bar, 'keydown', '.tb-button', (event, button) => {
      if (!(event.key in KEYS)) return;
      event.preventDefault();
      const all = buttons();
      const at = all.indexOf(button);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? all.length - 1 : (at + KEYS[event.key] + all.length) % all.length;
      all[next].focus();
    }),
  ];

  return {
    element,
    key,
    name,
    get buttons() { return buttons(); },

    // Each button asks what it would do here and shows it. Called by whoever
    // knows the tree changed; the toolbar itself does not watch for that.
    refresh() {
      if (!element.isConnected) return;
      for (const button of buttons()) {
        const line = captionOf.get(button);
        if (line === undefined) continue;
        const said = caption(explain(button, button.dataset.intent));
        line.dataset.state = said.state;
        line.lastElementChild.textContent = said.text;
        button.setAttribute('aria-disabled', String(!said.available));
      }
    },

    dispose() {
      for (const off of offs) off();
      element.remove();
    },
  };
}

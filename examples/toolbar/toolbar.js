// A toolbar whose buttons mean nothing on their own.
//
//   createToolbar()   { element, buttons, dispose }
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
// the buttons, Home and End. That is the whole behavior in this file.
import { on } from 'domocracy';
import { raise } from './scopes.js';

export const CONTROLS = Object.freeze([
  { intent: 'ui:apply', label: 'Apply' },
  { intent: 'ui:cancel', label: 'Cancel' },
  { intent: 'ui:up', label: 'Up' },
  { intent: 'ui:down', label: 'Down' },
  { intent: 'ui:remove', label: 'Remove' },
  { intent: 'toolbar:next', label: 'Next room', travel: true },
]);

const KEYS = { ArrowRight: 1, ArrowLeft: -1, Home: 0, End: 0 };

export function createToolbar() {
  const element = document.createElement('div');
  element.className = 'toolbar';
  element.setAttribute('role', 'toolbar');
  element.setAttribute('aria-label', 'Toolbar');
  element.dataset.label = 'the toolbar';

  const buttons = CONTROLS.map((control, i) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = control.travel ? 'tb-button tb-travel' : 'tb-button';
    button.dataset.intent = control.intent;
    button.textContent = control.label;
    // Roving tabindex: the toolbar is one tab stop and the arrows move inside it.
    button.tabIndex = i === 0 ? 0 : -1;
    element.append(button);
    return button;
  });

  const rove = (to) => { for (const button of buttons) button.tabIndex = button === to ? 0 : -1; };

  const offs = [
    // The toolbar raises and reports. It does not know what the answer was.
    on(element, 'click', '.tb-button', (event, button) => raise(button, button.dataset.intent, undefined, element)),
    on(element, 'focusin', '.tb-button', (event, button) => rove(button)),
    on(element, 'keydown', '.tb-button', (event, button) => {
      if (!(event.key in KEYS)) return;
      event.preventDefault();
      const at = buttons.indexOf(button);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (at + KEYS[event.key] + buttons.length) % buttons.length;
      buttons[next].focus();
    }),
  ];

  return {
    element,
    buttons,
    dispose() {
      for (const off of offs) off();
      element.remove();
    },
  };
}

// The page around the navigation component: two independent instances of the
// same spec, a strip of buttons that exercises the public API, and a status line
// that says what the last command event carried.
//
// This file is the application. It decides what `nav:select` means, which is why
// the component dispatches an event and does not run anything itself: the same
// entry means "export this document" here and could mean something else in
// another page without the component changing.
import { on } from 'domocracy';
import { createNavigation } from './navigation.js';

// One spec, two navigations. Entries with and without icons, a submenu inside a
// submenu, real destinations and one command.
export const MENU = [
  { id: 'home', label: 'Home', href: '#home', icon: 'home' },
  { id: 'products', label: 'Products', children: [
    { id: 'overview', label: 'Overview', href: '#overview' },
    { id: 'library', label: 'Library', href: '#library', icon: 'folder' },
    { id: 'tools', label: 'Tools', icon: 'wrench', children: [
      { id: 'export', label: 'Export', command: 'export', icon: 'download' },
    ] },
  ] },
  { id: 'pricing', label: 'Pricing', href: '#pricing' },
];

const button = (action, text) => {
  const element = document.createElement('button');
  element.type = 'button';
  element.dataset.action = action;
  element.textContent = text;
  return element;
};

export function mountNavigationDemo(root, options = {}) {
  const demo = document.createElement('div');
  demo.className = 'nav-demo';

  const bars = document.createElement('div');
  bars.className = 'nav-bars';
  const navigations = ['A', 'B'].map(letter => {
    const bar = document.createElement('section');
    bar.className = 'nav-bar';
    const heading = document.createElement('h3');
    heading.textContent = `Navigation ${letter}`;
    bar.append(heading);
    const navigation = createNavigation(MENU, { label: `Navigation ${letter}`, prefix: options.prefix ? `${options.prefix}-${letter}` : undefined });
    navigation.element.dataset.instance = letter;
    bar.append(navigation.element);
    bars.append(bar);
    return navigation;
  });
  const [first] = navigations;

  const strip = document.createElement('div');
  strip.className = 'nav-strip';
  strip.setAttribute('role', 'group');
  strip.setAttribute('aria-label', 'Demonstration controls for Navigation A');
  const buttons = {
    add: button('add', 'Add entry to Tools'),
    rename: button('rename', 'Rename it'),
    icon: button('icon', 'Toggle its icon'),
    up: button('up', 'Move it up'),
    remove: button('remove', 'Remove it'),
  };
  strip.append(...Object.values(buttons));

  const status = document.createElement('p');
  status.className = 'nav-status';
  status.setAttribute('role', 'status');
  status.textContent = 'Open Products, then Tools. Escape closes the submenu the focus is in.';

  demo.append(bars, strip, status);
  root.append(demo);

  // The demonstration entry: one id at a time, tracked here because this is the
  // page's own idea and not the component's.
  let made = 0, scratch = null, renames = 0, icon = false;

  const say = message => { status.textContent = message; };
  const sync = () => {
    const missing = scratch === null;
    for (const name of ['rename', 'icon', 'up', 'remove']) buttons[name].disabled = missing;
    buttons.add.disabled = !missing;
  };
  sync();

  // Where the demonstration entry sits in its list, read from the DOM, because
  // the DOM is where that answer lives once the region has run.
  const positionOf = id => {
    const host = first.element.querySelector(`.nav-entry[data-id="${id}"]`);
    return host === null ? -1 : Array.prototype.indexOf.call(host.parentElement.children, host);
  };

  const actions = {
    add() {
      // The plan is to add into a submenu that is already open, so the two
      // disclosures are opened first, through the same update path a click uses.
      first.update('products', { expanded: true });
      first.update('tools', { expanded: true });
      scratch = `scratch-${++made}`;
      renames = 0;
      icon = false;
      first.add({ id: scratch, label: `Scratch ${made}`, command: 'scratch' }, { parent: 'tools' });
      say(`Added ${scratch} to Tools in Navigation A. Navigation B is unchanged.`);
    },
    rename() {
      first.update(scratch, { label: `Scratch ${made}, renamed ${++renames}` });
      say(`Renamed ${scratch}. The button, its focus and the open submenu are the same ones.`);
    },
    icon() {
      icon = !icon;
      first.update(scratch, { icon: icon ? 'star' : null });
      say(`${icon ? 'Added' : 'Removed'} the icon on ${scratch}.`);
    },
    up() {
      const at = positionOf(scratch);
      first.move(scratch, Math.max(0, at - 1));
      say(`Moved ${scratch} from position ${at} to ${positionOf(scratch)}. Same node, new position.`);
    },
    remove() {
      first.remove(scratch);
      say(`Removed ${scratch}.`);
      scratch = null;
    },
  };

  const offs = [
    on(strip, 'click', 'button[data-action]', (event, control) => {
      actions[control.dataset.action]();
      sync();
    }),
    // The command event bubbles from whichever navigation dispatched it, so one
    // rule serves both instances and the match says which one it was.
    on(demo, 'nav:select', '.nav', (event, navigation) => {
      const { id, command } = event.detail;
      say(`Navigation ${navigation.dataset.instance} asked for ${command} from ${id}.`);
    }),
  ];

  return {
    element: demo,
    navigations,
    dispose() {
      for (const off of offs) off();
      for (const navigation of navigations) navigation.dispose();
      demo.remove();
    },
  };
}

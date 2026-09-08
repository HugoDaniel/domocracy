// A navigation bar whose entries create the entries below them.
//
//   createNavigation(spec, options)  a <nav> with one list region under it
//   createEntry(spec, context)       one entry, which may create a list of its own
//   createIcon(name)                 a decorative SVG from a fixed vocabulary
//
// Each list is a region: its direct children are entry hosts and they change
// only through insert, move, update and remove. The list's adapter calls
// createEntry, and an entry whose spec names children creates a nested list with
// a region of its own, so the recursion is components creating components while
// the library only ever sees one container at a time.
//
// What belongs to an entry is private: its link or button, the text node holding
// its label, its icon slot, its nested list and whether that list is open. What
// belongs to the region is which entry hosts are there and in which order. The
// spec is creation input and nothing here keeps a second copy of it, so the
// components are the only account of what the navigation currently holds.
//
// One nav element carries the delegated click and keydown rules for everything
// under it, whatever is inserted later. That is the whole event story: no
// listener per entry, no listener on the document.
import { region, on, dispatch } from 'domocracy';

const SVG = 'http://www.w3.org/2000/svg';

// The icon vocabulary, drawn as one stroked path each. An entry names one of
// these or none, and any other name is a mistake worth hearing about while the
// spec that caused it is still on the stack.
const ICONS = {
  home: 'M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z',
  download: 'M12 4v10m0 0 4-4m-4 4-4-4M5 19h14',
  folder: 'M4 6a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z',
  wrench: 'M14.5 4a4.5 4.5 0 0 0-4.2 6.1L4 16.4 7.6 20l6.3-6.3A4.5 4.5 0 1 0 14.5 4z',
  star: 'm12 4 2.5 5.2 5.5.8-4 3.9 1 5.6-5-2.7-5 2.7 1-5.6-4-3.9 5.5-.8z',
};

export const ICON_NAMES = Object.freeze(Object.keys(ICONS));

// The icon is presentation the entry owns, and it is marked decorative because
// the visible label already carries the meaning to a screen reader.
export function createIcon(name) {
  const path = ICONS[name];
  if (path === undefined) throw new RangeError(`createIcon: no icon named ${JSON.stringify(name)}`);
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'nav-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const line = document.createElementNS(SVG, 'path');
  line.setAttribute('d', path);
  svg.append(line);
  return svg;
}

// The class the delegated rules match, one per kind of entry. A submenu's button
// is a disclosure: it opens the list beside it and does nothing else.
const CONTROL_CLASS = { link: 'nav-link', command: 'nav-command', submenu: 'nav-disclosure' };

function kindOf(spec) {
  if (spec.children !== undefined) return 'submenu';
  if (spec.command !== undefined) return 'command';
  return 'link';
}

// One entry, and the list under it when the spec has children. `context` is the
// navigation the entry belongs to: the prefix its DOM ids start with and the
// registry that answers which entry an id or a host element means.
export function createEntry(spec, context, level) {
  if (typeof spec?.id !== 'string' || spec.id === '') throw new TypeError('createEntry: an entry needs a non-empty string id');
  if (typeof spec.label !== 'string') throw new TypeError(`createEntry: entry ${JSON.stringify(spec.id)} needs a label`);
  const kind = kindOf(spec);

  const element = document.createElement('li');
  element.className = 'nav-entry';
  element.dataset.id = spec.id;

  const control = document.createElement(kind === 'link' ? 'a' : 'button');
  control.className = `nav-control ${CONTROL_CLASS[kind]}`;
  if (kind === 'link') control.href = spec.href ?? '#';
  else control.type = 'button';
  if (kind === 'command') control.dataset.command = spec.command;

  // The label is a text node the entry keeps, so renaming writes one string and
  // leaves the control, its focus and its icon exactly where they were.
  const text = document.createTextNode(spec.label);
  const slot = document.createElement('span');
  slot.className = 'nav-icon-slot';
  const label = document.createElement('span');
  label.className = 'nav-label';
  label.append(text);
  control.append(slot, label);
  element.append(control);

  let icon = null;
  function setIcon(name) {
    if (icon !== null) { icon.remove(); icon = null; }
    if (name === null || name === undefined) return;
    icon = createIcon(name);
    slot.append(icon);
  }
  if (spec.icon !== undefined) setIcon(spec.icon);

  let nested = null, expanded = false, disposed = false;
  const entry = {
    id: spec.id,
    kind,
    element,
    control,
    command: kind === 'command' ? spec.command : null,
    get list() { return nested; },
    get expanded() { return expanded; },
    get icon() { return icon === null ? null : icon; },

    // Everything an update may change, narrowly. An entry host is never
    // replaced, so a rename during an open submenu keeps the submenu open and a
    // rename of the focused entry keeps the focus.
    update(data) {
      if (data === undefined || data === null) return;
      if ('label' in data) text.data = String(data.label);
      if ('icon' in data) setIcon(data.icon);
      if ('expanded' in data) entry.expand(Boolean(data.expanded));
    },

    expand(open) {
      if (kind !== 'submenu') throw new RangeError(`navigation: entry ${JSON.stringify(spec.id)} has no submenu`);
      if (open === expanded) return;
      // Focus cannot stay inside a hidden subtree, so a collapse that would hide
      // the focused control hands focus to the button that reopens it. A
      // collapse anywhere else leaves focus where the reader put it.
      if (!open && nested.element.contains(document.activeElement)) control.focus();
      expanded = open;
      control.setAttribute('aria-expanded', String(open));
      nested.element.hidden = !open;
    },

    // Idempotent, and recursive: an entry disposes the list it created, which
    // disposes the entries in it. Cleanup is the component's, because the region
    // knows the host element and nothing about what the component hung off it.
    dispose() {
      if (disposed) return;
      disposed = true;
      context.unregister(entry);
      if (nested !== null) nested.dispose();
    },
  };

  if (kind === 'submenu') {
    const id = `${context.prefix}-${spec.id}`;
    control.setAttribute('aria-expanded', 'false');
    control.setAttribute('aria-controls', id);
    nested = createList(context, level + 1, id);
    nested.element.hidden = true;
    element.append(nested.element);
    // A factory that fails while preparing its subtree cleans up what it made
    // before rethrowing, so a bad spec deep in a tree leaves no half-built
    // components and no ids registered for entries that will never exist.
    try {
      nested.insert(spec.children);
    } catch (error) {
      nested.dispose();
      throw error;
    }
  }
  return entry;
}

// One list: a <ul>, a region over it, and the entry handles for its own
// children. The handles are the list's, which is what makes disposal recursive
// without a registry walk.
function createList(context, level, id) {
  const element = document.createElement('ul');
  element.className = 'nav-list';
  // A list whose markers CSS removes stops being a list to VoiceOver, so the
  // role is written back explicitly.
  element.setAttribute('role', 'list');
  element.dataset.level = String(level);
  if (id !== undefined) element.id = id;

  const handles = new Map();   // host element -> entry
  let pending = [];            // entries created by an insert that has not finished
  let disposed = false;

  const list = {
    element,
    region: null,

    entryOf(host) { return handles.get(host) ?? null; },

    // Inserting is the only way children arrive. `create` runs for every spec
    // before the tree is touched, so a spec that throws halfway leaves the
    // region untouched and leaves us the entries to dispose.
    insert(specs, before = null) {
      try {
        return list.region.insert(specs, before);
      } catch (error) {
        for (const entry of pending) { handles.delete(entry.element); entry.dispose(); }
        throw error;
      } finally {
        pending = [];
      }
    },

    update(entry, data) { return list.region.update(entry.element, data); },

    move(entry, at) {
      const found = list.region.at(entry.element);
      return list.region.moveAt(found.index, at);
    },

    // The component dies before its host leaves, because after the remove the
    // region can no longer tell us which host this was.
    remove(entry) {
      handles.delete(entry.element);
      entry.dispose();
      return list.region.remove(entry.element);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const entry of handles.values()) entry.dispose();
      handles.clear();
    },
  };

  list.region = region(element, {
    create(spec) {
      const entry = createEntry(spec, context, level);
      // The id registry is the navigation's, so a duplicate is caught here,
      // after the entry exists and before anyone can reach it.
      try {
        context.register(entry, list);
      } catch (error) {
        entry.dispose();
        throw error;
      }
      handles.set(entry.element, entry);
      pending.push(entry);
      return entry.element;
    },
    update(node, data) {
      const entry = handles.get(node);
      if (entry === undefined) throw new RangeError('navigation: this list does not own that entry');
      entry.update(data);
    },
  });
  return list;
}

let instances = 0;

// A navigation bar over one spec tree. The returned handle is the whole public
// API: the element to mount, four ways to change it, and disposal.
//
//   add(spec, { parent, before })  a new entry, in the root list or under an id
//   update(id, patch)              label, icon or disclosure state
//   move(id, index)                a new position in the list the entry is in
//   remove(id)                     the entry and everything under it
//
// Two navigations built from the same spec share nothing: each keeps its own
// components, its own open submenus and its own DOM id prefix.
export function createNavigation(spec, options = {}) {
  const prefix = options.prefix ?? `nav-${++instances}`;
  const element = document.createElement('nav');
  element.className = 'nav';
  element.setAttribute('aria-label', options.label ?? 'Navigation');

  const byId = new Map();      // entry id -> { entry, list }
  const byHost = new WeakMap();
  const context = {
    prefix,
    register(entry, list) {
      if (byId.has(entry.id)) throw new RangeError(`navigation: two entries share the id ${JSON.stringify(entry.id)}`);
      const record = { entry, list };
      byId.set(entry.id, record);
      byHost.set(entry.element, record);
    },
    unregister(entry) {
      if (byId.get(entry.id)?.entry === entry) byId.delete(entry.id);
    },
  };

  const root = createList(context, 0);
  element.append(root.element);
  try {
    root.insert(spec);
  } catch (error) {
    root.dispose();
    throw error;
  }

  const find = id => {
    const record = byId.get(id);
    if (record === undefined) throw new RangeError(`navigation: no entry with the id ${JSON.stringify(id)}`);
    return record;
  };
  const recordOf = host => byHost.get(host) ?? null;

  // The entry whose submenu contains this host, or null in the root list. A
  // nested list is a child of the entry that owns it, which is the whole walk.
  const submenuAround = host => {
    const owner = host.parentElement?.parentElement ?? null;
    return owner === null || !owner.classList.contains('nav-entry') ? null : recordOf(owner);
  };

  // The control that should hold focus once `host` is gone or hidden: the entry
  // before it, then the entry after it, then the button that opens the list.
  const survivorOf = host => {
    const before = host.previousElementSibling, after = host.nextElementSibling;
    const near = (before ?? after)?.querySelector('.nav-control') ?? null;
    if (near !== null) return near;
    return submenuAround(host)?.entry.control ?? null;
  };

  // Three delegated rules for the whole tree, registered once. `closest` from
  // the event target is what makes a click on an icon behave like a click on
  // its label, and what makes an entry inserted a minute from now work without
  // anybody registering anything for it.
  const offs = [
    on(element, 'click', '.nav-disclosure', (event, button) => {
      const record = recordOf(button.closest('.nav-entry'));
      if (record === null) return;
      // A disclosure is a region update, so the change reaches the entry the
      // same way any other update does and any observer sees it.
      record.list.update(record.entry, { expanded: !record.entry.expanded });
    }),
    on(element, 'click', '.nav-command', (event, button) => {
      const record = recordOf(button.closest('.nav-entry'));
      if (record === null) return;
      // The component says what happened and knows nothing about what it means.
      // Whoever mounted this navigation decides that, on the host element.
      dispatch(element, 'nav:select', { id: record.entry.id, command: record.entry.command });
    }),
    on(element, 'keydown', '.nav-entry', (event, host) => {
      if (event.key !== 'Escape') return;
      const record = recordOf(host);
      if (record === null) return;
      // Escape on an open disclosure closes that one; anywhere else it closes
      // the submenu the focus is in. Both hand focus back to the button that
      // reopens the list, which `expand` does on its way down.
      const target = record.entry.kind === 'submenu' && record.entry.expanded && event.target === record.entry.control
        ? record
        : submenuAround(host);
      if (target === null) return;
      event.preventDefault();
      target.list.update(target.entry, { expanded: false });
      target.entry.control.focus();
    }),
  ];

  let disposed = false;
  return {
    element,
    prefix,

    has(id) { return byId.has(id); },

    add(entrySpec, { parent = null, before = null } = {}) {
      const list = parent === null ? root : find(parent).entry.list;
      if (list === null) throw new RangeError(`navigation: entry ${JSON.stringify(parent)} has no submenu`);
      const anchor = before === null ? null : find(before).entry.element;
      list.insert([entrySpec], anchor);
      return entrySpec.id;
    },

    update(id, patch) {
      const record = find(id);
      return record.list.update(record.entry, patch);
    },

    move(id, index) {
      const record = find(id);
      return record.list.move(record.entry, index);
    },

    remove(id) {
      const record = find(id);
      // Focus has to leave before the node does, or the document moves it to
      // the body and the reader loses their place in the menu.
      const survivor = record.entry.element.contains(document.activeElement) ? survivorOf(record.entry.element) : null;
      const group = record.list.remove(record.entry);
      if (survivor !== null && survivor.isConnected) survivor.focus();
      return group;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const off of offs) off();
      root.dispose();
      byId.clear();
      element.remove();
    },
  };
}

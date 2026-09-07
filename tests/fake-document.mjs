// A stand-in for the SJON editing bridge, so the editing surface can be tested
// without SJON's wasm. It lies about nothing the surface depends on: addresses
// over named roots, the five verbs, change records with the new revision, a
// refusal for a stale revision, and a log of the checkpoint and restore calls a
// preview and its discard make. Diagnostics and provenance are stubs until the
// real bridge supplies them.
//
//   resolve(address)             address to its value
//   inspect(address)             address to what can be done to it, or a refusal
//   preview(address, value)      an override with no commit, over a checkpoint
//   discard(address)             the committed record again, over a restore
//   commit(actions, revision)    a batch to a new revision, or diagnostics
//   subscribe(fn)                every commit, as { revision, changes }
//   undo()                       the last commit, as a commit like any other
//
// A document is named roots of nested plain objects. An address is `root:a/b/c`,
// animader's named node and path with the root in front, because the same path
// lives in PROGRAM, WORLD, SESSION and VIEW and a control has to say which.
// Order inside an object is the order of the forms, so a form keeps its name
// when its neighbours move and the surface never re-addresses anything.

export const parse = address => {
  const at = String(address).indexOf(':');
  if (at === -1) throw new TypeError(`fake document: ${address} names no root`);
  return { root: address.slice(0, at), path: address.slice(at + 1).split('/') };
};

export const format = (root, path) => `${root}:${path.join('/')}`;

// The eight SJON operations aimed at an address. The fake understands five of
// them; `wrap`, `insert_root` and `remove_root` are not in these tests.
export function action(op, address, extra = {}) {
  const { root, path } = parse(address);
  return { op, root, path, ...extra };
}

export function fakeDocument(roots) {
  let revision = 1;
  const history = [];             // one entry per commit: the records that undo it
  const watchers = [];
  const previews = new Map();
  const log = [];                 // the checkpoint and restore calls, in order

  const nodeAt = (root, path) => {
    let node = roots[root];
    for (let i = 0; i < path.length && node !== undefined; i++) node = node[path[i]];
    return node;
  };
  const parentOf = ({ root, path }) => nodeAt(root, path.slice(0, -1));
  const parentAddress = ({ root, path }) => format(root, path.slice(0, -1));

  // Objects keep their keys in insertion order, so putting a key at a position
  // means writing the whole object back in the order it should have.
  const putAt = (parent, key, value, position) => {
    const entries = Object.entries(parent).filter(([name]) => name !== key);
    entries.splice(position, 0, [key, value]);
    for (const name of Object.keys(parent)) delete parent[name];
    for (const [name, held] of entries) parent[name] = held;
  };

  // One action to what it did and what would undo it. The two are the same
  // shape, so undo is a commit like any other and the surface cannot tell.
  function perform(act) {
    const address = format(act.root, act.path);
    const key = act.path[act.path.length - 1];
    const parent = parentOf(act);
    if (parent === undefined) throw new RangeError(`fake document: ${address} has no parent`);
    switch (act.op) {
      case 'replace':
      case 'set_keyword': {
        const was = parent[key];
        parent[key] = act.value;
        return [{ kind: 'value', address, value: act.value }, { kind: 'value', address, value: was }];
      }
      case 'insert_positional': {
        // A form that is already there keeps its name and its value and only
        // takes a new position, which is what a reorder is. A form that is not
        // there arrives with the action's value.
        const held = key in parent, was = held ? Object.keys(parent).indexOf(key) : -1;
        putAt(parent, key, held ? parent[key] : act.value, act.position);
        const at = position => ({ kind: 'move', address, parent: parentAddress(act), position });
        if (held) return [at(act.position), at(was)];
        return [
          { kind: 'insert', address, parent: parentAddress(act), position: act.position, value: act.value },
          { kind: 'remove', address },
        ];
      }
      case 'remove_positional':
      case 'remove_keyword': {
        const was = parent[key], position = Object.keys(parent).indexOf(key);
        delete parent[key];
        return [
          { kind: 'remove', address },
          { kind: 'insert', address, parent: parentAddress(act), position, value: was },
        ];
      }
      default:
        throw new TypeError(`fake document: ${act.op} is not one of the operations this fake performs`);
    }
  }

  // A form removed and inserted again is a move: the notification says what
  // happened to the document, not which actions said it.
  function fuse(records) {
    const out = [];
    for (const record of records) {
      const at = record.kind === 'insert' ? out.findIndex(other => other.kind === 'remove' && other.address === record.address) : -1;
      if (at === -1) out.push(record);
      else out.splice(at, 1, { kind: 'move', address: record.address, parent: record.parent, position: record.position });
    }
    return out;
  }

  function announce(changes) {
    const notification = { revision, changes };
    for (const watcher of watchers.slice()) watcher(notification);
    return notification;
  }

  function land(records, undoing) {
    const changes = fuse(records.map(pair => pair[0]));
    const back = fuse(records.map(pair => pair[1]).reverse());
    if (undoing) history.pop(); else history.push(back);
    revision++;
    return { ok: true, ...announce(changes) };
  }

  return {
    get revision() { return revision; },
    get log() { return log; },

    resolve(address) {
      const { root, path } = parse(address);
      const value = nodeAt(root, path);
      if (value === undefined) return null;
      return { address, value, span: { start: 0, end: 0 }, provenance: { source: 'fake' } };
    },

    // What the address can become: the lens a control is built from, or a
    // refusal in animader's three-part shape.
    inspect(address) {
      const found = this.resolve(address);
      if (found === null) return { refused: { what: address, why: 'no such address', offers: [] } };
      if (typeof found.value === 'object') return { address, lens: 'form', offers: ['insert_positional', 'remove_positional'] };
      if (typeof found.value === 'number') return { address, lens: 'number', offers: ['replace'] };
      return { address, lens: 'keyword', offers: ['set_keyword', 'remove_keyword'] };
    },

    // An override with an explicit destination and no commit. The checkpoint is
    // the bridge's half of "discarding gives back exactly what was there": the
    // surface restores the presentation, the bridge restores the run.
    preview(address, value) {
      log.push({ call: 'checkpoint', address });
      previews.set(address, value);
      return { kind: 'value', address, value, preview: true };
    },

    // The committed record again, for the surface to apply as one update.
    discard(address) {
      log.push({ call: 'restore', address });
      previews.delete(address);
      const found = this.resolve(address);
      return { kind: 'value', address, value: found === null ? undefined : found.value };
    },

    previewing(address) { return previews.has(address); },

    // A batch of actions against the revision the control rendered. A stale one
    // is a diagnostic and nothing is applied: a control is never the authority
    // on whether its target still exists.
    commit(actions, against) {
      if (against !== revision) {
        return {
          ok: false,
          revision,
          diagnostics: [{ code: 'stale-revision', severity: 'error', span: { start: 0, end: 0 }, path: actions.map(act => format(act.root, act.path)) }],
        };
      }
      return land(actions.map(perform), false);
    },

    // Undo is an edit. The bridge answers with a notification like any other
    // and the surface applies it without knowing which way time ran.
    undo() {
      if (history.length === 0) return { ok: false, revision, diagnostics: [{ code: 'nothing-to-undo', severity: 'info', span: { start: 0, end: 0 }, path: [] }] };
      const back = history[history.length - 1];
      // Restoring runs the inverse records as actions, so the tree and the
      // notification stay one thing.
      return land(back.map(record => perform(actionFor(record))), true);
    },

    subscribe(fn) {
      watchers.push(fn);
      return () => { const at = watchers.indexOf(fn); if (at !== -1) watchers.splice(at, 1); };
    },
  };

  // A change record, as the action that would make it. Undo runs these, so the
  // records the fake produces and the actions it takes are one vocabulary.
  function actionFor(record) {
    const { root, path } = parse(record.address);
    if (record.kind === 'value') return { op: 'replace', root, path, value: record.value };
    if (record.kind === 'insert' || record.kind === 'move') return { op: 'insert_positional', root, path, position: record.position, value: record.value };
    return { op: 'remove_positional', root, path };
  }
}

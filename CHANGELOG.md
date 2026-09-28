# Changelog

## [Unreleased]

### Added
- `validate(ops, check)`: an optional `check(operation, index, parentOf)` runs on each
  operation of the dry run with the tree as the earlier ones would leave it.
- `ownerOf` and `divide` take an optional `parentOf`, so a layer can ask them about a
  model of the tree instead of the tree.
- `committed(error, ran)`: the `committed` arithmetic for a layer that runs each
  operation as its own group.

### Changed
- `intent` asks ownership of a plan through the core's dry run instead of a second
  model of its own; the pre-flight and the run share one rule.
- The single-operation fast path in the dry run is gone: every group is checked
  against the same model.
- `op.insert` and `op.remove` refuse a non-array where the operation is built;
  the dry run no longer checks it again.

## [1.1.0] - 2026-09-08

### Added
- `interpret(source, type, args)`: the read-only half of an intent — route, guarded
  answers, dry run, ownership pass — returned frozen, without running anything.
- Trace entries now carry the whole route and frozen per-scope contributions, so
  rehearsal and `explain` can read back what happened.
- Three examples: `examples/navigation` (nested list regions building bars from one
  spec), `examples/canvas-history` (undo/redo document with replay), `examples/toolbar`
  (context-sensitive commands, a rehearsal panel, keyboard shortcuts, multiple
  toolbars, card locks).
- Rewritten README around three layers — regions, scopes, surfaces — plus execution
  and failure contracts, with a getting-started example at the top.
- Pure test suite holding the library modules at 100% line/branch/function coverage;
  a browser harness for what a fake DOM can't answer (focus, pointer gestures, canvas
  pixels) in the examples.

### Changed
- `intent` is now `interpret` followed by the execution loop and effects.

### Fixed
- A throwing interpreter now fails a rehearsal instead of leaving it silently incomplete.
- Preview follows every input and click, not only intents.
- Toolbar arrow-key navigation re-reads its buttons from the tree each time, instead of
  a cached list.

## [1.0.0]

Initial release.

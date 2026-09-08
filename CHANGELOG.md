# Changelog

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
  and failure contracts and an API reference, with a getting-started example at the top.
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

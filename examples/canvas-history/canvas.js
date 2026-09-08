// The canvas: one node, everything drawn on it, and the drag.
//
// The node is the only child of a region, so the page changes what is on screen
// by updating that child with the scene it wants drawn. Drawing is the adapter's
// work, exactly as rendering a list row is a list adapter's work. Nothing here
// adds an operation kind, and no circle is a DOM node.
//
// Coordinates come in two systems. Logical coordinates are the scene's, 640 by
// 400, and they are what the document stores. Device pixels are the backing
// buffer's, which is the CSS size times the display's pixel ratio. A pointer
// position is read from the canvas's CSS rectangle and scaled into logical
// coordinates; the pixel ratio only ever touches the backing buffer, so a
// position committed on a high-density screen means the same as one committed
// anywhere else.
//
// A drag moves pixels and nothing else. The preview scene is drawn and thrown
// away, and only the release asks the page to commit one move with the final
// logical position.
import { on } from 'domocracy';
import { BOUNDS, RADIUS, applyAction, circleOf, clamp } from './scene.js';

const FALLBACK = { paper: '#ffffff', grid: '#e6e8ec', ink: '#14181f', accent: '#2f6fed' };

const colorOf = (style, name) => style.getPropertyValue(`--stage-${name}`).trim() || FALLBACK[name];

// The topmost circle under a logical point, or null. Later circles are drawn
// over earlier ones, so the search runs backwards.
export function hitTest(scene, x, y) {
  const circles = scene.circles;
  for (let i = circles.length - 1; i >= 0; i--) {
    const circle = circles[i];
    if (Math.hypot(circle.x - x, circle.y - y) <= RADIUS) return circle.id;
  }
  return null;
}

// A client position as the scene sees it. The CSS rectangle is the whole
// conversion: the backing buffer's size does not appear.
export function toLogical(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left) / rect.width * BOUNDS.width,
    y: (clientY - rect.top) / rect.height * BOUNDS.height,
  };
}

function draw(canvas, presentation) {
  const context = canvas.getContext('2d');
  const style = getComputedStyle(canvas);
  // The transform is set on every draw because resizing the backing buffer
  // resets the context, and a redraw after a resize has to say so again.
  const scale = canvas.width / BOUNDS.width;
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.clearRect(0, 0, BOUNDS.width, BOUNDS.height);
  context.fillStyle = colorOf(style, 'paper');
  context.fillRect(0, 0, BOUNDS.width, BOUNDS.height);

  context.strokeStyle = colorOf(style, 'grid');
  context.lineWidth = 1;
  context.beginPath();
  for (let x = 80; x < BOUNDS.width; x += 80) { context.moveTo(x, 0); context.lineTo(x, BOUNDS.height); }
  for (let y = 80; y < BOUNDS.height; y += 80) { context.moveTo(0, y); context.lineTo(BOUNDS.width, y); }
  context.stroke();

  // Where the dragged circle was when the drag started, so the preview says what
  // it is: a proposal that has not been committed.
  if (presentation.origin) {
    context.strokeStyle = colorOf(style, 'ink');
    context.globalAlpha = 0.3;
    context.setLineDash([4, 4]);
    context.beginPath();
    context.arc(presentation.origin.x, presentation.origin.y, RADIUS, 0, Math.PI * 2);
    context.stroke();
    context.setLineDash([]);
    context.globalAlpha = 1;
  }

  for (const circle of presentation.scene.circles) {
    context.fillStyle = circle.color;
    context.beginPath();
    context.arc(circle.x, circle.y, RADIUS, 0, Math.PI * 2);
    context.fill();
    if (circle.id === presentation.selected) {
      context.strokeStyle = colorOf(style, 'accent');
      context.lineWidth = 3;
      context.beginPath();
      context.arc(circle.x, circle.y, RADIUS + 6, 0, Math.PI * 2);
      context.stroke();
    }
    context.fillStyle = '#ffffff';
    context.font = '600 15px system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(circle.name, circle.x, circle.y);
  }
}

// `hooks` is the page: what the document currently says, whether editing is
// allowed right now, and what to do with a selection, a preview and a release.
export function createStage(container, hooks) {
  let canvas = null, shown = null, gesture = null, disposed = false;

  const adapter = {
    create() {
      canvas = document.createElement('canvas');
      canvas.className = 'stage-canvas';
      canvas.tabIndex = 0;
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', 'Three circles on a grid. The inspector below reports and changes the selected one.');
      canvas.width = BOUNDS.width;
      canvas.height = BOUNDS.height;
      return canvas;
    },
    update(node, presentation) {
      shown = presentation;
      draw(node, presentation);
    },
  };

  const previewOf = () => ({
    scene: applyAction(hooks.scene(), { kind: 'move', id: gesture.id, x: gesture.x, y: gesture.y }),
    selected: gesture.id,
    origin: { x: gesture.originX, y: gesture.originY },
  });

  // Every way a gesture can end without a commit: Escape, a cancelled pointer,
  // capture lost to something else, the window losing focus, a document that
  // changed underneath, and teardown. A caller that names a pointer abandons
  // only that pointer's gesture, because a second pointer cancelling on the
  // same canvas says nothing about the drag the first one is running. The
  // callers that name none mean this gesture, whichever pointer it belongs to.
  const abandon = pointerId => {
    if (gesture === null) return false;
    if (pointerId !== undefined && pointerId !== gesture.pointerId) return false;
    const held = gesture;
    gesture = null;
    if (canvas !== null && canvas.hasPointerCapture?.(held.pointerId)) canvas.releasePointerCapture(held.pointerId);
    hooks.dragging(false);
    hooks.restore();
    return true;
  };

  const offs = [
    on(container, 'pointerdown', '.stage-canvas', (event, node) => {
      if (gesture !== null || hooks.busy() || event.button !== 0) return;
      const point = toLogical(node, event.clientX, event.clientY);
      const id = hitTest(hooks.scene(), point.x, point.y);
      if (id === null) return;
      // The default would start a text selection or a pan, and the focus it
      // would give the canvas is given here instead so Escape has somewhere to
      // land. Scrolling is refused with it: the canvas is under the pointer
      // already, and scrolling to it would move the page out from under the
      // drag that is starting.
      event.preventDefault();
      node.focus({ preventScroll: true });
      const circle = circleOf(hooks.scene(), id);
      gesture = {
        id,
        pointerId: event.pointerId,
        revision: hooks.revision(),
        grabX: point.x - circle.x,
        grabY: point.y - circle.y,
        originX: circle.x,
        originY: circle.y,
        x: circle.x,
        y: circle.y,
        moved: false,
      };
      // Capture keeps the moves coming while the pointer leaves the canvas. It
      // refuses a pointer that is no longer active, which happens when a
      // release beats the handler and in any test that dispatches its own
      // pointer events, and the drag works without it either way.
      try { node.setPointerCapture(event.pointerId); } catch { /* no active pointer */ }
      hooks.select(id);
      hooks.dragging(true);
    }),

    on(container, 'pointermove', '.stage-canvas', (event, node) => {
      if (gesture === null || event.pointerId !== gesture.pointerId) return;
      const point = toLogical(node, event.clientX, event.clientY);
      const next = clamp(point.x - gesture.grabX, point.y - gesture.grabY);
      if (next.x === gesture.x && next.y === gesture.y) return;
      gesture.x = next.x;
      gesture.y = next.y;
      gesture.moved = next.x !== gesture.originX || next.y !== gesture.originY;
      // The preview is pixels. The document has not been asked for anything yet.
      hooks.render(previewOf());
    }),

    on(container, 'pointerup', '.stage-canvas', (event, node) => {
      if (gesture === null || event.pointerId !== gesture.pointerId) return;
      const held = gesture;
      // The gesture ends before the commit, so the release of the capture that
      // follows finds nothing left to cancel.
      gesture = null;
      if (node.hasPointerCapture?.(held.pointerId)) node.releasePointerCapture(held.pointerId);
      hooks.dragging(false);
      // A document that moved during the drag invalidates the release: the
      // preview was drawn against a scene that is no longer the document's.
      if (!held.moved || hooks.revision() !== held.revision) { hooks.restore(); return; }
      hooks.commit(held.id, held.x, held.y);
    }),

    on(container, 'pointercancel', '.stage-canvas', event => { abandon(event.pointerId); }),
    on(container, 'lostpointercapture', '.stage-canvas', event => { abandon(event.pointerId); }),
    on(container, 'keydown', '.stage-canvas', event => {
      if (event.key !== 'Escape') return;
      if (abandon()) event.preventDefault();
    }),
  ];

  const onBlur = () => { abandon(); };   // the window losing focus ends any gesture
  window.addEventListener('blur', onBlur);

  // The backing buffer follows the CSS size and the pixel ratio. Resizing resets
  // the context, so the current presentation is drawn again; the scene and the
  // history are not involved and no entry is written.
  const resize = () => {
    if (canvas === null || shown === null) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return;
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(width * BOUNDS.height / BOUNDS.width));
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = width;
    canvas.height = height;
    hooks.render(shown);
  };

  const watcher = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
  if (watcher !== null) watcher.observe(container);

  return {
    adapter,
    get canvas() { return canvas; },
    get dragging() { return gesture !== null; },
    cancel: abandon,
    resize,
    dispose() {
      if (disposed) return;
      disposed = true;
      gesture = null;
      for (const off of offs) off();
      window.removeEventListener('blur', onBlur);
      if (watcher !== null) watcher.disconnect();
    },
  };
}

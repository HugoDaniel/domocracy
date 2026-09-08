# Build a control that changes meaning

This walkthrough builds one Apply button that moves between a Draft section and a Review section. Along the way, you will give each section its own answer, show that answer as a caption, and move the existing control between them. For the idea behind this arrangement, start with the [README](../README.md).

## Install and run

```sh
npm install domocracy
```

The tutorial uses two files, `index.html` and `main.js`, beside your `node_modules` directory. It runs directly in the browser with an import map; no build step is needed.

Serve that directory over HTTP. For example, with Python installed:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000` after creating the files below. Use HTTP rather than opening the HTML through `file://`.

In a project with a bundler, use the same package imports and omit the HTML import map.

## One button, two places

We will build a small page with a Draft section and a Review section. One Apply button will travel between them. Its caption will describe what it would do in its current location.

The example records a title in a JavaScript variable and displays a review decision. Everything stays in this page; there is no server or persistent storage.

### 1. Create the page

Put this in `index.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>One button, two places</title>
  <script type="importmap">
  {
    "imports": {
      "domocracy": "./node_modules/domocracy/domocracy.js",
      "domocracy/intent": "./node_modules/domocracy/intent.js"
    }
  }
  </script>
</head>
<body>
  <main id="example">
    <section id="draft">
      <h2>Draft</h2>
      <label>Title <input id="title" value="My first draft"></label>
      <div id="draft-slot">
        <div id="controls">
          <button id="apply" type="button" aria-describedby="caption">Apply</button>
          <p id="caption"></p>
        </div>
      </div>
    </section>

    <section id="review">
      <h2>Review</h2>
      <p>Approve the last recorded title.</p>
      <div id="review-slot"></div>
    </section>

    <p>
      <button type="button" data-place="draft">Put Apply in Draft</button>
      <button type="button" data-place="review">Put Apply in Review</button>
    </p>
    <p id="status" role="status"></p>
  </main>
  <script type="module" src="./main.js"></script>
</body>
</html>
```

The button and its caption share a wrapper, `controls`, so they can move together. The two slots are ordinary `div` elements. Their IDs have no special meaning to domocracy.

### 2. Give each place an answer

An **intent** is a named request raised from an element. Here the name is `draft:apply`, and the source is the Apply button.

A **scope** registers answers on an ancestor element. When a request is raised, domocracy walks up from the source's parent and asks the scopes along that path, nearest first. The function that answers is called an **interpreter**.

Start `main.js` with:

```js
import { on, region } from 'domocracy';
import { scope, interpret, intent, effect } from 'domocracy/intent';

const example = document.querySelector('#example');
const draft = document.querySelector('#draft');
const review = document.querySelector('#review');
const titleInput = document.querySelector('#title');
const controls = document.querySelector('#controls');
const applyButton = document.querySelector('#apply');
const caption = document.querySelector('#caption');
const status = document.querySelector('#status');

let recordedTitle = '';

const draftScope = scope(draft);
const reviewScope = scope(review);

const announce = text => ({ type: 'tutorial.announce', text });

// A refusal is this application's convention: explain it and announce why.
function refuse(reason) {
  return {
    disposition: 'consume',
    refused: reason,
    effects: [announce(reason)],
  };
}

draftScope.handle('draft:apply', () => {
  const title = titleInput.value.trim();
  if (title === '') return refuse('Enter a title first.');

  return {
    disposition: 'consume',
    meaning: `Record “${title}” in this page.`,
    effects: [{ type: 'tutorial.record', title }],
  };
});

reviewScope.handle('draft:apply', () => {
  if (recordedTitle === '') return refuse('Record a title in Draft first.');

  return {
    disposition: 'consume',
    meaning: `Approve “${recordedTitle}”.`,
    effects: [announce(`Approved “${recordedTitle}”.`)],
  };
});
```

Each interpreter reads the current state and returns a **plan**. Returning the plan does not perform its work.

`disposition: 'consume'` means “include my contribution and stop asking outer scopes.” We will meet the other dispositions when we get to nested scopes.

`meaning` and `refused` are fields we chose for this example. Domocracy preserves the plan in its trace, but gives those fields no built-in behavior. That leaves applications free to describe their decisions in their own words.

### 3. Run the work when the button is pressed

An **effect request** describes work by type and arguments. For example, `{ type: 'tutorial.record', title }` asks to record a particular title. An **effect adapter** is the function registered to perform that work.

Append this to `main.js`:

```js
const offAnnounce = effect('tutorial.announce', request => {
  status.textContent = request.text;
});

const offRecord = effect('tutorial.record', request => {
  recordedTitle = request.title;
  status.textContent = `Recorded “${recordedTitle}” in this page.`;
});

const offApply = on(example, 'click', '#apply', (event, button) => {
  intent(button, 'draft:apply');
});
```

`on` registers a delegated handler on `example`. When a click comes from the matching button, the handler receives that button as its second argument. The handler raises the request; it contains no decision about recording or approving a title.

`intent` collects the plans, checks their proposed DOM operations, executes those operations, and then runs the effects. Our first example uses effects only.

Try Apply in Draft. It records the title. Clear the input and press it again: the refusal runs its announcement effect, so the status explains what is missing.

Interpreters must read and describe work without performing it. Keep mutations in rendering adapters and effect adapters. This separation is what makes the next step possible.

### 4. Read the answer before running it

`interpret` takes the same arguments as `intent`. It performs the same interpretation and checks, then returns without executing operations or effects.

Append:

```js
function refresh() {
  const preview = interpret(applyButton, 'draft:apply');
  // This tutorial has one answering scope on either route.
  const plan = preview.trace[0]?.plan;
  const reason = plan?.refused;

  caption.textContent = reason ?? plan?.meaning ?? 'No place answers here.';
  applyButton.setAttribute('aria-disabled', String(reason !== undefined));
}

const offInput = on(example, 'input', '#title', refresh);
refresh();
```

The caption now describes the action using the interpreter's own words. `aria-describedby` connects that visible explanation to the button.

Availability comes from the same refusal decision. This example uses `aria-disabled` and deliberately keeps activation connected: pressing a refused action runs its explanatory announcement. Setting the native `disabled` property would prevent that activation.

Type and clear the title. The caption changes, but no title is recorded by previewing. When you press Apply, `intent` interprets again using the current values.

A preview describes the state at the time you asked. The application is responsible for refreshing it when that state changes; domocracy does not watch inputs or application variables automatically.

### 5. Move the control and change its context

A **region** manages the direct child elements of a container. It can adopt children already in the page, insert new ones, update them, move them, and remove them.

Register a region for each slot, then move the existing wrapper between them:

```js
const slotAdapter = {
  create() {
    throw new Error('These slots receive existing controls through moves.');
  },
};

const slots = {
  draft: region(document.querySelector('#draft-slot'), slotAdapter),
  review: region(document.querySelector('#review-slot'), slotAdapter),
};

const offTravel = on(example, 'click', '[data-place]', (event, button) => {
  const source = Object.values(slots).find(slot => slot.container === controls.parentElement);
  source.move(controls, null, slots[button.dataset.place]);
});

// Registered after the action handlers, so captions read their completed work.
const offRefresh = on(example, 'click', 'button', refresh);
```

The adapter's `create` method is unused here: the regions receive the wrapper through a move. `null` means “place it at the end.”

Record a title in Draft, then click **Put Apply in Review**. The caption becomes “Approve…” and pressing the same Apply button announces approval. Return it to Draft and it records titles again.

The button, caption, and click handler are unchanged. The request now takes a different route:

```text
In Draft:   Apply button → controls → draft-slot  → Draft scope
In Review:  Apply button → controls → review-slot → Review scope
```

A move retains the same DOM node. Where the browser supports a state-preserving `moveBefore` and the move meets its conditions, browser state such as focus can survive too. The fallback retains node identity but does not guarantee focus preservation. The toolbar example demonstrates a focused button moving itself between rooms.

### 6. Clean up when the feature leaves

For a page that stays mounted until navigation, the browser releases its resources on leaving. If your application mounts and unmounts this feature, retain the returned cleanup functions:

```js
function dispose() {
  offApply();
  offInput();
  offTravel();
  offRefresh();
  offRecord();
  offAnnounce();
  draftScope.dispose();
  reviewScope.dispose();
  example.remove();
}
```

A scope's `dispose()` also removes its interpreters. Regions have no `dispose()` method; reuse a registered region while its container remains in use. Timers, subscriptions, or embedded widgets created by your adapters need their own cleanup.


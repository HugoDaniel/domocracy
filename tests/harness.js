// The harness the browser suites share. Each suite imports `test` and
// registers; tests/index.html loads the suites in order and then calls `run`,
// which gives every test an empty sandbox element in the document and reports
// through window.__results, which tests/run.mjs reads.
const results = { passed: 0, failed: [], notes: [], done: false };
window.__results = results;

const tests = [];
export const test = (name, fn) => tests.push([name, fn]);

// A line the runner prints after the count: a measurement, not an assertion.
export const note = line => results.notes.push(line);

export const assert = (ok, message) => { if (!ok) throw new Error(message); };

export const equal = (actual, expected, message) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}: got ${a}, expected ${e}`);
};

export const throws = (fn, Type, message) => {
  try { fn(); } catch (error) {
    if (error instanceof Type) return error;
    throw new Error(`${message}: threw ${error.constructor.name} (${error.message})`);
  }
  throw new Error(`${message}: did not throw`);
};

export async function run() {
  const out = document.getElementById('out'), sandbox = document.getElementById('sandbox');
  const lines = [];
  for (const [name, fn] of tests) {
    sandbox.textContent = '';
    try {
      await fn(sandbox);
      results.passed++;
      lines.push(`<span class="ok">ok</span>   ${name}`);
    } catch (error) {
      results.failed.push({ name, error: error.message });
      lines.push(`<span class="fail">FAIL</span> ${name}\n     ${error.message}`);
    }
  }
  sandbox.textContent = '';
  lines.push('', `${results.passed} passed, ${results.failed.length} failed`, ...results.notes);
  out.innerHTML = lines.join('\n');
  results.done = true;
}

#!/usr/bin/env node
// Runs tests/index.html in headless Chrome and prints the results.
//
//   node tests/run.mjs            headless
//   node tests/run.mjs --headed   watch it in a window
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { startServer, launchChrome, openPage, sleep } from './chrome.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const server = await startServer(repository);
const browser = await launchChrome({ headless: !process.argv.includes('--headed') });
try {
  const page = await openPage(browser.client, server.url + '/tests/index.html');
  let results = null;
  for (let waited = 0; waited < 10000 && !results?.done; waited += 50) {
    results = await page.eval('window.__results ?? null');
    if (!results?.done) await sleep(50);
  }
  if (!results?.done) throw new Error('the tests did not finish. ' + page.errors.join('; '));
  for (const failure of results.failed) console.log(`FAIL ${failure.name}\n     ${failure.error}`);
  if (page.errors.length) console.log('page errors:\n' + page.errors.join('\n'));
  console.log(`${results.passed} passed, ${results.failed.length} failed`);
  for (const line of results.notes ?? []) console.log(line);
  process.exitCode = results.failed.length || page.errors.length ? 1 : 0;
} finally {
  await browser.close();
  await server.close();
}

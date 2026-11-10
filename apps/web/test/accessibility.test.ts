import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tabDestination } from '../lib/tab-navigation';
const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('horizontal tabs wrap in both directions and support Home/End', () => {
  assert.equal(tabDestination('ArrowRight', 4, 5), 0);
  assert.equal(tabDestination('ArrowLeft', 0, 5), 4);
  assert.equal(tabDestination('ArrowRight', 1, 5), 2);
  assert.equal(tabDestination('Home', 3, 5), 0);
  assert.equal(tabDestination('End', 1, 5), 4);
});
test('tab exploration does not consume native activation or vertical scrolling', () => {
  for (const key of ['Enter', ' ', 'Tab', 'ArrowDown', 'ArrowUp', 'Escape']) {
    assert.equal(tabDestination(key, 1, 5), null);
  }
  assert.equal(tabDestination('ArrowRight', 0, 0), null);
});
test('tab markup and panel have connected names, roving tab stop and manual activation', () => {
  const tabs = source('../components/agreement-tabs.tsx');
  const app = source('../components/fairshare-app.tsx');
  assert.match(tabs, /role="tablist" aria-label="Agreement sections"/);
  assert.match(tabs, /tabIndex=\{value === tab \? 0 : -1\}/);
  assert.match(tabs, /aria-controls=\{value === tab \? "agreement-panel"/);
  assert.match(app, /role="tabpanel" id="agreement-panel" aria-labelledby=\{`agreement-tab-\$\{tab\}`\}/);
  assert.match(tabs, /buttons.current\[next\]\?\.focus\(\)/);
});
test('keyboard skip target and shared notice announcements are present', () => {
  const app = source('../components/fairshare-app.tsx');
  assert.match(app, /href="#main-content"/);
  assert.match(app, /id="main-content" tabIndex=\{-1\}/);
  assert.match(source('../components/ui.tsx'), /role=\{warning \? "alert" : "status"\}/);
});
test('small screens retain sign out and overflowing dialog content can scroll', () => {
  const css = source('../app/globals.css');
  assert.match(css, /\.sidebar-bottom \{ display: flex;/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(source('../src/components/payouts.module.css'), /\.drawer \{ overflow-y:auto;/);
});

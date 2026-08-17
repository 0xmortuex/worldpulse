import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  HISTORY_KEY,
  HISTORY_LIMIT,
  SAVED_KEY,
  clearAll,
  history,
  recordView,
  removeItem,
  renderDashboard,
  saveItem,
  savedItems,
  type Store,
} from '../src/ui/dashboard';

const NOW = Date.UTC(2026, 7, 17, 12, 0, 0);

function memoryStore(seed: Record<string, string> = {}): Store & { data: Record<string, string> } {
  const data: Record<string, string> = { ...seed };
  return {
    data,
    getItem: (key) => (key in data ? (data[key] as string) : null),
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

/** A store that refuses every operation, as a full quota or a blocked origin does. */
function hostileStore(): Store {
  return {
    getItem: () => {
      throw new Error('storage disabled');
    },
    setItem: () => {
      throw new Error('quota exceeded');
    },
    removeItem: () => {
      throw new Error('storage disabled');
    },
  };
}

test('saving and removing round-trips', () => {
  const store = memoryStore();
  saveItem(store, { code: 'FRA', name: 'France', savedAt: NOW });
  saveItem(store, { code: 'JPN', name: 'Japan', savedAt: NOW + 1000 });

  assert.deepEqual(savedItems(store).map((i) => i.code), ['JPN', 'FRA'], 'newest first');

  removeItem(store, 'FRA');
  assert.deepEqual(savedItems(store).map((i) => i.code), ['JPN']);
});

test('saving the same country twice does not duplicate it', () => {
  const store = memoryStore();
  saveItem(store, { code: 'FRA', name: 'France', savedAt: NOW });
  saveItem(store, { code: 'FRA', name: 'France', savedAt: NOW + 5000 });

  const items = savedItems(store);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.savedAt, NOW + 5000, 're-saving refreshes rather than appends');
});

test('history moves a repeat visit rather than logging it again', () => {
  const store = memoryStore();
  recordView(store, { code: 'FRA', name: 'France', seenAt: NOW });
  recordView(store, { code: 'JPN', name: 'Japan', seenAt: NOW + 1000 });
  recordView(store, { code: 'FRA', name: 'France', seenAt: NOW + 2000 });

  assert.deepEqual(history(store).map((h) => h.code), ['FRA', 'JPN']);
});

test('history is capped', () => {
  const store = memoryStore();
  for (let i = 0; i < HISTORY_LIMIT + 10; i += 1) {
    recordView(store, { code: `C${i}`, name: `Country ${i}`, seenAt: NOW + i });
  }
  assert.equal(history(store).length, HISTORY_LIMIT);
});

test('clear-all clears BOTH lists, not just the visible one', () => {
  const store = memoryStore();
  saveItem(store, { code: 'FRA', name: 'France', savedAt: NOW });
  recordView(store, { code: 'JPN', name: 'Japan', seenAt: NOW });

  clearAll(store);
  assert.deepEqual(savedItems(store), []);
  assert.deepEqual(history(store), []);
});

/**
 * PLANTED (rule 27): storage containing something this app did not write.
 *
 * Another tab, an older version, or a user with devtools can leave anything in
 * these keys. Every one of these must read as "nothing saved" rather than
 * throwing, because an exception here is thrown during render and takes the
 * page down — a far worse failure than an empty list.
 */
test('planted: malformed storage reads as empty, never as an exception', () => {
  for (const junk of ['not json', '{}', 'null', '[', '42', '"a string"']) {
    const store = memoryStore({ [SAVED_KEY]: junk, [HISTORY_KEY]: junk });
    assert.deepEqual(savedItems(store), [], `saved list from ${junk}`);
    assert.deepEqual(history(store), [], `history from ${junk}`);
  }
});

test('planted: rows missing a code are dropped rather than rendered blank', () => {
  const store = memoryStore({
    [SAVED_KEY]: JSON.stringify([{ name: 'No code', savedAt: NOW }, { code: 'FRA', name: 'France', savedAt: NOW }]),
  });
  assert.deepEqual(savedItems(store).map((i) => i.code), ['FRA']);
});

test('a storage that throws on every call degrades to empty, and rendering still works', () => {
  const store = hostileStore();
  assert.deepEqual(savedItems(store), []);
  assert.deepEqual(history(store), []);

  // These must not throw either.
  saveItem(store, { code: 'FRA', name: 'France', savedAt: NOW });
  clearAll(store);

  const html = renderDashboard(store, NOW);
  assert.ok(html.includes('Nothing saved yet.'));
});

/**
 * §4's PROHIBITION, asserted against the rendered markup.
 *
 * "No clearance level, no tier badge, no 'access' language." The reason is not
 * taste: this project is non-commercial with nothing to gate, so a clearance
 * indicator over a public dataset implies the data is privileged when it is
 * not. Checked as text because that is the form the violation would take.
 */
test('the dashboard uses no clearance, tier or access language', () => {
  const store = memoryStore();
  saveItem(store, { code: 'FRA', name: 'France', savedAt: NOW });
  recordView(store, { code: 'JPN', name: 'Japan', seenAt: NOW });

  const html = renderDashboard(store, NOW).toLowerCase();
  for (const banned of ['clearance', 'tier', 'classified', 'access level', 'unlock', 'premium', 'upgrade']) {
    assert.ok(!html.includes(banned), `rendered markup contains "${banned}"`);
  }
});

test('the clear-all control is visible, not hidden behind a menu', () => {
  const html = renderDashboard(memoryStore(), NOW);
  assert.ok(html.includes('data-dash-clear'));
  assert.ok(/Clear everything stored in this browser/.test(html));
});

test('the panel states that storage is local and nothing is sent anywhere', () => {
  // Collapse whitespace first: the template wraps its prose across lines, so a
  // phrase can be split by a newline and indentation without changing a word.
  const html = renderDashboard(memoryStore(), NOW).replace(/\s+/g, ' ');
  assert.ok(/stored in this browser only/i.test(html));
  assert.ok(/nothing is sent anywhere/i.test(html));
});

test('a future timestamp reports the time as unavailable, not as a negative age', () => {
  const store = memoryStore();
  saveItem(store, { code: 'FRA', name: 'France', savedAt: NOW + 3_600_000 });
  const html = renderDashboard(store, NOW);
  assert.ok(html.includes('time unavailable'), html.slice(0, 400));
  assert.ok(!/-\d+ (min|h|d) ago/.test(html));
});

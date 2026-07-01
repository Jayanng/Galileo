import assert from 'node:assert/strict';
import { record, lookup, count, clear } from './usernameIndex';

// Start from a clean state.
clear();
assert.equal(count(), 0, 'fresh index is empty');

// 1) Case-insensitive record/lookup.
record('@Alice', 'user-1');
assert.equal(lookup('alice'), 'user-1', 'lowercase lookup matches stored mixed-case key');

// 2) Leading @ stripped on lookup.
record('@Bob', 'user-2');
assert.equal(lookup('@bob'), 'user-2', 'leading @ is stripped on lookup');

// 3) Whitespace trimmed.
record('  Carol ', 'user-3');
assert.equal(lookup('carol'), 'user-3', 'surrounding whitespace is trimmed');

// 4) Last writer wins.
record('@Dave', 'user-4');
record('@Dave', 'user-5');
assert.equal(lookup('dave'), 'user-5', 'second record overwrites first');

// Sanity: count reflects distinct keys.
assert.equal(count(), 4, 'four distinct keys are tracked');

// 5) Null / empty / whitespace username is a no-op (not stored, not retrievable).
record(null, 'user-x');
record('', 'user-x');
record('   ', 'user-x');
assert.equal(count(), 4, 'null/empty/whitespace username does not add a key');
assert.equal(lookup(''), null, 'empty lookup is null');
assert.equal(lookup('   '), null, 'whitespace-only lookup is null');
assert.equal(lookup('user-x'), null, 'no key was ever stored for "user-x"');

// 6) clear() drops everything.
clear();
assert.equal(count(), 0, 'clear empties the index');
assert.equal(lookup('alice'), null, 'lookup after clear is null');
assert.equal(lookup('@bob'), null, 'lookup after clear is null');

console.log('usernameIndex: case-insensitive record/lookup and clear() passed ✓');

import assert from 'node:assert/strict';

const base = process.env.PINKY_API_BASE || 'http://127.0.0.1:3100';
async function post(action, body) {
  const response = await fetch(`${base}/api/${action}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await response.json();
  assert.equal(response.status, 200, `${action}: ${data.error || response.status}`);
  return data;
}
async function state(session) {
  const response = await fetch(`${base}/api/state?${new URLSearchParams(session)}`);
  assert.equal(response.status, 200);
  return response.json();
}
async function finish(first, second, firstMove, secondMove) {
  for (let round = 1; round <= 10; round++) {
    if (round > 1) await post('next', first);
    await post('choose', { ...first, move: firstMove });
    await post('choose', { ...second, move: secondMove });
  }
  return state(first);
}

const first = await post('create', {});
const challenge = await state(first);
await post('select-emoji', { ...first, emoji: challenge.emojis[0] });
const second = await post('confirm', { code: first.code, emoji: challenge.emojis[0] });
const firstGame = await finish(first, second, 'cooperate', 'cooperate');
assert.equal(firstGame.phase, 'finished');
assert.deepEqual(firstGame.totals, [36, 36]);
const firstCount = firstGame.daily?.count ?? 0;
await post('restart', first);
const secondGame = await finish(first, second, 'defect', 'defect');
assert.deepEqual(secondGame.totals, [-36, -36]);
assert.equal(secondGame.daily.count, firstCount + 1, 'A replay is a separate completed game');
assert.deepEqual((await state(second)).daily, secondGame.daily, 'Both teams see the same comparison');
assert.deepEqual((await state(first)).daily, secondGame.daily, 'Polling must not count the game twice');
console.log('Daily comparison, replay archive, and two-phone consistency: OK');

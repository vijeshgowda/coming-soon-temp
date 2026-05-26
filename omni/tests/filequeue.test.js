/**
 * Omni — File Queue Tests
 *
 * Tests the sequential file queue logic: files sent one at a time,
 * progress tracked, errors don't abort the queue.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('File Queue Logic', () => {
  // Simulate the queue processing logic from app.js
  async function processFileQueue(queue, sendFn) {
    const results = [];
    while (queue.length > 0) {
      const file = queue.shift();
      try {
        await sendFn(file);
        results.push({ name: file.name, status: 'sent' });
      } catch (err) {
        results.push({ name: file.name, status: 'failed', error: err.message });
      }
    }
    return results;
  }

  test('sends files sequentially in order', async () => {
    const sent = [];
    const queue = [
      { name: 'a.jpg', size: 100 },
      { name: 'b.png', size: 200 },
      { name: 'c.pdf', size: 300 },
    ];
    const results = await processFileQueue(queue, async (file) => {
      sent.push(file.name);
    });
    assert.deepEqual(sent, ['a.jpg', 'b.png', 'c.pdf']);
    assert.equal(results.length, 3);
    assert.ok(results.every(r => r.status === 'sent'));
  });

  test('continues after a failed send', async () => {
    const queue = [
      { name: 'a.jpg', size: 100 },
      { name: 'fail.bin', size: 200 },
      { name: 'c.pdf', size: 300 },
    ];
    const results = await processFileQueue(queue, async (file) => {
      if (file.name === 'fail.bin') throw new Error('Channel closed');
    });
    assert.equal(results[0].status, 'sent');
    assert.equal(results[1].status, 'failed');
    assert.equal(results[1].error, 'Channel closed');
    assert.equal(results[2].status, 'sent');
  });

  test('handles empty queue gracefully', async () => {
    const results = await processFileQueue([], async () => {});
    assert.deepEqual(results, []);
  });

  test('processes single file', async () => {
    const queue = [{ name: 'solo.txt', size: 50 }];
    const results = await processFileQueue(queue, async () => {});
    assert.equal(results.length, 1);
    assert.equal(results[0].name, 'solo.txt');
    assert.equal(results[0].status, 'sent');
  });

  test('queue is empty after processing', async () => {
    const queue = [
      { name: 'a.jpg', size: 100 },
      { name: 'b.png', size: 200 },
    ];
    await processFileQueue(queue, async () => {});
    assert.equal(queue.length, 0);
  });

  test('preserves file order even with varying send times', async () => {
    const sent = [];
    const queue = [
      { name: 'slow.jpg', size: 100, delay: 50 },
      { name: 'fast.png', size: 200, delay: 10 },
      { name: 'medium.pdf', size: 300, delay: 30 },
    ];
    await processFileQueue(queue, async (file) => {
      await new Promise(r => setTimeout(r, file.delay));
      sent.push(file.name);
    });
    // Sequential means order is preserved regardless of "send time"
    assert.deepEqual(sent, ['slow.jpg', 'fast.png', 'medium.pdf']);
  });

  test('all files fail still returns results for each', async () => {
    const queue = [
      { name: 'a.jpg', size: 100 },
      { name: 'b.png', size: 200 },
    ];
    const results = await processFileQueue(queue, async () => {
      throw new Error('disconnected');
    });
    assert.equal(results.length, 2);
    assert.ok(results.every(r => r.status === 'failed'));
    assert.ok(results.every(r => r.error === 'disconnected'));
  });
});

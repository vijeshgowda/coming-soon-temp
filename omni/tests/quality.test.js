/**
 * Omni — Sounds & Quality Level Tests
 *
 * Tests the pure getQualityLevel function exported from sounds.js.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const { getQualityLevel } = await import(join(__dirname, '..', 'js', 'sounds.js'));

describe('getQualityLevel', () => {
  test('returns good for high bitrate, low loss, low RTT', () => {
    const result = getQualityLevel({ bitrate: 1_500_000, packetLoss: 0.5, rtt: 0.05 });
    assert.equal(result.level, 'good');
  });

  test('returns fair for moderate bitrate', () => {
    const result = getQualityLevel({ bitrate: 150_000, packetLoss: 1.0, rtt: 0.1 });
    assert.equal(result.level, 'fair');
  });

  test('returns fair for moderate packet loss', () => {
    const result = getQualityLevel({ bitrate: 500_000, packetLoss: 5.0, rtt: 0.05 });
    assert.equal(result.level, 'fair');
  });

  test('returns fair for moderate RTT', () => {
    const result = getQualityLevel({ bitrate: 500_000, packetLoss: 1.0, rtt: 0.3 });
    assert.equal(result.level, 'fair');
  });

  test('returns poor for very low bitrate', () => {
    const result = getQualityLevel({ bitrate: 30_000, packetLoss: 0.5, rtt: 0.05 });
    assert.equal(result.level, 'poor');
  });

  test('returns poor for high packet loss', () => {
    const result = getQualityLevel({ bitrate: 1_000_000, packetLoss: 12.0, rtt: 0.05 });
    assert.equal(result.level, 'poor');
  });

  test('returns poor for high RTT', () => {
    const result = getQualityLevel({ bitrate: 1_000_000, packetLoss: 1.0, rtt: 0.6 });
    assert.equal(result.level, 'poor');
  });

  test('returns poor for all bad metrics', () => {
    const result = getQualityLevel({ bitrate: 20_000, packetLoss: 15.0, rtt: 1.0 });
    assert.equal(result.level, 'poor');
  });

  test('label includes bitrate, loss, and RTT', () => {
    const result = getQualityLevel({ bitrate: 1_500_000, packetLoss: 0.5, rtt: 0.05 });
    assert.ok(result.label.includes('1500kb/s'));
    assert.ok(result.label.includes('0.5% loss'));
    assert.ok(result.label.includes('50ms'));
  });

  test('boundary: packetLoss exactly 3 is good', () => {
    const result = getQualityLevel({ bitrate: 500_000, packetLoss: 3.0, rtt: 0.05 });
    assert.equal(result.level, 'good');
  });

  test('boundary: packetLoss just above 3 is fair', () => {
    const result = getQualityLevel({ bitrate: 500_000, packetLoss: 3.1, rtt: 0.05 });
    assert.equal(result.level, 'fair');
  });

  test('boundary: packetLoss exactly 8 is fair', () => {
    const result = getQualityLevel({ bitrate: 500_000, packetLoss: 8.0, rtt: 0.05 });
    assert.equal(result.level, 'fair');
  });

  test('boundary: packetLoss just above 8 is poor', () => {
    const result = getQualityLevel({ bitrate: 500_000, packetLoss: 8.1, rtt: 0.05 });
    assert.equal(result.level, 'poor');
  });

  test('bitrate 0 is poor', () => {
    const result = getQualityLevel({ bitrate: 0, packetLoss: 0, rtt: 0 });
    assert.equal(result.level, 'poor');
  });

  test('boundary: bitrate exactly 200000 is good', () => {
    const result = getQualityLevel({ bitrate: 200_000, packetLoss: 0, rtt: 0.01 });
    assert.equal(result.level, 'good');
  });

  test('boundary: RTT exactly 0.25 is good', () => {
    const result = getQualityLevel({ bitrate: 500_000, packetLoss: 0, rtt: 0.25 });
    assert.equal(result.level, 'good');
  });

  test('boundary: RTT just above 0.25 is fair', () => {
    const result = getQualityLevel({ bitrate: 500_000, packetLoss: 0, rtt: 0.26 });
    assert.equal(result.level, 'fair');
  });
});

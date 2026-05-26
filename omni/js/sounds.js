/**
 * Omni — Notification Sounds
 *
 * Web Audio API tones — no external audio files needed.
 * AudioContext requires user gesture to start; call ensureAudioContext()
 * from any button click handler.
 */

let ctx = null;

export function ensureAudioContext() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
}

function playTone(freq, duration, type = 'sine', gainVal = 0.15) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(gainVal, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration);
}

/** Two rising notes — peer joined */
export function playJoinTone() {
  ensureAudioContext();
  playTone(440, 0.15, 'sine', 0.12);
  setTimeout(() => playTone(660, 0.2, 'sine', 0.12), 150);
  vibrate(200);
}

/** Short blip — incoming message */
export function playMessageTone() {
  ensureAudioContext();
  playTone(880, 0.1, 'sine', 0.08);
  vibrate(100);
}

/** Descending tone — call ended */
export function playHangupTone() {
  ensureAudioContext();
  playTone(520, 0.15, 'sine', 0.1);
  setTimeout(() => playTone(340, 0.3, 'sine', 0.1), 150);
}

function vibrate(ms) {
  navigator.vibrate?.(ms);
}

// ─── Connection Quality Logic (pure, testable) ────────────────────────────────

/**
 * Determine quality level from stats.
 * @param {{ bitrate: number, packetLoss: number, rtt: number }} stats
 * @returns {{ level: 'good'|'fair'|'poor', label: string }}
 */
export function getQualityLevel({ bitrate, packetLoss, rtt }) {
  // Poor: high packet loss OR very low bitrate OR high RTT
  if (packetLoss > 8 || bitrate < 50_000 || rtt > 0.5) {
    return { level: 'poor', label: `${Math.round(bitrate / 1000)}kb/s · ${packetLoss.toFixed(1)}% loss · ${Math.round(rtt * 1000)}ms` };
  }
  // Fair: moderate issues
  if (packetLoss > 3 || bitrate < 200_000 || rtt > 0.25) {
    return { level: 'fair', label: `${Math.round(bitrate / 1000)}kb/s · ${packetLoss.toFixed(1)}% loss · ${Math.round(rtt * 1000)}ms` };
  }
  // Good
  return { level: 'good', label: `${Math.round(bitrate / 1000)}kb/s · ${packetLoss.toFixed(1)}% loss · ${Math.round(rtt * 1000)}ms` };
}

/**
 * Omni — Local Call Recorder
 *
 * Records the call to a local file, entirely in the browser (nothing leaves the
 * device — consistent with the zero-server-data model). It composites the remote
 * video (full frame) with the local camera (picture-in-picture) onto a canvas,
 * mixes both audio tracks via the Web Audio API, and feeds the combined stream
 * to a MediaRecorder.
 *
 * Usage:
 *   const rec = new CallRecorder();
 *   rec.start({ remoteVideo, localVideo, remoteStream, localStream });
 *   const blob = await rec.stop();   // webm Blob
 */
export class CallRecorder {
  constructor() {
    this.recording = false;
    this._raf = null;
    this._recorder = null;
    this._chunks = [];
    this._canvas = null;
    this._audioCtx = null;
    this._stream = null;
    this.startedAt = 0;
  }

  static isSupported() {
    return typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function';
  }

  /**
   * @param {object} o
   * @param {HTMLVideoElement} o.remoteVideo - element already playing the remote stream
   * @param {HTMLVideoElement} o.localVideo  - element already playing the local stream
   * @param {MediaStream} o.remoteStream
   * @param {MediaStream} o.localStream
   */
  start({ remoteVideo, localVideo, remoteStream, localStream }) {
    if (this.recording) return;
    if (!CallRecorder.isSupported()) throw new Error('Recording is not supported on this browser.');

    // ── Video: composite onto a canvas ───────────────────────────────────────
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d');
    this._canvas = canvas;

    const draw = () => {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Remote fills the frame (object-fit: cover)
      this._drawCover(ctx, remoteVideo, 0, 0, canvas.width, canvas.height);

      // Local as a corner PiP
      if (localVideo && localVideo.videoWidth) {
        const pw = canvas.width * 0.25;
        const ph = pw * (localVideo.videoHeight / localVideo.videoWidth || 0.5625);
        const pad = 24;
        const px = canvas.width - pw - pad;
        const py = canvas.height - ph - pad;
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 3;
        this._drawCover(ctx, localVideo, px, py, pw, ph);
        ctx.strokeRect(px, py, pw, ph);
        ctx.restore();
      }
      this._raf = requestAnimationFrame(draw);
    };
    draw();

    const canvasStream = canvas.captureStream(30);

    // ── Audio: mix local mic + remote audio ──────────────────────────────────
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const audioCtx = new AudioCtx();
    this._audioCtx = audioCtx;
    const dest = audioCtx.createMediaStreamDestination();
    let mixed = false;
    for (const s of [localStream, remoteStream]) {
      if (s && s.getAudioTracks().length) {
        try { audioCtx.createMediaStreamSource(s).connect(dest); mixed = true; } catch { /* ignore */ }
      }
    }

    // ── Combine and record ───────────────────────────────────────────────────
    const tracks = [...canvasStream.getVideoTracks()];
    if (mixed) tracks.push(...dest.stream.getAudioTracks());
    const stream = new MediaStream(tracks);
    this._stream = stream;

    const mimeType = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ].find(t => MediaRecorder.isTypeSupported(t)) || '';

    this._chunks = [];
    this._recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    this._recorder.ondataavailable = (e) => { if (e.data && e.data.size) this._chunks.push(e.data); };
    this._recorder.start(1000); // gather data every second
    this.recording = true;
    this.startedAt = Date.now();
  }

  /** Stop and return the recorded Blob (or null if nothing recorded). */
  stop() {
    return new Promise((resolve) => {
      if (!this.recording || !this._recorder) { resolve(null); return; }
      const recorder = this._recorder;
      const mimeType = recorder.mimeType || 'video/webm';
      recorder.onstop = () => {
        cancelAnimationFrame(this._raf);
        this._raf = null;
        try { this._audioCtx?.close(); } catch { /* ignore */ }
        this._stream?.getTracks().forEach(t => t.stop());
        const blob = this._chunks.length ? new Blob(this._chunks, { type: mimeType }) : null;
        this._chunks = [];
        this.recording = false;
        this._recorder = null;
        resolve(blob);
      };
      try { recorder.stop(); } catch { resolve(null); }
    });
  }

  _drawCover(ctx, video, dx, dy, dw, dh) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return;
    const scale = Math.max(dw / vw, dh / vh);
    const sw = dw / scale, sh = dh / scale;
    const sx = (vw - sw) / 2, sy = (vh - sh) / 2;
    ctx.drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh);
  }
}

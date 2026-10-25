/* =====================================================================
 * camera.js — the front camera, plus MoveNet so the app can see that
 * the student is actually still in front of it.
 *
 * The preview is mirrored with CSS; the overlay draws at raw video
 * coordinates using x = W - x so the skeleton lines up and the labels
 * stay the right way round.
 * ===================================================================== */
(function (global) {
  'use strict';

  var EDGES = [
    ['nose', 'left_eye'], ['nose', 'right_eye'],
    ['left_eye', 'left_ear'], ['right_eye', 'right_ear'],
    ['left_shoulder', 'right_shoulder'],
    ['left_shoulder', 'left_elbow'], ['left_elbow', 'left_wrist'],
    ['right_shoulder', 'right_elbow'], ['right_elbow', 'right_wrist'],
    ['left_shoulder', 'left_hip'], ['right_shoulder', 'right_hip'],
    ['left_hip', 'right_hip'],
    ['left_hip', 'left_knee'], ['left_knee', 'left_ankle'],
    ['right_hip', 'right_knee'], ['right_knee', 'right_ankle'],
    ['left_shoulder', 'nose'], ['right_shoulder', 'nose']
  ];

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function byName(list) {
    var m = {};
    for (var i = 0; i < list.length; i++) m[list[i].name || i] = list[i];
    return m;
  }

  function drawSkeleton(ctx, kp, W, H) {
    var mx = function (x) { return W - x; };
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    var i, a, b, s;
    for (i = 0; i < EDGES.length; i++) {
      a = kp[EDGES[i][0]]; b = kp[EDGES[i][1]];
      if (!a || !b || (a.score || 0) < 0.3 || (b.score || 0) < 0.3) continue;
      s = Math.min(a.score, b.score);
      ctx.strokeStyle = 'rgba(56,200,255,' + (0.25 + s * 0.7) + ')';
      ctx.lineWidth = Math.max(2, W / 300);
      ctx.beginPath();
      ctx.moveTo(mx(a.x), a.y);
      ctx.lineTo(mx(b.x), b.y);
      ctx.stroke();
    }
    for (i = 0; i < 17; i++) {
      var p = kp[Object.keys(kp)[i]];
      if (!p) continue;
      if ((p.score || 0) < 0.3) continue;
      ctx.fillStyle = p.score > 0.5 ? '#e8fbff' : 'rgba(232,251,255,0.4)';
      ctx.beginPath();
      ctx.arc(mx(p.x), p.y, Math.max(2, W / 320), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function badge(ctx, text, ok, W) {
    ctx.font = '600 13px system-ui, -apple-system, "Segoe UI", sans-serif';
    var pad = 9;
    var w = ctx.measureText(text).width + pad * 2;
    var h = 24;
    var x = 8, y = ctx.canvas.height - h - 8;
    ctx.fillStyle = 'rgba(6,11,20,0.82)';
    roundRect(ctx, x, y, w, h, h / 2);
    ctx.fill();
    ctx.strokeStyle = ok ? 'rgba(52,211,153,0.9)' : 'rgba(251,191,36,0.9)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = ok ? '#6ee7b7' : '#fcd34d';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(text, x + pad, y + h / 2 + 0.5);
  }

  /* ---------------------------------------------------------------
   * Motion fallback for when TensorFlow.js / the CDN is unreachable.
   * ------------------------------------------------------------- */
  function MotionProbe(w, h) {
    this.w = w || 64; this.h = h || 48;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.w; this.canvas.height = this.h;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.prev = null; this.diff = 0; this.frame = 0;
  }
  MotionProbe.prototype.sample = function (video) {
    if (!video || video.readyState < 2 || !video.videoWidth) return this.diff;
    this.ctx.drawImage(video, 0, 0, this.w, this.h);
    var cur = this.ctx.getImageData(0, 0, this.w, this.h).data;
    if (this.prev) {
      var hits = 0, total = this.w * this.h;
      for (var i = 0; i < cur.length; i += 4) {
        var d = Math.abs(cur[i] - this.prev[i]) +
          Math.abs(cur[i + 1] - this.prev[i + 1]) +
          Math.abs(cur[i + 2] - this.prev[i + 2]);
        if (d > 70) hits++;
      }
      this.diff = hits / total;
    }
    this.prev = cur;
    this.frame++;
    return this.diff;
  };

  /* --------------------------------------------------------------- */
  var Camera = {
    stream: null,
    detector: null,
    mode: 'off',          // off | pose | motion
    present: false,
    lastPoseAt: 0,
    _raf: 0,
    _busy: false,
    _probe: null,
    _sinceEstimate: 0,

    /* ---- permission + stream ---- */
    open: function (video) {
      var self = this;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return Promise.reject(new Error('This browser cannot open the camera.'));
      }
      return navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 }, frameRate: { ideal: 30, max: 30 } },
        audio: false
      }).then(function (stream) {
        self.stream = stream;
        video.srcObject = stream;
        var play = video.play();
        if (play && play.catch) play.catch(function () {});
        return stream;
      });
    },

    close: function () {
      this.stopLoop();
      if (this.stream) {
        this.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
        this.stream = null;
      }
      if (this.detector && this.detector.dispose) { try { this.detector.dispose(); } catch (e) {} }
      this.detector = null;
      this.mode = 'off';
      this.present = false;
    },

    /* ---- MoveNet, with a motion fallback if it cannot load ---- */
    loadModel: function (onStep) {
      var self = this;
      onStep = onStep || function () {};
      if (!global.tf || !global.poseDetection) {
        self.mode = 'motion';
        onStep('Pose model unavailable — using motion instead.');
        return Promise.resolve('motion');
      }
      onStep('Loading the pose model…');
      return global.tf.setBackend('webgl')
        .catch(function () { return global.tf.setBackend('cpu'); })
        .then(function () { return global.tf.ready(); })
        .then(function () {
          return global.poseDetection.createDetector(
            global.poseDetection.SupportedModels.MoveNet,
            { modelType: global.poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING, enableTracking: false }
          );
        })
        .then(function (d) {
          self.detector = d;
          self.mode = 'pose';
          onStep('Pose model ready');
          return 'pose';
        })
        .catch(function () {
          self.mode = 'motion';
          onStep('Pose model unavailable — tracking movement instead.');
          return 'motion';
        });
    },

    /* ---- render loop ---- */
    run: function (video, canvas, onState) {
      var self = this;
      this.stopLoop();
      this._probe = new MotionProbe();
      var last = 0;

      function sizeCanvas() {
        var r = video.getBoundingClientRect();
        var dpr = Math.min(global.devicePixelRatio || 1, 2);
        var w = Math.max(1, Math.round(r.width * dpr));
        var h = Math.max(1, Math.round(r.height * dpr));
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      }

      function loop(ts) {
        self._raf = global.requestAnimationFrame(loop);
        if (!video.videoWidth) return;
        sizeCanvas();
        if (ts - last < 70) return;                 // ~14 fps is plenty
        last = ts;

        var ctx = canvas.getContext('2d');
        var W = canvas.width, H = canvas.height;
        ctx.clearRect(0, 0, W, H);

        if (self.mode === 'pose' && self.detector && !self._busy) {
          self._busy = true;
          self.detector.estimatePoses(video, { flipHorizontal: false })
            .then(function (poses) {
              self._busy = false;
              if (!poses || !poses.length) { self.present = false; return; }
              var best = null;
              for (var i = 0; i < poses.length; i++) {
                if (!best || (poses[i].score || 0) > (best.score || 0)) best = poses[i];
              }
              if (!best || (best.score || 0) < 0.2) { self.present = false; return; }
              var kp = byName(best.keypoints);
              var strong = 0;
              for (var k in kp) if (kp[k] && (kp[k].score || 0) >= 0.35) strong++;
              self.present = strong >= 6;
              self.lastPoseAt = Date.now();
              drawSkeleton(ctx, best.keypoints, W, H);
              badge(ctx, self.present ? 'Tracking you' : 'Step into view', self.present, W);
              if (onState) onState(self.present, self.mode);
            })
            .catch(function () { self._busy = false; });
        } else if (self.mode === 'motion') {
          var d = self._probe.sample(video);
          self.present = d > 0.012;
          badge(ctx, self.present ? 'Movement detected' : 'Waiting for movement', self.present, W);
          if (onState) onState(self.present, self.mode);
        }
      }
      this._raf = global.requestAnimationFrame(loop);
    },

    stopLoop: function () {
      if (this._raf) { global.cancelAnimationFrame(this._raf); this._raf = 0; }
    }
  };

  global.Camera = Camera;
})(typeof window !== 'undefined' ? window : globalThis);

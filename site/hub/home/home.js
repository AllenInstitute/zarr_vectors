/* Zarr Vectors front door: three small 3-D scenes on 2-D canvases, no libraries.
   hero     the store as a chunk lattice with streamlines and points; a query box follows the cursor
            and lights the chunks it touches, the points inside it and the whole streamlines through it
   stage    one set of vertices that becomes points, streamlines, a skeleton, a graph and a mesh as
            the chapters beside it scroll past
   pyramid  the same points merged into bin centroids, level by level
   intro    the logo's mark opens into the hero: its nodes become vertices, its cube becomes the store */
(function () {
  "use strict";

  var RM = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  var TAU = Math.PI * 2;

  /* ── small helpers ───────────────────────────────────────────────────── */
  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(r) { var u = r() || 1e-9, v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  var col = {};
  function readColours() {
    var cs = getComputedStyle(document.documentElement);
    ["bg", "ink", "ink-3", "line-2", "accent-ink", "tint", "node"].forEach(function (k) { col[k] = cs.getPropertyValue("--" + k).trim(); });
    col.dark = col.bg.toLowerCase() !== "#ffffff";
    scenes.forEach(function (s) { s.dirty = true; });
  }

  /* ── camera ─────────────────────────────────────────────────────────── */
  function Cam(yaw, pitch) { this.yaw = yaw; this.pitch = pitch; this.dist = 4.8; this.f = 3.4; this.cx = 0; this.cy = 0; this.s = 1; this.upd(); }
  Cam.prototype.upd = function () { this.c = Math.cos(this.yaw); this.sn = Math.sin(this.yaw); this.cp = Math.cos(this.pitch); this.sp = Math.sin(this.pitch); };
  Cam.prototype.p = function (x, y, z, o) {
    var x1 = this.c * x + this.sn * z, z1 = -this.sn * x + this.c * z;
    var y2 = this.cp * y - this.sp * z1, z2 = this.sp * y + this.cp * z1;
    var k = this.f / (this.dist - z2);
    o[0] = this.cx + x1 * k * this.s; o[1] = this.cy - y2 * k * this.s; o[2] = z2; o[3] = k;
    return o;
  };
  // a screen point onto the plane through the origin that faces the camera
  Cam.prototype.un = function (sx, sy) {
    var k = this.f / this.dist, x1 = (sx - this.cx) / (k * this.s), y2 = -(sy - this.cy) / (k * this.s);
    var y = this.cp * y2, z1 = -this.sp * y2;
    return [this.c * x1 - this.sn * z1, y, this.sn * x1 + this.c * z1];
  };

  /* ── a canvas that knows its size ───────────────────────────────────── */
  var scenes = [];
  function Scene(canvas) {
    this.cv = canvas; this.cx = canvas.getContext("2d"); this.W = 0; this.H = 0; this.dirty = true; this.visible = true;
    this.tmp = [0, 0, 0, 0]; this.tmp2 = [0, 0, 0, 0];
    scenes.push(this);
    var self = this;
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (e) { self.visible = e[0].isIntersecting; if (self.visible) self.dirty = true; }, { rootMargin: "100px" }).observe(canvas);
    }
  }
  Scene.prototype.resize = function () {
    var r = this.cv.getBoundingClientRect(), W = Math.max(1, Math.round(r.width)), H = Math.max(1, Math.round(r.height));
    if (W === this.W && H === this.H) return false;
    this.W = W; this.H = H; this.cv.width = W * DPR; this.cv.height = H * DPR; this.dirty = true;
    return true;
  };
  Scene.prototype.begin = function () { var c = this.cx; c.setTransform(DPR, 0, 0, DPR, 0, 0); c.clearRect(0, 0, this.W, this.H); return c; };

  // the chunk lattice of the cube [-1, 1]^3, n chunks a side
  function lattice(c, cam, n, alpha, outer) {
    var a = [0, 0, 0, 0], b = [0, 0, 0, 0], i, j, u, v, edge;
    c.lineWidth = 1; c.strokeStyle = col.ink;
    for (var axis = 0; axis < 3; axis++) {
      for (i = 0; i <= n; i++) for (j = 0; j <= n; j++) {
        u = -1 + 2 * i / n; v = -1 + 2 * j / n;
        edge = (i === 0 || i === n) && (j === 0 || j === n);
        c.globalAlpha = edge ? outer : alpha;
        if (c.globalAlpha <= 0.002) continue;
        if (axis === 0) { cam.p(-1, u, v, a); cam.p(1, u, v, b); }
        else if (axis === 1) { cam.p(u, -1, v, a); cam.p(u, 1, v, b); }
        else { cam.p(u, v, -1, a); cam.p(u, v, 1, b); }
        c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
      }
    }
    c.globalAlpha = 1;
  }
  var BOX_E = [[0, 1], [1, 3], [3, 2], [2, 0], [4, 5], [5, 7], [7, 6], [6, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  var BOX_F = [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]];
  function boxCorners(cam, lo, hi) {
    var out = [];
    for (var i = 0; i < 8; i++) out.push(cam.p(i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2], [0, 0, 0, 0]));
    return out;
  }
  function drawBox(c, P, stroke, lw, alpha, fill, falpha, dash) {
    var i, f;
    if (fill) {
      c.fillStyle = fill; c.globalAlpha = falpha;
      for (i = 0; i < 6; i++) { f = BOX_F[i]; c.beginPath(); c.moveTo(P[f[0]][0], P[f[0]][1]); c.lineTo(P[f[1]][0], P[f[1]][1]); c.lineTo(P[f[2]][0], P[f[2]][1]); c.lineTo(P[f[3]][0], P[f[3]][1]); c.closePath(); c.fill(); }
    }
    c.strokeStyle = stroke; c.lineWidth = lw; c.globalAlpha = alpha; if (dash) c.setLineDash(dash);
    c.beginPath();
    for (i = 0; i < 12; i++) { var e = BOX_E[i]; c.moveTo(P[e[0]][0], P[e[0]][1]); c.lineTo(P[e[1]][0], P[e[1]][1]); }
    c.stroke(); c.setLineDash([]); c.globalAlpha = 1;
  }
  // a vertex in the logo's style: white, ringed in magenta
  function node(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); c.stroke(); }

  // drag to turn; returns a function giving the accumulated yaw offset
  function dragYaw(el, scene) {
    var st = { yaw: 0, vel: 0, down: false, x: 0, moved: 0 };
    el.addEventListener("pointerdown", function (e) { if (e.pointerType === "touch") return; st.down = true; st.x = e.clientX; st.moved = 0; el.setPointerCapture(e.pointerId); });
    el.addEventListener("pointermove", function (e) {
      if (!st.down) return;
      var dx = e.clientX - st.x; st.x = e.clientX; st.moved += Math.abs(dx);
      st.yaw += dx * 0.008; st.vel = dx * 0.008; scene.dirty = true;
    });
    function up() { st.down = false; }
    el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
    return st;
  }

  /* ── data ───────────────────────────────────────────────────────────── */
  function cluster(r, n, cx, cy, cz, s, out) {
    for (var i = 0; i < n; i++) out.push([clamp(cx + gauss(r) * s, -0.97, 0.97), clamp(cy + gauss(r) * s * 0.8, -0.97, 0.97), clamp(cz + gauss(r) * s, -0.97, 0.97)]);
  }
  function cloud(seed, n) {
    var r = rng(seed), out = [];
    cluster(r, Math.round(n * 0.34), -0.35, 0.25, -0.2, 0.28, out);
    cluster(r, Math.round(n * 0.26), 0.45, -0.35, 0.3, 0.24, out);
    cluster(r, Math.round(n * 0.2), 0.2, 0.45, 0.55, 0.18, out);
    while (out.length < n) out.push([r() * 1.9 - 0.95, r() * 1.9 - 0.95, r() * 1.9 - 0.95]);
    return out;
  }
  function bez(a, b, c, d, t) { var u = 1 - t; return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d; }
  // bundles of curved streamlines, like tracts; three courses through the store
  var COURSES = [
    [[-0.95, -0.45, -0.5], [-0.3, 0.95, -0.1], [0.35, 0.85, 0.2], [0.95, -0.35, 0.55]],
    [[-0.25, -0.95, 0.85], [-0.6, -0.1, 0.2], [0.55, 0.2, -0.3], [0.3, 0.92, -0.85]],
    [[0.95, 0.15, -0.7], [0.2, -0.8, -0.3], [-0.4, -0.7, 0.4], [-0.92, 0.1, 0.85]],
  ];
  function bundle(seed, lines, per, spread, course) {
    var r = rng(seed), out = [], K = COURSES[course || 0];
    for (var l = 0; l < lines; l++) {
      var oy = gauss(r) * spread, oz = gauss(r) * spread, ty = gauss(r) * spread, tz = gauss(r) * spread, ox = gauss(r) * spread, line = [];
      var P0 = [K[0][0] + ox, K[0][1] + oy, K[0][2] + oz], P1 = [K[1][0] + ox, K[1][1] + oy * 0.6, K[1][2] + oz], P2 = [K[2][0] - ox, K[2][1] + ty * 0.6, K[2][2] + tz], P3 = [K[3][0] - ox, K[3][1] + ty, K[3][2] + tz];
      for (var i = 0; i < per; i++) {
        var t = i / (per - 1);
        line.push([clamp(bez(P0[0], P1[0], P2[0], P3[0], t), -0.98, 0.98), clamp(bez(P0[1], P1[1], P2[1], P3[1], t), -0.98, 0.98), clamp(bez(P0[2], P1[2], P2[2], P3[2], t), -0.98, 0.98)]);
      }
      out.push(line);
    }
    return out;
  }

  // neurons: trees grown from a soma, a few dendrites each
  function neurons(seed, somas, per) {
    var r = rng(seed), pts = [], links = [];
    somas.forEach(function (soma) {
      var base = pts.length, tips = [], k, n = 3 + Math.floor(r() * 2);
      pts.push(soma);
      for (k = 0; k < n; k++) tips.push({ i: base, d: [gauss(r), gauss(r) * 0.8, gauss(r)], life: 6 + Math.floor(r() * 5) });
      while (tips.length && pts.length - base < per) {
        var tip = tips.shift(), p0 = pts[tip.i], d = tip.d;
        d = [d[0] + gauss(r) * 0.22, d[1] + gauss(r) * 0.18, d[2] + gauss(r) * 0.22];
        var m = Math.hypot(d[0], d[1], d[2]) || 1; d = [d[0] / m, d[1] / m, d[2] / m];
        var np = [clamp(p0[0] + d[0] * 0.075, -0.97, 0.97), clamp(p0[1] + d[1] * 0.075, -0.97, 0.97), clamp(p0[2] + d[2] * 0.075, -0.97, 0.97)];
        pts.push(np); links.push([tip.i, pts.length - 1]);
        if (tip.life > 0) tips.push({ i: pts.length - 1, d: d, life: tip.life - 1 });
        if (r() < 0.13) tips.push({ i: pts.length - 1, d: [d[2] + gauss(r) * 0.5, d[1] * 0.4 + gauss(r) * 0.4, -d[0] + gauss(r) * 0.5], life: 3 + Math.floor(r() * 5) });
      }
    });
    return { pts: pts, links: links };
  }

  /* ── hero: query the store ──────────────────────────────────────────── */
  var heroCanvas = document.getElementById("hero-canvas");
  var hero = heroCanvas && new Scene(heroCanvas);
  if (hero) {
    hero.cam = new Cam(-0.62, 0.42);
    hero.N = 4;
    hero.pts = cloud(7, 320);
    hero.sk = neurons(11, [[-0.45, 0.4, -0.3], [0.42, -0.4, 0.35], [0.35, 0.45, -0.45], [-0.35, -0.45, 0.45], [0.05, 0.05, 0.1], [0.5, 0.1, 0.5], [-0.5, -0.05, -0.55]], 115);
    hero.skIn = new Uint8Array(hero.sk.pts.length);
    hero.q = [0.15, 0.1, 0.1]; hero.qt = [0.15, 0.1, 0.1]; hero.half = 0.32; hero.vel = [0.31, 0.23, 0.27];
    hero.pointer = null; hero.t = 0;
    hero.drag = dragYaw(heroCanvas, hero);
    hero.readEl = document.getElementById("hero-read");
    hero.hintEl = document.getElementById("hero-hint");
    hero.wide = function () { return window.innerWidth > 896; };
    hero.layout = function () {
      var w = this.wide();
      this.cam.cx = w ? this.W * 0.71 : this.W / 2;
      this.cam.cy = w ? this.H * 0.5 : this.H * 0.5;
      this.cam.s = w ? Math.min(this.W * 0.175, this.H * 0.34) : Math.min(this.W * 0.34, this.H * 0.38);
    };
    heroCanvas.addEventListener("pointermove", function (e) {
      var r = heroCanvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      // on wide screens the words take the left of the hero; the box follows only over the store
      if (hero.wide() && x < hero.W * 0.44) { hero.pointer = null; return; }
      hero.pointer = [x, y]; hero.dirty = true;
    });
    heroCanvas.addEventListener("pointerdown", function (e) {
      if (e.pointerType !== "touch") return;          // a tap moves the box there for a few seconds
      var r = heroCanvas.getBoundingClientRect();
      hero.pointer = [e.clientX - r.left, e.clientY - r.top]; hero.holdUntil = performance.now() + 5000; hero.dirty = true;
    });
    heroCanvas.addEventListener("pointerleave", function () { if (!(hero.holdUntil > performance.now())) hero.pointer = null; });
  }

  function heroFrame(dt, c, ox, oy) {
    var S = hero, cam = S.cam, N = S.N, P = S.tmp, i, j;
    // where the query box goes: the cursor, else a slow tour of the store
    if (S.pointer && S.holdUntil && S.holdUntil < performance.now()) { S.pointer = null; S.holdUntil = 0; }
    if (S.pointer && !S.drag.down) {
      var w = cam.un(S.pointer[0], S.pointer[1]);
      S.qt = [clamp(w[0], -0.7, 0.7), clamp(w[1], -0.7, 0.7), clamp(w[2], -0.7, 0.7)];
    } else if (!RM) {
      // like an old DVD screensaver: straight lines, bouncing off the store's walls
      if (!S.bouncing) { S.bouncing = true; S.qt = S.q.slice(); }
      var lim = 1 - S.half;
      for (i = 0; i < 3; i++) {
        S.qt[i] += S.vel[i] * dt;
        if (S.qt[i] > lim) { S.qt[i] = 2 * lim - S.qt[i]; S.vel[i] = -Math.abs(S.vel[i]); S.bump = 1; }
        else if (S.qt[i] < -lim) { S.qt[i] = -2 * lim - S.qt[i]; S.vel[i] = Math.abs(S.vel[i]); S.bump = 1; }
      }
    }
    if (S.pointer && !S.drag.down) S.bouncing = false;
    var k = RM || S.bouncing ? 1 : Math.min(1, dt * 6);
    for (i = 0; i < 3; i++) S.q[i] += (S.qt[i] - S.q[i]) * k;
    S.bump = Math.max(0, (S.bump || 0) - dt * 3);
    var lo = [S.q[0] - S.half, S.q[1] - S.half, S.q[2] - S.half], hi = [S.q[0] + S.half, S.q[1] + S.half, S.q[2] + S.half];
    // the chunks the box touches: a block of whole chunks
    var cs = 2 / N, clo = [], chi = [];
    for (i = 0; i < 3; i++) { clo[i] = clamp(Math.floor((lo[i] + 1) / cs), 0, N - 1); chi[i] = clamp(Math.floor((hi[i] + 1) / cs), 0, N - 1); }
    var touched = (chi[0] - clo[0] + 1) * (chi[1] - clo[1] + 1) * (chi[2] - clo[2] + 1);
    function inBox(p) { return p[0] >= lo[0] && p[0] <= hi[0] && p[1] >= lo[1] && p[1] <= hi[1] && p[2] >= lo[2] && p[2] <= hi[2]; }

    c.save(); c.translate(ox || 0, oy || 0);
    lattice(c, cam, N, col.dark ? 0.1 : 0.075, col.dark ? 0.4 : 0.32);
    // chunks read
    var R = boxCorners(cam, [-1 + clo[0] * cs, -1 + clo[1] * cs, -1 + clo[2] * cs], [-1 + (chi[0] + 1) * cs, -1 + (chi[1] + 1) * cs, -1 + (chi[2] + 1) * cs]);
    S.boxIn = RM ? 1 : Math.min(1, (S.boxIn || 0) + dt / 0.6);
    var bi = S.boxIn;
    drawBox(c, R, col["accent-ink"], 1.25, 0.75 * bi, col.tint, 0.14 * bi);

    // skeletons: the box returns the nodes inside it and the edges with both ends inside
    var a = S.tmp, b = S.tmp2, K = S.sk, In = S.skIn, nIn = 0, eIn = 0, e;
    for (i = 0; i < K.pts.length; i++) { In[i] = bi > 0.5 && inBox(K.pts[i]) ? 1 : 0; nIn += In[i]; }
    c.strokeStyle = col.ink; c.lineWidth = 1.1; c.globalAlpha = 0.3; c.beginPath();
    for (i = 0; i < K.links.length; i++) {
      e = K.links[i]; if (In[e[0]] && In[e[1]]) continue;
      var p0 = K.pts[e[0]], p1 = K.pts[e[1]];
      cam.p(p0[0], p0[1], p0[2], a); cam.p(p1[0], p1[1], p1[2], b); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]);
    }
    c.stroke();
    c.strokeStyle = col["accent-ink"]; c.lineWidth = 1.8; c.globalAlpha = 0.95; c.beginPath();
    for (i = 0; i < K.links.length; i++) {
      e = K.links[i]; if (!(In[e[0]] && In[e[1]])) continue;
      eIn++; p0 = K.pts[e[0]]; p1 = K.pts[e[1]];
      cam.p(p0[0], p0[1], p0[2], a); cam.p(p1[0], p1[1], p1[2], b); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]);
    }
    c.stroke();
    c.globalAlpha = 1; c.fillStyle = col.node; c.strokeStyle = col["accent-ink"]; c.lineWidth = 1.2;
    for (i = 0; i < K.pts.length; i++) { if (!In[i]) continue; p0 = K.pts[i]; cam.p(p0[0], p0[1], p0[2], a); node(c, a[0], a[1], 2.1); }
    // points: exactly those inside
    var inside = 0;
    c.globalAlpha = 0.32; c.fillStyle = col.ink;
    for (i = 0; i < S.pts.length; i++) {
      var p = S.pts[i];
      if (inBox(p) && bi > 0.5) { inside++; continue; }
      cam.p(p[0], p[1], p[2], a); c.fillRect(a[0] - 1, a[1] - 1, 2, 2);
    }
    c.globalAlpha = 1; c.fillStyle = col.node; c.strokeStyle = col["accent-ink"]; c.lineWidth = 1.3;
    for (i = 0; i < S.pts.length; i++) { p = S.pts[i]; if (!inBox(p) || bi <= 0.5) continue; cam.p(p[0], p[1], p[2], a); node(c, a[0], a[1], 2.6); }
    // the query box itself
    drawBox(c, boxCorners(cam, lo, hi), S.bump > 0.05 ? col["accent-ink"] : col.ink, 1.1 + 1.4 * S.bump, (0.8 + 0.2 * S.bump) * bi, null, 0, [4, 4]);
    c.restore();

    var txt = "box reads <b>" + touched + "</b> of " + N * N * N + " chunks · <b>" + inside + "</b> points · <b>" + nIn + "</b> skeleton nodes, <b>" + eIn + "</b> edges";
    if (txt !== S.lastTxt) { S.readEl.innerHTML = txt; S.lastTxt = txt; }
  }

  /* ── stage: one set of vertices, five geometries ────────────────────── */
  var NP = 400;
  function makeGeoms() {
    var G = [], r, i, j, used, pos, links, faces;
    function geom(list, links, faces) {
      var n = list.length, out = { pos: new Float32Array(NP * 3), used: new Uint8Array(NP), links: links || [], faces: faces || [] }, rr = rng(n * 31 + 7);
      for (var i = 0; i < NP; i++) {
        var src = i < n ? list[i] : list[Math.floor(rr() * n)];   // spare vertices hide on a used one
        out.pos[i * 3] = src[0]; out.pos[i * 3 + 1] = src[1]; out.pos[i * 3 + 2] = src[2]; out.used[i] = i < n ? 1 : 0;
      }
      return out;
    }
    // points
    G.push(geom(cloud(3, NP)));
    // streamlines
    var B = bundle(5, 6, 20, 0.1, 0).concat(bundle(6, 4, 20, 0.09, 1), bundle(8, 4, 20, 0.09, 2)), list = []; links = [];
    B.forEach(function (L) { var s = list.length; L.forEach(function (p, k) { list.push(p); if (k) links.push([s + k - 1, s + k]); }); });
    G.push(geom(list, links));
    // skeleton: a branching tree grown from a soma
    r = rng(21); list = [[0, -0.55, 0]]; links = [];
    var tips = [{ i: 0, d: [0, 1, 0], life: 9 }, { i: 0, d: [0.6, -0.3, 0.5], life: 5 }, { i: 0, d: [-0.6, -0.2, -0.4], life: 5 }];
    while (tips.length && list.length < 230) {
      var tip = tips.shift(), p0 = list[tip.i], d = tip.d;
      d = [d[0] + gauss(r) * 0.25, d[1] + gauss(r) * 0.2, d[2] + gauss(r) * 0.25];
      var m = Math.hypot(d[0], d[1], d[2]); d = [d[0] / m, d[1] / m, d[2] / m];
      var np = [clamp(p0[0] + d[0] * 0.085, -0.97, 0.97), clamp(p0[1] + d[1] * 0.085, -0.97, 0.97), clamp(p0[2] + d[2] * 0.085, -0.97, 0.97)];
      list.push(np); links.push([tip.i, list.length - 1]);
      if (tip.life > 0) tips.push({ i: list.length - 1, d: d, life: tip.life - 1 + (r() < 0.12 ? 3 : 0) });
      if (r() < 0.16 && list.length < 200) tips.push({ i: list.length - 1, d: [d[2] + gauss(r) * 0.6, d[1] * 0.5 + gauss(r) * 0.4, -d[0] + gauss(r) * 0.6], life: 4 + Math.floor(r() * 5) });
    }
    G.push(geom(list, links));
    // graph: near neighbours, with a few long links
    r = rng(33); list = []; links = [];
    for (i = 0; i < 130; i++) { var th = r() * TAU, ph = Math.acos(2 * r() - 1), rad = 0.35 + 0.55 * Math.cbrt(r()); list.push([rad * Math.sin(ph) * Math.cos(th), rad * Math.cos(ph) * 0.85, rad * Math.sin(ph) * Math.sin(th)]); }
    var seen = {};
    for (i = 0; i < list.length; i++) {
      var ds = [];
      for (j = 0; j < list.length; j++) if (j !== i) ds.push([Math.hypot(list[i][0] - list[j][0], list[i][1] - list[j][1], list[i][2] - list[j][2]), j]);
      ds.sort(function (x, y) { return x[0] - y[0]; });
      for (var q = 0; q < 2; q++) { var key = Math.min(i, ds[q][1]) + "_" + Math.max(i, ds[q][1]); if (!seen[key]) { seen[key] = 1; links.push([i, ds[q][1]]); } }
      if (r() < 0.08) links.push([i, ds[6 + Math.floor(r() * 10)][1]]);
    }
    G.push(geom(list, links));
    // mesh: a lumpy closed surface
    list = []; links = []; faces = [];
    var RS = 11, CS = 18;
    for (i = 0; i <= RS; i++) for (j = 0; j < CS; j++) {
      if ((i === 0 || i === RS) && j > 0) continue;
      var v = i / RS * Math.PI, u = j / CS * TAU, rr2 = 0.78 + 0.1 * Math.sin(3 * u) * Math.sin(2 * v) + 0.06 * Math.cos(5 * v);
      list.push([rr2 * Math.sin(v) * Math.cos(u), rr2 * Math.cos(v) * 0.9, rr2 * Math.sin(v) * Math.sin(u)]);
    }
    function vid(i, j) { if (i === 0) return 0; if (i === RS) return 1 + (RS - 1) * CS; return 1 + (i - 1) * CS + (j % CS); }
    for (i = 0; i < RS; i++) for (j = 0; j < CS; j++) {
      var a0 = vid(i, j), a1 = vid(i, j + 1), b0 = vid(i + 1, j), b1 = vid(i + 1, j + 1);
      if (i > 0) faces.push([a0, b0, a1]);
      if (i < RS - 1) faces.push([a1, b0, b1]);
    }
    var es = {};
    faces.forEach(function (f) { for (var e = 0; e < 3; e++) { var x = f[e], y = f[(e + 1) % 3], k2 = Math.min(x, y) + "_" + Math.max(x, y); if (!es[k2]) { es[k2] = 1; links.push([x, y]); } } });
    G.push(geom(list, links, faces));
    // match each geometry's vertices to the one before, so the morphs travel short distances
    for (var g = 1; g < G.length; g++) reorder(G[g - 1], G[g]);
    return G;
  }
  function reorder(A, B) {
    var pairs = [], i, j;
    for (i = 0; i < NP; i++) for (j = 0; j < NP; j++) {
      var dx = A.pos[i * 3] - B.pos[j * 3], dy = A.pos[i * 3 + 1] - B.pos[j * 3 + 1], dz = A.pos[i * 3 + 2] - B.pos[j * 3 + 2];
      // used vertices pair with used vertices first
      pairs.push((dx * dx + dy * dy + dz * dz) + (A.used[i] !== B.used[j] ? 4 : 0), i, j);
    }
    var idx = new Uint32Array(NP * NP); for (i = 0; i < idx.length; i++) idx[i] = i;
    idx.sort(function (x, y) { return pairs[x * 3] - pairs[y * 3]; });
    var takenA = new Uint8Array(NP), takenB = new Uint8Array(NP), map = new Int32Array(NP), left = NP;   // map[old B index] = new slot
    for (i = 0; i < idx.length && left; i++) {
      var a = pairs[idx[i] * 3 + 1], b = pairs[idx[i] * 3 + 2];
      if (takenA[a] || takenB[b]) continue;
      takenA[a] = takenB[b] = 1; map[b] = a; left--;
    }
    var pos = new Float32Array(NP * 3), used = new Uint8Array(NP);
    for (j = 0; j < NP; j++) { var s = map[j]; pos[s * 3] = B.pos[j * 3]; pos[s * 3 + 1] = B.pos[j * 3 + 1]; pos[s * 3 + 2] = B.pos[j * 3 + 2]; used[s] = B.used[j]; }
    B.pos = pos; B.used = used;
    B.links = B.links.map(function (e) { return [map[e[0]], map[e[1]]]; });
    B.faces = B.faces.map(function (f) { return [map[f[0]], map[f[1]], map[f[2]]]; });
  }

  var geoCanvas = document.getElementById("geo-canvas");
  var stage = geoCanvas && new Scene(geoCanvas);
  if (stage) {
    stage.G = makeGeoms();
    stage.cam = new Cam(-0.5, 0.36);
    stage.q = 0; stage.target = 0; stage.t = 0;
    stage.chaps = Array.prototype.slice.call(document.querySelectorAll(".chap"));
    stage.steps = Array.prototype.slice.call(document.querySelectorAll(".geo-steps i"));
    stage.drag = dragYaw(geoCanvas, stage);
    stage.P = new Float32Array(NP * 4);
    stage.layout = function () {
      this.cam.cx = this.W / 2; this.cam.cy = this.H * (this.W < 600 ? 0.5 : 0.48);
      this.cam.s = Math.min(this.W * 0.33, this.H * 0.36);
    };
    stage.progress = function () {
      // which chapter is being read: its middle against the reading line (the screen's middle, or above the
      // relief when the scene rides along the foot of a phone screen)
      var H = window.innerHeight, line = window.innerWidth > 896 ? H / 2 : H * 0.3;
      var m = this.chaps.map(function (el) { var b = el.getBoundingClientRect(); return b.top + b.height / 2 - line; });
      if (m[0] >= 0) return 0;
      for (var i = 0; i < m.length - 1; i++) if (m[i] < 0 && m[i + 1] >= 0) return i + (-m[i]) / (m[i + 1] - m[i]);
      return m.length - 1;
    };
  }

  function stageFrame(dt, c) {
    var S = stage, cam = S.cam, i, k;
    S.target = S.progress();
    S.q = RM ? Math.round(S.target) : S.q + (S.target - S.q) * Math.min(1, dt * 3.2);
    var q = clamp(S.q, 0, S.G.length - 1), gi = Math.min(Math.floor(q), S.G.length - 2), f = ease(clamp(q - gi, 0, 1));
    var A = S.G[gi], B = S.G[gi + 1], P = S.P, a = S.tmp;
    var on = Math.round(q);
    S.chaps.forEach(function (el, j) { el.classList.toggle("on", j === on); });
    S.steps.forEach(function (el, j) { el.classList.toggle("on", j === on); });

    lattice(c, cam, 4, col.dark ? 0.085 : 0.06, col.dark ? 0.32 : 0.26);
    for (i = 0; i < NP; i++) {
      cam.p(lerp(A.pos[i * 3], B.pos[i * 3], f), lerp(A.pos[i * 3 + 1], B.pos[i * 3 + 1], f), lerp(A.pos[i * 3 + 2], B.pos[i * 3 + 2], f), a);
      P[i * 4] = a[0]; P[i * 4 + 1] = a[1]; P[i * 4 + 2] = a[2]; P[i * 4 + 3] = lerp(A.used[i], B.used[i], f);
    }
    // mesh faces: tinted where they face the camera
    function faces(F, w) {
      if (w <= 0.01 || !F.length) return;
      c.fillStyle = col.tint; c.globalAlpha = w * 0.75;
      c.beginPath();
      for (var n = 0; n < F.length; n++) {
        var x = F[n], ax = P[x[0] * 4], ay = P[x[0] * 4 + 1], bx = P[x[1] * 4], by = P[x[1] * 4 + 1], cx2 = P[x[2] * 4], cy2 = P[x[2] * 4 + 1];
        if ((bx - ax) * (cy2 - ay) - (by - ay) * (cx2 - ax) > 0) continue;   // facing away
        c.moveTo(ax, ay); c.lineTo(bx, by); c.lineTo(cx2, cy2); c.closePath();
      }
      c.fill(); c.globalAlpha = 1;
    }
    faces(A.faces, 1 - f); faces(B.faces, f);
    function links(L, w) {
      if (w <= 0.01) return;
      c.strokeStyle = col["accent-ink"]; c.lineWidth = 1.15; c.globalAlpha = w * 0.75;
      c.beginPath();
      for (var n = 0; n < L.length; n++) { var x = L[n]; c.moveTo(P[x[0] * 4], P[x[0] * 4 + 1]); c.lineTo(P[x[1] * 4], P[x[1] * 4 + 1]); }
      c.stroke(); c.globalAlpha = 1;
    }
    links(A.links, 1 - f); links(B.links, f);
    // vertices, far ones first
    var order = S.order || (S.order = new Uint16Array(NP).map(function (_, n) { return n; }));
    order.sort(function (x, y) { return P[x * 4 + 2] - P[y * 4 + 2]; });
    c.fillStyle = col.node; c.strokeStyle = col["accent-ink"]; c.lineWidth = 1.25;
    for (k = 0; k < NP; k++) {
      i = order[k]; var w = P[i * 4 + 3]; if (w < 0.02) continue;
      c.globalAlpha = w * (0.55 + 0.45 * smooth(-1.2, 1, P[i * 4 + 2]));
      node(c, P[i * 4], P[i * 4 + 1], 2.4 + 0.5 * smooth(-1, 1, P[i * 4 + 2]));
    }
    c.globalAlpha = 1;
    return Math.abs(S.target - S.q) > 0.002;
  }

  /* ── pyramid ────────────────────────────────────────────────────────── */
  var pyrCanvas = document.getElementById("pyr-canvas");
  var pyr = pyrCanvas && new Scene(pyrCanvas);
  if (pyr) {
    pyr.cam = new Cam(-0.72, 0.4);
    pyr.pts = cloud(17, 1400);
    pyr.levels = [0, 1, 2].map(function (L) {
      var bins = 16 >> L, size = 2 / bins, map = {}, metas = [], of = new Int32Array(pyr.pts.length);
      pyr.pts.forEach(function (p, i) {
        var key = Math.floor((p[0] + 1) / size) + "," + Math.floor((p[1] + 1) / size) + "," + Math.floor((p[2] + 1) / size);
        if (!(key in map)) { map[key] = metas.length; metas.push([0, 0, 0, 0]); }
        var m = metas[map[key]]; m[0] += p[0]; m[1] += p[1]; m[2] += p[2]; m[3]++; of[i] = map[key];
      });
      metas.forEach(function (m) { m[0] /= m[3]; m[1] /= m[3]; m[2] /= m[3]; });
      return { chunks: 4 >> L, bins: bins, metas: metas, of: of };
    });
    pyr.from = 0; pyr.to = 0; pyr.f = 1;
    pyr.drag = dragYaw(pyrCanvas, pyr);
    pyr.statEl = document.getElementById("pyr-stats");
    pyr.layout = function () { this.cam.cx = this.W / 2; this.cam.cy = this.H * 0.5; this.cam.s = Math.min(this.W * 0.3, this.H * 0.36); };
    var btns = Array.prototype.slice.call(document.querySelectorAll(".levels button"));
    btns.forEach(function (b) {
      b.addEventListener("click", function () {
        var L = +b.dataset.level; if (L === pyr.to) return;
        pyr.from = pyr.to; pyr.to = L; pyr.f = RM ? 1 : 0; pyr.dirty = true;
        btns.forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        pyrStats();
      });
    });
    var pyrStats = function () {
      var L = pyr.levels[pyr.to], n = L.metas.length, n0 = pyr.pts.length;
      pyr.statEl.innerHTML = "level <b>" + pyr.to + "</b> · " + L.chunks + "×" + L.chunks + "×" + L.chunks + " chunks · " +
        "<b>" + n.toLocaleString("en-GB") + "</b> vertices" + (pyr.to ? " from " + n0.toLocaleString("en-GB") : "");
    };
    pyrStats();
  }

  function pyrFrame(dt, c) {
    var S = pyr, cam = S.cam, a = S.tmp, i;
    if (S.f < 1) S.f = Math.min(1, S.f + dt / 0.9);
    var f = ease(S.f), A = S.levels[S.from], B = S.levels[S.to];
    // the chunk lattice coarsens with the level
    if (A.chunks !== B.chunks) { lattice(c, cam, A.chunks, (col.dark ? 0.1 : 0.075) * (1 - f), 0); }
    lattice(c, cam, B.chunks, (col.dark ? 0.1 : 0.075) * (A.chunks !== B.chunks ? f : 1), col.dark ? 0.36 : 0.3);
    // each point travels to its bin's centroid at the new level
    c.fillStyle = col.ink; c.globalAlpha = col.dark ? 0.4 : 0.3;
    function at(L, i) { return L === S.levels[0] ? S.pts[i] : L.metas[L.of[i]]; }
    for (i = 0; i < S.pts.length; i++) {
      var p = at(A, i), q = at(B, i);
      cam.p(lerp(p[0], q[0], f), lerp(p[1], q[1], f), lerp(p[2], q[2], f), a);
      c.fillRect(a[0] - 0.9, a[1] - 0.9, 1.8, 1.8);
    }
    // metavertices, sized by how many vertices they stand for
    function metas(L, w) {
      if (w <= 0.01 || L === S.levels[0]) return;
      c.globalAlpha = w; c.fillStyle = col.node; c.strokeStyle = col["accent-ink"]; c.lineWidth = 1.4;
      var list = L.metas.map(function (m) { return [m, cam.p(m[0], m[1], m[2], [0, 0, 0, 0])]; }).sort(function (x, y) { return x[1][2] - y[1][2]; });
      list.forEach(function (e) { node(c, e[1][0], e[1][1], 1.6 + Math.cbrt(e[0][3]) * (L === S.levels[1] ? 1.0 : 1.05)); });
    }
    metas(A, 1 - f); metas(B, f);
    c.globalAlpha = 1;
    return S.f < 1;
  }

  /* ── the loop ───────────────────────────────────────────────────────── */
  var last = 0, introOn = false;
  function frame(now) {
    var dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016; last = now;
    scenes.forEach(function (s) {
      if (s.resize() && s.layout) s.layout();
      if (!s.visible) return;
      var turning = s.drag && (s.drag.down || Math.abs(s.drag.vel) > 0.0005);
      if (s.drag && !s.drag.down) s.drag.vel *= 0.92;
      if (s.drag && !s.drag.down && Math.abs(s.drag.vel) > 0.0005) s.drag.yaw += s.drag.vel;
      var live = !RM || s.dirty || turning || s === stage;
      if (!live) return;
      if (!(s === hero && introOn)) s.t = (s.t || 0) + dt;
      var base = s.baseYaw === undefined ? (s.baseYaw = s.cam.yaw) : s.baseYaw;
      s.cam.yaw = base + (RM ? 0 : Math.sin(s.t * 0.11) * 0.28) + (s.drag ? s.drag.yaw : 0);
      s.cam.upd();
      var c = s.begin(), more = false;
      if (s === hero) { if (!introOn) heroFrame(dt, c); }
      else if (s === stage) more = stageFrame(dt, c);
      else if (s === pyr) more = pyrFrame(dt, c);
      s.dirty = !!more;
    });
    requestAnimationFrame(frame);
  }

  /* ── the opening: the logo's mark opens into the store ──────────────── */
  // positions in the mark image (617 × 404): ten nodes, the links between them, the cube's corners
  var MARK = {
    w: 617, h: 404,
    nodes: [[509, 149], [589.3, 186.6], [112.8, 204.2], [476.1, 272.7], [198, 298.6], [26.6, 300.5], [406.4, 337.6], [547.6, 341.8], [148.4, 375.3], [477.1, 376.4]],
    links: [[2, [180, 178]], [2, 5], [5, 4], [4, 2], [4, [262, 290]], [4, 8], [0, [450, 172]], [0, 1], [0, 3], [3, [421, 246]], [6, 9], [9, 7]],
    tri: [2, 5, 4],
    // apex, left, front, right on top; left, front, right below; the hidden back corner
    cube: [[316, 4], [180, 66], [316, 128], [452, 66], [180, 259], [316, 321], [452, 259], [316, 197]],
  };
  function intro(onText, done) {
    var ov = document.createElement("canvas");
    ov.setAttribute("aria-hidden", "true");
    ov.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;z-index:30;pointer-events:none";
    document.body.appendChild(ov);
    var c = ov.getContext("2d"), W = window.innerWidth, H = window.innerHeight;
    ov.width = W * DPR; ov.height = H * DPR;
    var mw = Math.min(W * 0.46, 300), sc = mw / MARK.w, mx = W / 2 - mw / 2, my = H / 2 - MARK.h * sc / 2;
    function M(p) { return [mx + p[0] * sc, my + p[1] * sc]; }
    hero.resize(); hero.layout(); hero.cam.upd();
    var r = heroCanvas.getBoundingClientRect(), cam = hero.cam, a = [0, 0, 0, 0];

    // where everything ends up: the hero's first frame, in screen coordinates
    var verts = [];
    hero.pts.forEach(function (p) { cam.p(p[0], p[1], p[2], a); verts.push([a[0] + r.left, a[1] + r.top]); });
    var skStart = verts.length;
    hero.sk.pts.forEach(function (p) { cam.p(p[0], p[1], p[2], a); verts.push([a[0] + r.left, a[1] + r.top]); });
    var store = boxCorners(cam, [-1, -1, -1], [1, 1, 1]);
    var corners = store.map(function (q) { return [q[0] + r.left, q[1] + r.top]; });
    var nodesM = MARK.nodes.map(M), cubeM = MARK.cube.map(M);
    function d2(p, q) { return (p[0] - q[0]) * (p[0] - q[0]) + (p[1] - q[1]) * (p[1] - q[1]); }

    function norm2(list) {
      var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      list.forEach(function (p) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
      return list.map(function (p) { return [(p[0] - x0) / (x1 - x0 || 1), (p[1] - y0) / (y1 - y0 || 1)]; });
    }
    // each logo node becomes the nearest vertex; every other vertex leaves from its nearest logo node
    var claimed = {}, nodeTo = nodesM.map(function (n) {
      var best = -1, bd = 1e18;
      for (var i = 0; i < verts.length; i++) { if (claimed[i]) continue; var d = d2(verts[i], n); if (d < bd) { bd = d; best = i; } }
      claimed[best] = 1; return best;
    });
    // sources are matched by place within each shape (the logo's nodes, the store on screen), so the
    // vertices pour out of every node, not just the ones nearest the store
    var from = [], maxd = 1, nN = norm2(nodesM), nV = norm2(verts);
    verts.forEach(function (v, i) {
      var best = 0, bd = 1e18;
      nN.forEach(function (n, j) { var d = d2(nV[i], n); if (d < bd) { bd = d; best = j; } });
      from.push(nodesM[best]); maxd = Math.max(maxd, Math.sqrt(d2(v, nodesM[best])));
    });
    // a staggered wave: near vertices leave first, far ones a little later, each on a gentle curve
    var rr = rng(99), delay = [], bend = [];
    verts.forEach(function (v, i) { delay.push(0.28 * Math.sqrt(d2(v, from[i])) / maxd + 0.1 * rr()); bend.push((rr() - 0.5) * 0.5); });
    nodeTo.forEach(function (i, k) { from[i] = nodesM[k]; delay[i] = 0; bend[i] = 0.12; });   // a logo node leaves from itself

    // cube corners onto the store's corners, matched by place within each shape's bounds
    function norm(list) {
      var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      list.forEach(function (p) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
      return list.map(function (p) { return [(p[0] - x0) / (x1 - x0), (p[1] - y0) / (y1 - y0)]; });
    }
    var nc = norm(cubeM.slice(0, 7)), nt = norm(corners), cornerFrom = new Array(8), used = {}, back = 0;
    store.forEach(function (q, i) { if (q[2] < store[back][2]) back = i; });   // the logo's hidden corner is the far one
    cornerFrom[back] = cubeM[7]; used[back] = 1;
    nc.forEach(function (p, j) {
      var best = -1, bd = 1e9;
      nt.forEach(function (q, i) { if (used[i]) return; var d = d2(p, q); if (d < bd) { bd = d; best = i; } });
      used[best] = 1; cornerFrom[best] = cubeM[j];
    });
    function cornerOf(j) { return cornerFrom.indexOf(cubeM[j]); }

    // one timeline: the mark arrives, rests a moment, then opens; the words start before it settles
    var D = W < 700 ? 2.7 : 3.1, OPEN = 0.75, t0 = performance.now(), stopped = false, texted = false;
    function finish() {
      if (stopped) return; stopped = true;
      ["wheel", "touchstart", "keydown", "pointerdown"].forEach(function (e) { window.removeEventListener(e, finish); });
      if (!texted) onText();
      done();
      ov.style.transition = "opacity .3s ease"; ov.style.opacity = "0";
      setTimeout(function () { ov.remove(); }, 350);
    }
    ["wheel", "touchstart", "keydown", "pointerdown"].forEach(function (e) { window.addEventListener(e, finish, { passive: true }); });
    function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
    // a point on its way: eased along a slight arc
    function travel(p, q, u, b, out) {
      var x = lerp(p[0], q[0], u), y = lerp(p[1], q[1], u), dx = q[0] - p[0], dy = q[1] - p[1], k = Math.sin(Math.PI * u) * b;
      out[0] = x - dy * k; out[1] = y + dx * k; return out;
    }
    var U = new Float32Array(verts.length), X = new Float32Array(verts.length * 2), tmp = [0, 0];

    function draw() {
      if (stopped) return;
      var t = (performance.now() - t0) / 1000;
      var appear = easeOut(clamp(t / 0.55, 0, 1));
      var g = clamp((t - OPEN) / (D - OPEN), 0, 1);           // the opening, 0 to 1
      c.setTransform(DPR, 0, 0, DPR, 0, 0); c.clearRect(0, 0, W, H);
      // the mark grows in from the middle while it appears
      var s = 0.9 + 0.1 * appear;
      c.translate(W / 2, H / 2); c.scale(s, s); c.translate(-W / 2, -H / 2);
      var accent = col["accent-ink"], i, j;

      // the cube: solid, then opening into the store's outline, then its chunks
      var uc = ease(clamp((g - 0.04) / 0.8, 0, 1));
      var P = cornerFrom.map(function (p, k) { return [lerp(p[0], corners[k][0], uc), lerp(p[1], corners[k][1], uc)]; });
      var hex = [0, 1, 4, 5, 6, 3].map(function (k) { return P[cornerOf(k)]; });
      c.globalAlpha = appear * (1 - smooth(0, 0.32, g)); c.fillStyle = accent;
      c.beginPath(); hex.forEach(function (p, k) { if (k) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]); }); c.closePath(); c.fill();
      var l1 = P[cornerOf(1)], f2 = P[cornerOf(2)], r3 = P[cornerOf(3)], b5 = P[cornerOf(5)];
      c.globalAlpha = appear * (1 - smooth(0, 0.3, g)); c.strokeStyle = col.node; c.lineWidth = 5 * sc; c.lineCap = "round";
      c.beginPath(); c.moveTo(l1[0], l1[1]); c.lineTo(f2[0], f2[1]); c.lineTo(r3[0], r3[1]);
      [[0.06, 0.38], [0.5, 0.62], [0.74, 0.86]].forEach(function (d) { c.moveTo(lerp(f2[0], b5[0], d[0]), lerp(f2[1], b5[1], d[0])); c.lineTo(lerp(f2[0], b5[0], d[1]), lerp(f2[1], b5[1], d[1])); });
      c.stroke();
      c.globalAlpha = smooth(0.08, 0.55, g) * (col.dark ? 0.4 : 0.32); c.strokeStyle = col.ink; c.lineWidth = 1;
      c.beginPath(); BOX_E.forEach(function (e) { c.moveTo(P[e[0]][0], P[e[0]][1]); c.lineTo(P[e[1]][0], P[e[1]][1]); }); c.stroke();
      var la = smooth(0.5, 1, g);
      if (la > 0) { c.save(); c.translate(r.left, r.top); lattice(c, cam, hero.N, (col.dark ? 0.1 : 0.075) * la, 0); c.restore(); }

      // every vertex's own progress along the wave
      for (i = 0; i < verts.length; i++) {
        var ui = ease(clamp((g - delay[i]) / 0.62, 0, 1)); U[i] = ui;
        travel(from[i], verts[i], ui, bend[i], tmp); X[i * 2] = tmp[0]; X[i * 2 + 1] = tmp[1];
      }
      // skeleton edges draw in as both their ends arrive
      var E = hero.sk.links;
      c.strokeStyle = col.ink; c.lineWidth = 1;
      for (var band = 1; band <= 4; band++) {
        c.globalAlpha = 0.3 * band / 4; c.beginPath();
        for (j = 0; j < E.length; j++) {
          var ia = skStart + E[j][0], ib = skStart + E[j][1], w = smooth(0.72, 1, Math.min(U[ia], U[ib]));   // an edge appears as its ends settle
          if (Math.ceil(w * 4) !== band || w <= 0) continue;
          c.moveTo(X[ia * 2], X[ia * 2 + 1]); c.lineTo(X[ib * 2], X[ib * 2 + 1]);
        }
        c.stroke();
      }
      // the logo's links thin and fade as their nodes leave
      var NP2 = nodeTo.map(function (k) { return [X[k * 2], X[k * 2 + 1]]; }), un = U[nodeTo[0]];
      c.globalAlpha = appear * (1 - smooth(0, 0.5, g)); c.strokeStyle = accent; c.lineWidth = lerp(9 * sc, 1.2, un);
      var tri = MARK.tri.map(function (k) { return NP2[k]; });
      c.fillStyle = col.tint; c.beginPath(); c.moveTo(tri[0][0], tri[0][1]); c.lineTo(tri[1][0], tri[1][1]); c.lineTo(tri[2][0], tri[2][1]); c.closePath(); c.fill();
      c.beginPath();
      MARK.links.forEach(function (l) {
        var p = NP2[l[0]], q;
        if (typeof l[1] === "number") q = NP2[l[1]]; else { var m = M(l[1]); q = [lerp(m[0], p[0], un), lerp(m[1], p[1], un)]; }
        c.moveTo(p[0], p[1]); c.lineTo(q[0], q[1]);
      });
      c.stroke();
      // the cloud and the skeletons' vertices pour out of the nodes
      c.fillStyle = col.ink;
      for (i = 0; i < verts.length; i++) {
        if (claimed[i] || U[i] <= 0) continue;
        c.globalAlpha = (i < skStart ? 0.32 : 0.0) * smooth(0, 0.35, U[i]) + (i >= skStart ? 0.3 * Math.sin(Math.PI * U[i]) : 0);
        if (c.globalAlpha > 0.01) c.fillRect(X[i * 2] - 1, X[i * 2 + 1] - 1, 2, 2);
      }
      // and the logo's own nodes shrink into vertices as they land
      c.fillStyle = col.node; c.strokeStyle = accent;
      NP2.forEach(function (p, k) {
        var u = U[nodeTo[k]];
        c.globalAlpha = appear * (1 - smooth(0.7, 1, u)); c.lineWidth = lerp(9 * sc, 1.3, u);
        node(c, p[0], p[1], lerp(21.5 * sc, 2.4, u));
      });
      c.globalAlpha = 1;

      if (!texted && g > 0.72) { texted = true; onText(); }
      if (g >= 1) finish(); else requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
  }

  /* ── start ──────────────────────────────────────────────────────────── */
  readColours();
  var mq = window.matchMedia("(prefers-color-scheme: dark)");
  if (mq.addEventListener) mq.addEventListener("change", readColours);
  scenes.forEach(function (s) { s.resize(); if (s.layout) s.layout(); });
  window.addEventListener("resize", function () { scenes.forEach(function (s) { if (s.resize() && s.layout) s.layout(); }); });
  window.addEventListener("scroll", function () { if (stage) stage.dirty = true; }, { passive: true });

  var heroEl = document.getElementById("hero");
  function showText() { if (heroEl) heroEl.classList.add("ready"); }
  function ready() { introOn = false; showText(); if (hero) hero.dirty = true; }
  if (hero && !RM && (window.scrollY || 0) < 40) { introOn = true; intro(showText, ready); }
  else ready();
  requestAnimationFrame(frame);

  /* ── theme toggle: the same cycle and storage as the docs' (Furo) ──────── */
  var tt = document.getElementById("theme-toggle");
  function applyTheme(mode) {
    if (mode === "light" || mode === "dark") document.documentElement.dataset.theme = mode;
    else delete document.documentElement.dataset.theme;
    if (tt) {
      tt.dataset.mode = mode;
      tt.setAttribute("aria-label", "Colour theme: " + (mode === "auto" ? "match system" : mode));
    }
    readColours();
  }
  if (tt) {
    var stored = "auto";
    try { stored = localStorage.getItem("theme") || "auto"; } catch (e) {}
    applyTheme(stored);
    tt.addEventListener("click", function () {
      var cur = tt.dataset.mode, dark = mq.matches;
      var next = dark ? (cur === "auto" ? "light" : cur === "light" ? "dark" : "auto") : (cur === "auto" ? "dark" : cur === "dark" ? "light" : "auto");
      try { localStorage.setItem("theme", next); } catch (e) {}
      applyTheme(next);
    });
  }

  /* ── tabs and copy buttons ──────────────────────────────────────────── */
  var tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
  function pick(tab) {
    tabs.forEach(function (t) {
      var on = t === tab; t.setAttribute("aria-selected", String(on)); t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
    });
  }
  tabs.forEach(function (t, i) {
    t.addEventListener("click", function () { pick(t); });
    t.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      var n = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]; pick(n); n.focus();
    });
  });
  document.querySelectorAll(".copy").forEach(function (b) {
    b.addEventListener("click", function () {
      if (!navigator.clipboard) return;
      navigator.clipboard.writeText(b.dataset.copy).then(function () {
        b.textContent = "Copied"; setTimeout(function () { b.textContent = "Copy"; }, 1600);
      }, function () {});
    });
  });
})();

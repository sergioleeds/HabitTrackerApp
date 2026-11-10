/* Hand-written SVG charts (no libraries, so they work offline).
 * Colors come from CSS classes/variables, so light and dark mode need no redraw.
 * Every mark carries data-tip for the shared tooltip and an aria-label. */
(function (root) {
  'use strict';

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function r1(x) { return Math.round(x * 10) / 10; }
  function pct(x) { return Math.round(x * 100) + '%'; }

  /** Vertical bars 0–100 %. items: [{label, value|null, tip, current}] */
  function bars(items, w, o) {
    o = o || {};
    var h = o.h || 190, padL = 34, padR = 8, padT = 12, padB = 26;
    var iw = w - padL - padR, ih = h - padT - padB, n = items.length || 1;
    var slot = iw / n, bw = Math.max(3, Math.min(26, slot * 0.62));
    var s = '<svg viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" role="img" aria-label="' + esc(o.label || '') + '">';
    [0, 0.5, 1].forEach(function (g) {
      var y = padT + ih * (1 - g);
      s += '<line class="grid' + (g === 0 ? ' base' : '') + '" x1="' + padL + '" x2="' + (w - padR) + '" y1="' + r1(y) + '" y2="' + r1(y) + '"/>';
      s += '<text class="axis" x="' + (padL - 6) + '" y="' + r1(y + 4) + '" text-anchor="end">' + pct(g) + '</text>';
    });
    if (o.threshold) {
      var ty = padT + ih * (1 - o.threshold);
      s += '<line class="thr" x1="' + padL + '" x2="' + (w - padR) + '" y1="' + r1(ty) + '" y2="' + r1(ty) + '"/>';
    }
    var every = Math.max(1, Math.ceil(n / Math.floor(iw / (o.labelW || 34))));
    items.forEach(function (it, i) {
      var cx = padL + slot * i + slot / 2, x = cx - bw / 2;
      if (it.value !== null && it.value !== undefined) {
        var bh = Math.max(it.value > 0 ? 2 : 0, ih * Math.min(1, it.value));
        var y = padT + ih - bh, rr = Math.min(4, bw / 2, bh);
        s += '<path class="cbar' + (it.current ? ' now' : '') + '" d="M' + r1(x) + ' ' + r1(padT + ih) + 'V' + r1(y + rr) + 'Q' + r1(x) + ' ' + r1(y) + ' ' + r1(x + rr) + ' ' + r1(y) +
          'H' + r1(x + bw - rr) + 'Q' + r1(x + bw) + ' ' + r1(y) + ' ' + r1(x + bw) + ' ' + r1(y + rr) + 'V' + r1(padT + ih) + 'Z"/>';
      }
      // generous invisible hit area
      s += '<rect class="hit" x="' + r1(padL + slot * i) + '" y="' + padT + '" width="' + r1(slot) + '" height="' + ih + '" data-tip="' + esc(it.tip || '') + '" tabindex="-1"/>';
      if (i % every === 0 || i === n - 1 && every === 1) {
        s += '<text class="axis" x="' + r1(cx) + '" y="' + (h - 8) + '" text-anchor="middle">' + esc(it.label) + '</text>';
      }
    });
    if (o.line) { // moving average, neutral slate line
      var pts = [];
      o.line.forEach(function (v, i) {
        if (v === null || v === undefined) return;
        pts.push(r1(padL + slot * i + slot / 2) + ',' + r1(padT + ih * (1 - Math.min(1, v))));
      });
      if (pts.length > 1) s += '<polyline class="avg" points="' + pts.join(' ') + '"/>';
    }
    return s + '</svg>';
  }

  /** Heatmap: weeks as columns, Monday first. cells: [{date, value|null, future, tip}] ordered; startDow = 0..6 for first cell (Mon=0). */
  function heat(cells, startDow, w, o) {
    o = o || {};
    var cols = Math.ceil((cells.length + startDow) / 7), padL = 18, padT = 4;
    var cell = Math.max(10, Math.min(24, Math.floor((w - padL) / cols) - 3)), gap = 3;
    var h = padT + 7 * (cell + gap);
    var s = '<svg viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" role="img" aria-label="' + esc(o.label || '') + '">';
    (o.dows || []).forEach(function (t, i) {
      if (i % 2 === 0) s += '<text class="axis" x="0" y="' + r1(padT + i * (cell + gap) + cell * 0.75) + '">' + esc(t) + '</text>';
    });
    cells.forEach(function (c, i) {
      var idx = i + startDow, col = Math.floor(idx / 7), row = idx % 7;
      var x = padL + col * (cell + gap), y = padT + row * (cell + gap), cls;
      if (c.future) cls = 'hc-future';
      else if (c.value === null || c.value === undefined) cls = 'hc-none';
      else if (c.value <= 0) cls = 'hc-0';
      else cls = 'hc-' + (c.value < 0.4 ? 1 : c.value < 0.7 ? 2 : c.value < 1 ? 3 : 4);
      s += '<rect class="' + cls + (c.today ? ' today' : '') + '" x="' + x + '" y="' + y + '" width="' + cell + '" height="' + cell + '" rx="4" data-tip="' + esc(c.tip || '') + '" data-date="' + esc(c.date) + '"/>';
    });
    return s + '</svg>';
  }

  /** Horizontal bars, one per habit (single series). items: [{label, value|null, text, low}] */
  function hbars(items, w, o) {
    o = o || {};
    var rowH = 34, labW = Math.min(150, Math.floor(w * 0.38)), valW = 40, padR = 8;
    var bw = w - labW - valW - padR, h = items.length * rowH + 4;
    var s = '<svg viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" role="img" aria-label="' + esc(o.label || '') + '">';
    items.forEach(function (it, i) {
      var y = 2 + i * rowH, cy = y + rowH / 2, v = it.value;
      s += '<text class="lab" x="0" y="' + r1(cy + 4) + '">' + esc(truncate(it.label, Math.floor(labW / 7))) + '</text>';
      s += '<rect class="track" x="' + labW + '" y="' + r1(cy - 5) + '" width="' + bw + '" height="10" rx="5"/>';
      if (v !== null && v !== undefined) {
        s += '<rect class="hbar' + (it.low ? ' low' : '') + '" x="' + labW + '" y="' + r1(cy - 5) + '" width="' + r1(Math.max(v > 0 ? 6 : 0, bw * Math.min(1, v))) + '" height="10" rx="5"/>';
      }
      s += '<text class="hval" x="' + (w - padR) + '" y="' + r1(cy + 4) + '" text-anchor="end">' + (v === null || v === undefined ? '–' : pct(v)) + (it.low ? ' ▾' : '') + '</text>';
      s += '<rect class="hit" x="0" y="' + y + '" width="' + w + '" height="' + rowH + '" data-tip="' + esc(it.tip || '') + '"/>';
    });
    return s + '</svg>';
  }

  function truncate(s, n) { s = String(s); return s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s; }

  /** Small ring for the day score. */
  function ring(value, size, label) {
    var r = size / 2 - 7, c = 2 * Math.PI * r, v = value === null || value === undefined ? 0 : Math.max(0, Math.min(1, value));
    return '<svg viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '" role="img" aria-label="' + esc(label || '') + '">' +
      '<circle class="ring-track" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '"/>' +
      '<circle class="ring-val" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" stroke-dasharray="' + r1(c * v) + ' ' + r1(c) + '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/>' +
      '<text class="ring-txt" x="50%" y="50%" text-anchor="middle" dominant-baseline="central">' + (value === null || value === undefined ? '–' : pct(value)) + '</text></svg>';
  }

  root.Charts = { bars: bars, heat: heat, hbars: hbars, ring: ring, esc: esc };
})(typeof self !== 'undefined' ? self : this);

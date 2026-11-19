/*
 * Poster engine runtime (runs inside the renderer's sandboxed Chromium page; see
 * backend/src/design/page.ts and docs/DESIGN_ENGINE.md).
 *
 * A design is plain HTML and CSS marked up with data-* attributes. This script fills it with the
 * poster's content, crops photos around their subject, places logos with their clear space,
 * balances sponsor logos optically, fits the type to its boxes, and measures every element so the
 * server can run its checks. It never fetches anything: every file is served by the renderer.
 */
(function () {
  'use strict';

  var data = JSON.parse(document.getElementById('d-data').textContent || '{}');
  var poster = document.getElementById('poster');
  var W = poster.clientWidth;
  var H = poster.clientHeight;
  var MIN = Math.min(W, H);

  function $all(sel, root) {
    return Array.prototype.slice.call((root || poster).querySelectorAll(sel));
  }
  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }
  function hasText(v) {
    return typeof v === 'string' && v.trim().length > 0;
  }
  function remove(el) {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  var text = data.text || {};
  var hidden = (data.tweaks && data.tweaks.hide) || [];
  var photos = data.photos || [];
  var sponsors = data.sponsors || [];
  var params = data.params || {};

  function fieldValue(name) {
    if (hidden.indexOf(name) >= 0) return null;
    var v = text[name];
    if (name === 'details') return Array.isArray(v) && v.length ? v : null;
    if (name === 'badge') return v && hasText(v.main) ? v : null;
    return hasText(v) ? v : null;
  }

  // ---------------------------------------------------------------- conditions
  // data-if="headline", "!subhead", "photos>=2", "sponsors", "background", "campaign",
  // "param:badge", "format:story|portrait"; several joined with " & ".
  function count(name) {
    if (name === 'photos') return photos.length;
    if (name === 'sponsors') return sponsors.length;
    if (name === 'details') return (fieldValue('details') || []).length;
    if (name === 'campaign') return (data.logos && data.logos.campaign && data.logos.campaign.length) || 0;
    return 0;
  }
  function test(cond) {
    cond = cond.trim();
    if (!cond) return true;
    if (cond.charAt(0) === '!') return !test(cond.slice(1));
    // "a|b": either (format:… lists use | for its own options).
    if (cond.indexOf('|') > 0 && cond.indexOf('format:') !== 0) return cond.split('|').some(test);
    var m = /^(photos|sponsors|details|campaign)\s*(>=|<=|==|>|<)\s*(\d+)$/.exec(cond);
    if (m) {
      var n = count(m[1]);
      var k = Number(m[3]);
      return m[2] === '>=' ? n >= k : m[2] === '<=' ? n <= k : m[2] === '==' ? n === k : m[2] === '>' ? n > k : n < k;
    }
    if (cond.indexOf('param:') === 0) {
      var p = cond.slice(6).split('=');
      var v = params[p[0]];
      return p.length > 1 ? String(v) === p[1] : v === true || v === 'true' || v === 'yes';
    }
    if (cond.indexOf('format:') === 0) return cond.slice(7).split('|').indexOf(data.format) >= 0;
    if (cond === 'photos' || cond === 'sponsors' || cond === 'campaign' || cond === 'details') return count(cond) > 0;
    if (cond === 'background') return !!(data.background && data.background.src);
    return fieldValue(cond) !== null;
  }
  // Outermost first: a removed parent takes its children with it.
  $all('[data-if]').forEach(function (el) {
    if (!poster.contains(el)) return;
    var ok = el.getAttribute('data-if').split('&').every(test);
    if (!ok) remove(el);
  });

  // ---------------------------------------------------------------- text
  $all('[data-field]').forEach(function (el) {
    var name = el.getAttribute('data-field');
    var v = fieldValue(name);
    if (v === null || typeof v !== 'string') {
      remove(el);
      return;
    }
    if (el.getAttribute('data-case') === 'upper') v = v.toUpperCase();
    // Line breaks the writer chose are kept; everything is text (never HTML).
    var parts = v.split(/\n/);
    el.textContent = '';
    parts.forEach(function (part, i) {
      if (i) el.appendChild(document.createElement('br'));
      el.appendChild(document.createTextNode(part));
    });
    el.setAttribute('data-check', el.getAttribute('data-check') || 'text');
  });

  var ICONS = {
    date: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    time: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    place: '<path d="M12 21s-6.5-6.2-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 14.8 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.3"/>',
    phone: '<path d="M6.5 3.5h3l1.5 4.5-2 1.5a11 11 0 0 0 5.5 5.5l1.5-2 4.5 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 4.5 5.5a2 2 0 0 1 2-2z"/>',
    web: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.6 3.5 5.6 3.5 8.5s-.9 5.9-3.5 8.5c-2.6-2.6-3.5-5.6-3.5-8.5s.9-5.9 3.5-8.5z"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.4"/>'
  };
  $all('[data-details]').forEach(function (box) {
    var items = fieldValue('details') || [];
    var tpl = box.querySelector('template');
    if (!tpl || !items.length) {
      remove(box);
      return;
    }
    items.slice(0, 5).forEach(function (item) {
      var node = tpl.content.firstElementChild.cloneNode(true);
      var icon = node.querySelector('[data-detail-icon]');
      if (icon) icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[item.kind] || ICONS.info) + '</svg>';
      var t = node.querySelector('[data-detail-text]') || node;
      t.textContent = String(item.text || '');
      node.setAttribute('data-check', 'text');
      node.setAttribute('data-key', 'detail-' + item.kind);
      box.appendChild(node);
    });
    remove(tpl);
  });

  $all('[data-badge]').forEach(function (box) {
    var b = fieldValue('badge');
    if (!b) {
      remove(box);
      return;
    }
    ['top', 'main', 'bottom'].forEach(function (part) {
      var el = box.querySelector('[data-badge-' + part + ']');
      if (!el) return;
      if (hasText(b[part])) el.textContent = b[part];
      else remove(el);
    });
    box.setAttribute('data-check', 'badge');
  });

  // ---------------------------------------------------------------- images
  var pending = [];
  function addImg(container, src, cls) {
    var img = document.createElement('img');
    img.className = cls;
    img.alt = '';
    img.decoding = 'sync';
    img.src = src;
    pending.push(
      img.decode().catch(function () {
        return null;
      })
    );
    container.appendChild(img);
    return img;
  }

  $all('[data-photo]').forEach(function (box) {
    var i = Number(box.getAttribute('data-photo')) - 1;
    var p = photos[i];
    if (!p) {
      remove(box);
      return;
    }
    box.classList.add('d-photo');
    var img = addImg(box, p.src, 'd-photo-img');
    img.setAttribute('data-photo-index', String(i));
    box.setAttribute('data-check', box.getAttribute('data-check') || 'photo');
  });

  $all('[data-bg]').forEach(function (box) {
    var bg = data.background;
    if (!bg || !bg.src) {
      remove(box);
      return;
    }
    box.classList.add('d-photo');
    var img = addImg(box, bg.src, 'd-photo-img');
    img.setAttribute('data-bg-img', '1');
  });

  function logoFor(role) {
    if (role === 'primary') return data.logos && data.logos.primary;
    if (role === 'campaign') return data.logos && data.logos.campaign && data.logos.campaign[0];
    return null;
  }
  // Picks the variant that reads on the surface: light surfaces want dark/colour ink.
  function variantFor(logo, surface) {
    var vs = logo.variants || [];
    if (!vs.length) return null;
    var dark = surface === 'dark';
    var scored = vs
      .map(function (v) {
        var reads = dark ? v.onDark : v.onLight;
        var score = (reads ? 4 : 0) + (dark ? (v.variant === 'reverse' ? 1 : 0) : v.variant === 'color' ? 1 : 0);
        return { v: v, s: score };
      })
      .sort(function (a, b) {
        return b.s - a.s;
      });
    return scored[0].v;
  }
  // A logo with no version for this surface sits on a plate of its own clear space (never recoloured).
  function plate(box, v, surface) {
    box.classList.toggle('d-plated', surface === 'dark' && !v.onDark);
    box.classList.toggle('d-plated-dark', surface !== 'dark' && !v.onLight && box.getAttribute('data-plate') !== 'none');
  }
  $all('[data-logo]').forEach(function (box) {
    var role = box.getAttribute('data-logo');
    var logo = logoFor(role);
    if (!logo) {
      remove(box);
      return;
    }
    var surface = box.getAttribute('data-surface') || 'light';
    var v = variantFor(logo, surface === 'auto' ? 'light' : surface);
    if (!v) {
      remove(box);
      return;
    }
    box.classList.add('d-logo');
    plate(box, v, surface === 'auto' ? 'light' : surface);
    box.setAttribute('data-check', 'logo');
    box.setAttribute('data-logo-id', logo.id);
    box.setAttribute('data-variant', v.variant);
    var img = addImg(box, v.src, 'd-logo-img');
    img.style.aspectRatio = v.width + ' / ' + v.height;
  });

  $all('[data-sponsors]').forEach(function (box) {
    if (!sponsors.length) {
      remove(box);
      return;
    }
    var row = box.querySelector('[data-sponsor-row]') || box;
    sponsors.forEach(function (s, i) {
      var item = document.createElement('div');
      item.className = 'd-sponsor';
      item.setAttribute('data-check', 'sponsor');
      item.setAttribute('data-key', 'sponsor-' + (i + 1));
      item.setAttribute('data-logo-id', 'sponsor-' + (i + 1));
      var img = addImg(item, s.src, 'd-sponsor-img');
      img.style.aspectRatio = s.width + ' / ' + s.height;
      item.__meta = s;
      row.appendChild(item);
    });
  });

  // ---------------------------------------------------------------- layout after load
  // A number attribute, or "param:key" to take it from the design's settings.
  function attrNumber(el, name, dflt) {
    var v = el.getAttribute(name);
    if (v && v.indexOf('param:') === 0) v = params[v.slice(6)];
    var n = Number(v);
    return v === null || v === undefined || v === '' || isNaN(n) ? dflt : n;
  }
  function placePhoto(img) {
    var box = img.parentElement;
    var bw = box.clientWidth;
    var bh = box.clientHeight;
    if (!bw || !bh) return;
    var isBg = img.hasAttribute('data-bg-img');
    var p = isBg ? data.background : photos[Number(img.getAttribute('data-photo-index'))];
    var iw = p.width || img.naturalWidth;
    var ih = p.height || img.naturalHeight;
    var zoom = attrNumber(box, 'data-zoom', 1);
    var s = Math.max(bw / iw, bh / ih) * Math.max(1, zoom);
    var dw = iw * s;
    var dh = ih * s;
    var tweakFocus = !isBg && data.tweaks && data.tweaks.focus ? data.tweaks.focus[img.getAttribute('data-photo-index')] : null;
    var f = tweakFocus || (p.focal || { x: 0.5, y: 0.45 });
    // Where in the box the subject should sit (a design can push it aside to leave room for words).
    var hx = attrNumber(box, 'data-focus-x', 0.5);
    var hy = attrNumber(box, 'data-focus-y', 0.45);
    var ox = clamp(f.x * dw - hx * bw, 0, dw - bw);
    var oy = clamp(f.y * dh - hy * bh, 0, dh - bh);
    // Keep the whole subject (face, person) in frame when it fits.
    var b = !tweakFocus && p.focal && p.focal.box;
    if (b) {
      var left = b.x * dw;
      var right = (b.x + b.w) * dw;
      var top = b.y * dh;
      var bottom = (b.y + b.h) * dh;
      if (right - left <= bw) ox = clamp(ox, Math.max(0, right - bw), Math.min(dw - bw, left));
      if (bottom - top <= bh) oy = clamp(oy, Math.max(0, bottom - bh), Math.min(dh - bh, top));
    }
    img.style.width = dw + 'px';
    img.style.height = dh + 'px';
    img.style.left = -ox + 'px';
    img.style.top = -oy + 'px';
  }

  function placeLogos() {
    $all('.d-logo').forEach(function (box) {
      var img = box.querySelector('img');
      var bcs = getComputedStyle(box);
      var h = box.clientHeight - parseFloat(bcs.paddingTop) - parseFloat(bcs.paddingBottom);
      if (!h) {
        h = parseFloat(getComputedStyle(box).getPropertyValue('--logo-h')) || MIN * 0.08;
        box.style.height = h + 'px';
      }
      img.style.height = h + 'px';
      img.style.width = 'auto';
      var logo = logoFor(box.getAttribute('data-logo'));
      box.style.setProperty('--clear', (logo.clearSpace || 0.25) * h + 'px');
    });
  }

  // Sponsor logos are sized by how big they look, not by width: a wide wordmark gets less height than
  // a square badge, and dense logos are toned down, so the row feels even.
  function layoutSponsors() {
    $all('[data-sponsors]').forEach(function (box) {
      var row = box.querySelector('[data-sponsor-row]') || box;
      var items = $all('.d-sponsor', row);
      if (!items.length) return;
      var W0 = row.clientWidth;
      var H0 = row.clientHeight || MIN * 0.07;
      var rows = items.length > 4 && box.getAttribute('data-rows') === '2' ? 2 : 1;
      var perRow = Math.ceil(items.length / rows);
      var rowH = rows === 2 ? (H0 - H0 * 0.18) / 2 : H0;
      var gap = rowH * 0.55;
      var primary = logoFor('primary');
      var primaryBox = poster.querySelector('[data-logo="primary"]');
      var primaryArea = primary && primaryBox ? primaryBox.clientHeight * primaryBox.clientHeight * (primary.aspect || 2) * (0.55 + 0.45 * (primary.ink || 0.5)) : Infinity;
      function heights(A) {
        return items.map(function (it) {
          var m = it.__meta;
          var a = m.width / m.height;
          var h = Math.sqrt(A / (a * (0.55 + 0.45 * (m.ink || 0.5))));
          return clamp(h, rowH * 0.28, rowH * 0.92);
        });
      }
      function widthOf(hs, from, to) {
        var w = 0;
        for (var i = from; i < to; i++) w += (items[i].__meta.width / items[i].__meta.height) * hs[i];
        return w + gap * (to - from - 1);
      }
      var lo = 1;
      var hi = rowH * rowH * 6;
      for (var k = 0; k < 30; k++) {
        var mid = (lo + hi) / 2;
        var hs = heights(mid);
        var fits = true;
        for (var r = 0; r < rows; r++) {
          if (widthOf(hs, r * perRow, Math.min(items.length, (r + 1) * perRow)) > W0) fits = false;
        }
        // Partners never outweigh the club logo (Rotary rule; a sensible default for everyone).
        hs.forEach(function (h, i) {
          var m = items[i].__meta;
          if (h * h * (m.width / m.height) * (0.55 + 0.45 * (m.ink || 0.5)) > primaryArea * 0.8) fits = false;
        });
        if (fits) lo = mid;
        else hi = mid;
      }
      var final = heights(lo);
      row.style.setProperty('--sponsor-gap', gap + 'px');
      items.forEach(function (it, i) {
        var img = it.querySelector('img');
        img.style.height = final[i] + 'px';
        img.style.width = (it.__meta.width / it.__meta.height) * final[i] + 'px';
        if (rows === 2) it.style.flexBasis = 'auto';
      });
      if (rows === 2) row.classList.add('d-two-rows');
    });
  }

  // ---------------------------------------------------------------- type fitting
  // data-fit with data-min / data-max (in hundredths of the poster's short side) and data-lines.
  // Everything starts at its minimum; then, by priority, each grows as large as its box allows.
  function fitBox(el) {
    var b = el.closest('[data-fit-box]');
    return b || el.parentElement;
  }
  function overflows(box) {
    return box.scrollHeight > box.clientHeight + 1 || box.scrollWidth > box.clientWidth + 1;
  }
  function lineCount(el) {
    var cs = getComputedStyle(el);
    var lh = parseFloat(cs.lineHeight);
    if (!lh || isNaN(lh)) lh = parseFloat(cs.fontSize) * 1.2;
    return Math.round(el.getBoundingClientRect().height / lh);
  }
  function wordTooWide(el) {
    // A single word wider than its box (e.g. a long name at a huge size) is never allowed.
    return el.scrollWidth > el.clientWidth + 1;
  }
  function fitTexts() {
    var scale = (data.tweaks && data.tweaks.headlineScale) || 1;
    var els = $all('[data-fit]').filter(function (el) {
      return poster.contains(el);
    });
    els.forEach(function (el) {
      el.style.fontSize = (Number(el.getAttribute('data-min') || 3) * MIN) / 100 + 'px';
    });
    els
      .slice()
      .sort(function (a, b) {
        return Number(a.getAttribute('data-fit-order') || 5) - Number(b.getAttribute('data-fit-order') || 5);
      })
      .forEach(function (el) {
        var box = fitBox(el);
        var isHeadline = el.getAttribute('data-field') === 'headline';
        var min = (Number(el.getAttribute('data-min') || 3) * MIN) / 100;
        var max = (Number(el.getAttribute('data-max') || 8) * MIN) / 100 * (isHeadline ? scale : 1);
        var maxLines = Number(el.getAttribute('data-lines') || 99);
        var lo = min;
        var hi = Math.max(min, max);
        for (var k = 0; k < 16; k++) {
          var mid = (lo + hi) / 2;
          el.style.fontSize = mid + 'px';
          if (!overflows(box) && !wordTooWide(el) && lineCount(el) <= maxLines) lo = mid;
          else hi = mid;
        }
        el.style.fontSize = lo + 'px';
        el.setAttribute('data-fitted', String(Math.round(lo * 10) / 10));
      });
  }

  // data-measure="copy": where the element's content really ended up, as CSS variables on the
  // poster (--copy-top, --copy-bottom, --copy-left, --copy-right, --copy-h, in px), so a design can
  // put its colour fade exactly behind the words however long they are.
  function publishMeasures() {
    $all('[data-measure]').forEach(function (el) {
      var name = el.getAttribute('data-measure');
      var kids = Array.prototype.slice.call(el.children).filter(function (c) {
        return c.getBoundingClientRect().height > 0;
      });
      var rs = (kids.length ? kids : [el]).map(rect);
      var top = Math.min.apply(null, rs.map(function (r) { return r.y; }));
      var bottom = Math.max.apply(null, rs.map(function (r) { return r.y + r.h; }));
      var left = Math.min.apply(null, rs.map(function (r) { return r.x; }));
      var right = Math.max.apply(null, rs.map(function (r) { return r.x + r.w; }));
      poster.style.setProperty('--' + name + '-top', top + 'px');
      poster.style.setProperty('--' + name + '-bottom', bottom + 'px');
      poster.style.setProperty('--' + name + '-left', left + 'px');
      poster.style.setProperty('--' + name + '-right', right + 'px');
      poster.style.setProperty('--' + name + '-h', bottom - top + 'px');
    });
  }

  // ---------------------------------------------------------------- measuring
  function rect(el) {
    var r = el.getBoundingClientRect();
    var p = poster.getBoundingClientRect();
    return { x: r.left - p.left, y: r.top - p.top, w: r.width, h: r.height };
  }
  // The ink of a text element (its lines), tighter than its box: what overlaps are judged on.
  function textRect(el) {
    var range = document.createRange();
    range.selectNodeContents(el);
    var rs = Array.prototype.slice.call(range.getClientRects()).filter(function (r) {
      return r.width > 0 && r.height > 0;
    });
    if (!rs.length) return rect(el);
    var p = poster.getBoundingClientRect();
    var x0 = Math.min.apply(null, rs.map(function (r) { return r.left; }));
    var x1 = Math.max.apply(null, rs.map(function (r) { return r.right; }));
    // Elements with their own background (a button) count as a whole.
    var bg = getComputedStyle(el).backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return rect(el);
    // Width from the ink, height from the element's lines (glyph boxes overhang tight leading).
    var own = rect(el);
    return { x: x0 - p.left, y: own.y, w: x1 - x0, h: own.h };
  }
  function measure() {
    var out = [];
    var n = 0;
    $all('[data-check]').forEach(function (el) {
      var kind = el.getAttribute('data-check');
      var key = el.getAttribute('data-key') || el.getAttribute('data-field') || el.getAttribute('data-logo') || kind + '-' + ++n;
      var m = { key: key, kind: kind, box: rect(el) };
      var why = null;
      if (kind === 'text') {
        m.box = textRect(el);
        var cs = getComputedStyle(el);
        m.field = el.getAttribute('data-field') || key;
        m.fontSize = parseFloat(cs.fontSize);
        m.color = cs.color;
        m.lines = lineCount(el);
        var box = el.hasAttribute('data-fit') ? fitBox(el) : null;
        why = [];
        if (box && overflows(box)) why.push('box ' + box.scrollHeight + '/' + box.clientHeight + ' ' + box.scrollWidth + '/' + box.clientWidth);
        if (el.scrollWidth > el.clientWidth + 2) why.push('w ' + el.scrollWidth + '/' + el.clientWidth);
        m.overflow = why.length > 0;
        // Text cut off by a clipping parent counts as overflow too (tight leading may overhang a
        // little above and below the lines: that's allowed).
        var r = el.getBoundingClientRect();
        var slack = Math.max(2, m.fontSize * 0.2);
        var c = el.parentElement;
        while (c && c !== poster) {
          var ccs = getComputedStyle(c);
          if (ccs.overflow !== 'visible') {
            var cr = c.getBoundingClientRect();
            if (r.bottom > cr.bottom + slack || r.right > cr.right + 2 || r.top < cr.top - slack || r.left < cr.left - 2) {
              m.overflow = true;
              why.push('clipped by ' + (c.className || c.tagName));
            }
          }
          c = c.parentElement;
        }
      }
      if (why && why.length) m.why = why.join('; ');
      if (kind === 'logo') {
        var img = el.querySelector('img');
        var logo = logoFor(el.getAttribute('data-logo'));
        m.box = rect(img);
        m.logoId = el.getAttribute('data-logo-id');
        m.clearSpace = (logo && logo.clearSpace ? logo.clearSpace : 0.25) * m.box.h;
        m.visualArea = m.box.w * m.box.h * (0.55 + 0.45 * ((logo && logo.ink) || 0.5));
      }
      if (kind === 'sponsor') {
        var sImg = el.querySelector('img');
        m.box = rect(sImg);
        m.logoId = el.getAttribute('data-logo-id');
        m.visualArea = m.box.w * m.box.h * (0.55 + 0.45 * ((el.__meta && el.__meta.ink) || 0.5));
      }
      out.push(m);
    });
    return out;
  }

  // ---------------------------------------------------------------- hooks for the renderer
  window.__design = {
    report: function () {
      return measure();
    },
    // Hide words and logos to photograph what's behind them (contrast and variant choice).
    sampling: function (on) {
      document.documentElement.classList.toggle('d-sampling', !!on);
    },
    // Text colour for data-tone="auto" elements, chosen from what's behind them.
    setTones: function (map) {
      Object.keys(map).forEach(function (key) {
        $all('[data-tone="auto"]').forEach(function (el) {
          var k = el.getAttribute('data-key') || el.getAttribute('data-field');
          if (k === key) el.setAttribute('data-tone-set', map[key]);
        });
      });
    },
    autoToneKeys: function () {
      return $all('[data-tone="auto"]').map(function (el) {
        return { key: el.getAttribute('data-key') || el.getAttribute('data-field'), box: rect(el) };
      });
    },
    // Logos on data-surface="auto": choose the variant that reads on what's behind.
    autoLogos: function () {
      return $all('.d-logo[data-surface="auto"]').map(function (el) {
        return { role: el.getAttribute('data-logo'), box: rect(el) };
      });
    },
    setLogoSurface: function (role, surface) {
      $all('.d-logo[data-logo="' + role + '"]').forEach(function (el) {
        var logo = logoFor(role);
        var v = variantFor(logo, surface);
        if (!v) return;
        var img = el.querySelector('img');
        img.src = v.src;
        img.style.aspectRatio = v.width + ' / ' + v.height;
        el.setAttribute('data-variant', v.variant);
        el.setAttribute('data-surface-set', surface);
        plate(el, v, surface);
      });
    }
  };

  Promise.all(pending)
    .then(function () {
      return document.fonts.ready;
    })
    .then(function () {
      placeLogos();
      layoutSponsors();
      fitTexts();
      // Fitting can move boxes: place photos last, then logos again (their boxes may have moved).
      $all('.d-photo-img').forEach(placePhoto);
      placeLogos();
      publishMeasures();
      document.documentElement.setAttribute('data-ready', '1');
    })
    .catch(function (e) {
      document.documentElement.setAttribute('data-error', String((e && e.message) || e));
      document.documentElement.setAttribute('data-ready', '1');
    });
})();

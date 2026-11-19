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

  // Designs adapt to how many sponsors there are: #poster.d-sp-ge-4 means "4 or more".
  for (var spk = 1; spk <= sponsors.length; spk++) poster.classList.add('d-sp-ge-' + spk);
  poster.setAttribute('data-sponsor-count', String(sponsors.length));

  function fieldValue(name) {
    if (hidden.indexOf(name) >= 0) return null;
    var v = text[name];
    if (name === 'details') return Array.isArray(v) && v.length ? v : null;
    if (name === 'badge') return v && hasText(v.main) ? v : null;
    return hasText(v) ? v : null;
  }

  // ---------------------------------------------------------------- conditions
  // data-if="headline", "!subhead", "photos>=2", "sponsors", "background", "campaign", "cutout",
  // "person" (a featured person's name), "contact" (handle or website),
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
    if (cond === 'cutout') return !!(photos[0] && photos[0].cutout && photos[0].cutout.src);
    if (cond === 'person') return fieldValue('personName') !== null;
    if (cond === 'contact') return fieldValue('social') !== null || fieldValue('web') !== null;
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
    // Line breaks the writer chose are kept; *words in stars* are set in the design's emphasis
    // style (<em>); everything else is text (never HTML).
    var parts = v.split(/\n/);
    el.textContent = '';
    parts.forEach(function (part, i) {
      if (i) el.appendChild(document.createElement('br'));
      var bits = part.split(/\*([^*]+)\*/);
      bits.forEach(function (bit, j) {
        if (!bit) return;
        if (j % 2) {
          var em = document.createElement('em');
          em.textContent = bit;
          el.appendChild(em);
        } else el.appendChild(document.createTextNode(bit.replace(/\*/g, '')));
      });
    });
    el.setAttribute('data-check', el.getAttribute('data-check') || 'text');
  });

  var ICONS = {
    date: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    time: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    place: '<path d="M12 21s-6.5-6.2-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 14.8 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.3"/>',
    phone: '<path d="M6.5 3.5h3l1.5 4.5-2 1.5a11 11 0 0 0 5.5 5.5l1.5-2 4.5 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 4.5 5.5a2 2 0 0 1 2-2z"/>',
    web: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.6 3.5 5.6 3.5 8.5s-.9 5.9-3.5 8.5c-2.6-2.6-3.5-5.6-3.5-8.5s.9-5.9 3.5-8.5z"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.4"/>',
    at: '<circle cx="12" cy="12" r="3.6"/><path d="M15.6 12v1.4a2.6 2.6 0 0 0 5.2 0V12a8.8 8.8 0 1 0-3.5 7"/>'
  };
  // Drawn icons next to words: <span data-icon="web"></span> (removed with its field's element).
  $all('[data-icon]').forEach(function (el) {
    el.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[el.getAttribute('data-icon')] || ICONS.info) + '</svg>';
    el.classList.add('d-icon');
  });
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

  // The first photo's subject cut out of its background, standing in a box (bottom-anchored, never
  // cropped: a cut-out person is shown whole as far as the photo goes).
  $all('[data-cutout]').forEach(function (box) {
    var i = Number(box.getAttribute('data-cutout') || 1) - 1;
    var c = photos[i] && photos[i].cutout;
    if (!c || !c.src) {
      remove(box);
      return;
    }
    box.classList.add('d-cutout');
    var img = addImg(box, c.src, 'd-cutout-img');
    img.__cut = c;
    box.setAttribute('data-check', 'cutout');
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
  // ---------------------------------------------------------------- logo versions
  // Each version knows the luminance of its outline (where it meets the ground). A version reads
  // when most of its outline reaches 3:1 against the ground (WCAG's bar for graphics). Supplied
  // versions come first; the one-colour white or dark version made from a one-colour logo next;
  // if none reads, the logo sits on a plate of its own clear space (never recoloured otherwise).
  function lumOfCss(c) {
    var m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return null;
    var p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
    if (p.length > 3 && p[3] === 0) return null;
    var f = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(p[0]) + 0.7152 * f(p[1]) + 0.0722 * f(p[2]);
  }
  function ratio(a, b) { return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); }
  function edgeOf(v) {
    if (v.edge && v.edge.length) return v.edge;
    // Older files: an estimate from what was known about them.
    if (v.onDark && !v.onLight) return [0.9];
    if (v.onLight && !v.onDark) return [0.06];
    var l = typeof v.lightness === 'number' ? Math.pow(v.lightness, 2.2) : 0.3;
    return [l];
  }
  // Share of the outline reaching a contrast ratio against the ground (both of its ends).
  function readShare(v, ground, min) {
    var e = edgeOf(v), ok = 0;
    for (var i = 0; i < e.length; i++) if (ratio(e[i], ground.lo) >= min && ratio(e[i], ground.hi) >= min) ok++;
    return ok / e.length;
  }
  function median(a) { return a[Math.floor(a.length / 2)]; }
  // The ground behind an element from the page's own colours (the sampling pass refines it).
  function groundOf(el, declared) {
    for (var c = el; c; c = c.parentElement) {
      var l = lumOfCss(getComputedStyle(c).backgroundColor);
      if (l !== null) return { lo: l, hi: l };
      if (c === poster) break;
    }
    var paper = lumOfCss(getComputedStyle(poster).getPropertyValue('--c-paper').trim().replace(/^#(..)(..)(..)$/, function (_, r, g, b) { return 'rgb(' + parseInt(r, 16) + ',' + parseInt(g, 16) + ',' + parseInt(b, 16) + ')'; })) ;
    if (declared === 'dark') return { lo: 0.02, hi: 0.04 };
    return { lo: paper === null ? 1 : paper, hi: paper === null ? 1 : paper };
  }
  // Reads well at 4.5:1 (what brand guides ask for: the white version on colour), acceptable at
  // 3:1 (WCAG's floor for graphics) when no version does better; below that, a plate.
  function pickVersion(variants, ground) {
    var best = null, bestScore = -1;
    variants.forEach(function (v) {
      var well = readShare(v, ground, 4.5);
      var ok = readShare(v, ground, 3);
      var score = (well >= 0.8 ? 20 : ok >= 0.8 ? 10 : 0) + (v.derived ? 0 : 3) + ok * 2 + (v.variant === 'color' ? 0.5 : 0);
      if (score > bestScore) { bestScore = score; best = { v: v, share: ok }; }
    });
    if (!best) return null;
    if (best.share >= 0.8) return { v: best.v, plate: null };
    // Nothing reads: the supplied colour version on the plate it reads on.
    var sup = variants.filter(function (v) { return !v.derived; });
    var v0 = sup.filter(function (v) { return v.variant === 'color'; })[0] || sup[0] || best.v;
    return { v: v0, plate: median(edgeOf(v0)) < 0.35 ? 'light' : 'dark' };
  }
  function applyPlate(box, plate) {
    box.classList.toggle('d-plate-light', plate === 'light');
    box.classList.toggle('d-plate-dark', plate === 'dark');
    if (plate) box.setAttribute('data-plated', plate);
    else box.removeAttribute('data-plated');
  }
  function useVersion(box, img, choice) {
    var v = choice.v;
    if (img.getAttribute('src') !== v.src) img.src = v.src;
    img.style.aspectRatio = v.width + ' / ' + v.height;
    box.setAttribute('data-variant', v.variant + (v.derived ? '-derived' : ''));
    applyPlate(box, box.getAttribute('data-plate') === 'none' ? null : choice.plate);
  }
  $all('[data-logo]').forEach(function (box) {
    var role = box.getAttribute('data-logo');
    var logo = logoFor(role);
    if (!logo || !(logo.variants || []).length) {
      remove(box);
      return;
    }
    box.classList.add('d-logo');
    box.setAttribute('data-check', 'logo');
    box.setAttribute('data-logo-id', logo.id);
    var choice = pickVersion(logo.variants, groundOf(box.parentElement, box.getAttribute('data-surface')));
    var img = addImg(box, choice.v.src, 'd-logo-img');
    useVersion(box, img, choice);
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
      useVersion(item, img, pickVersion(s.variants || [s], groundOf(row, 'light')));
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
    // How much the photo is enlarged (poster pixels per photo pixel): a small file blown up looks soft.
    if (!isBg) img.setAttribute('data-upscale', String(Math.round(s * 100) / 100));
    var dw = iw * s;
    var dh = ih * s;
    var tweakFocus = !isBg && data.tweaks && data.tweaks.focus ? data.tweaks.focus[img.getAttribute('data-photo-index')] : null;
    var f = tweakFocus || (p.focal || { x: 0.5, y: 0.45 });
    // Where in the box the subject should sit (a design can push it aside to leave room for words).
    var hx = attrNumber(box, 'data-focus-x', 0.5);
    var hy = attrNumber(box, 'data-focus-y', 0.45);
    var ox = clamp(f.x * dw - hx * bw, 0, dw - bw);
    var oy = clamp(f.y * dh - hy * bh, 0, dh - bh);
    // data-slide: a photo too narrow to move inside its box may slide right, past the box's left
    // edge (by up to 60% of the box); its own left edge then fades into what's behind.
    var slid = false;
    if (box.hasAttribute('data-slide') && f.x * dw - hx * bw < 0) {
      ox = Math.max(-bw * 0.6, f.x * dw - hx * bw);
      slid = ox < -1;
    }
    // Keep the whole subject (face, person) in frame when it fits.
    var b = !tweakFocus && p.focal && p.focal.box;
    if (b) {
      var left = b.x * dw;
      var right = (b.x + b.w) * dw;
      var top = b.y * dh;
      var bottom = (b.y + b.h) * dh;
      if (!slid && right - left <= bw) ox = clamp(ox, Math.max(0, right - bw), Math.min(dw - bw, left));
      if (bottom - top <= bh) oy = clamp(oy, Math.max(0, bottom - bh), Math.min(dh - bh, top));
    }
    img.style.width = dw + 'px';
    img.style.height = dh + 'px';
    img.style.left = -ox + 'px';
    img.style.top = -oy + 'px';
    var fade = slid ? 'linear-gradient(90deg, transparent 0, #000 ' + Math.round(Math.min(40, (bw * 0.25 * 100) / dw)) + '%)' : '';
    img.style.webkitMaskImage = fade;
    img.style.maskImage = fade;
    // Where the subject (usually a face) ended up, for the "words over the face" check.
    // With the people's box, the faces are a row across it at the focal height.
    // Only where the people really are is known (the art director's boxes); the automatic focal
    // point is a guess at texture and would raise false alarms.
    if (!isBg && p.focal && (p.focal.faces || p.focal.box)) {
      var sb = !tweakFocus && p.focal && p.focal.box;
      // The faces' own box when known; else a group's row across its box, or the focal point.
      var fb = !tweakFocus && p.focal && p.focal.faces;
      if (fb) img.__subject = { x0: fb.x * dw - ox, x1: (fb.x + fb.w) * dw - ox, y: (fb.y + fb.h / 2) * dh - oy, hh: (fb.h * dh) / 2 };
      else img.__subject = sb && (p.focal.people || 2) > 1 ? { x0: sb.x * dw - ox, x1: (sb.x + sb.w) * dw - ox, y: f.y * dh - oy } : { x0: f.x * dw - ox, x1: f.x * dw - ox, y: f.y * dh - oy };
    }
  }
  // Subjects of the photos as they show on the poster (only where the photo is visible there).
  function photoSubjects() {
    var out = [];
    $all('.d-photo-img').forEach(function (img) {
      if (!img.__subject) return;
      var b = rect(img.parentElement);
      var s = img.__subject;
      var y = b.y + s.y;
      var x0 = Math.max(b.x, b.x + s.x0);
      var x1 = Math.min(b.x + b.w, b.x + s.x1);
      if (y < b.y || y > b.y + b.h || x1 < x0) return;
      out.push({ x0: x0, x1: x1, y: y, hh: s.hh || 0 });
    });
    return out;
  }

  // Tall enough to fill the box's height, unless that makes it wider than allowed (data-max-w, a
  // share of the box width, default 1.25: a cut-out may spill out sideways a little); then centred
  // on data-focus-x and standing on the box's bottom edge.
  function placeCutouts() {
    $all('.d-cutout').forEach(function (box) {
      var img = box.querySelector('.d-cutout-img');
      var c = img && img.__cut;
      if (!c) return;
      var bw = box.clientWidth;
      var bh = box.clientHeight;
      var maxW = attrNumber(box, 'data-max-w', 1.25) * bw;
      var s = bh / c.height;
      if (c.width * s > maxW) s = maxW / c.width;
      var w = c.width * s;
      var h = c.height * s;
      var cx = attrNumber(box, 'data-focus-x', 0.5) * bw;
      var e0 = c.edges || {};
      // A side the photo's frame already cut may run off the box (and the poster) a little.
      var lo = Math.min(0, bw - w) - (e0.left ? w * 0.18 : 0);
      var hi = Math.max(0, bw - w) + (e0.right ? w * 0.18 : 0);
      img.style.width = w + 'px';
      img.style.height = h + 'px';
      img.style.left = clamp(cx - w / 2, lo, hi) + 'px';
      img.style.top = bh - h + 'px';
      // Where the photo's frame cut the person (a straight edge), let it fade out, unless that side
      // runs off the poster anyway.
      var e = c.edges || {};
      var r = img.getBoundingClientRect();
      var pr = poster.getBoundingClientRect();
      var fadeL = e.left && r.left > pr.left + 2;
      var fadeR = e.right && r.right < pr.right - 2;
      // data-stand: the person stands on the box's bottom edge (a band); "data-stand=portrait|square"
      // limits that to those formats, elsewhere a cut body fades out.
      var stand = box.getAttribute('data-stand');
      var stands = stand !== null && (stand === '' || stand.split('|').indexOf(data.format) >= 0);
      var fadeB = e.bottom && (stand !== null ? !stands : r.bottom < pr.bottom - 2);
      var masks = [];
      if (fadeL || fadeR) masks.push('linear-gradient(90deg, ' + (fadeL ? 'transparent 0, #000 16%' : '#000 0') + ', ' + (fadeR ? '#000 84%, transparent 100%' : '#000 100%') + ')');
      if (fadeB) masks.push('linear-gradient(180deg, #000 74%, transparent 100%)');
      if (masks.length) {
        img.style.webkitMaskImage = masks.join(', ');
        img.style.maskImage = masks.join(', ');
        if (masks.length > 1) {
          img.style.webkitMaskComposite = 'source-in';
          img.style.maskComposite = 'intersect';
        }
      }
    });
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
      // Measure the room with the logos collapsed: at their natural pixel size they would stretch
      // the row and every size worked out from it.
      items.forEach(function (it) {
        var im = it.querySelector('img');
        im.style.height = '0px';
        im.style.width = '0px';
      });
      var W0 = row.clientWidth;
      var H0 = row.clientHeight || MIN * 0.07;
      var allowTwo = box.getAttribute('data-rows') === '2' && items.length >= 3;
      // With four or more, keep two rows only if they really are bigger than one.
      var primary = logoFor('primary');
      var primaryBox = poster.querySelector('[data-logo="primary"]');
      var primaryArea = primary && primaryBox ? primaryBox.clientHeight * primaryBox.clientHeight * (primary.aspect || 2) * (0.55 + 0.45 * (primary.ink || 0.5)) : Infinity;
      var f = function (m) { return 0.55 + 0.45 * (m.ink || 0.5); };

      // Tries a number of rows with a smallest allowed height; returns the best sizes.
      function solve(rows, minShare) {
        var perRow = Math.ceil(items.length / rows);
        var rowH = rows === 2 ? (H0 * 0.82) / 2 : H0;
        var gap = rowH * 0.55;
        function heights(A) {
          return items.map(function (it) {
            var m = it.__meta;
            return clamp(Math.sqrt(A / ((m.width / m.height) * f(m))), rowH * minShare, rowH * 0.92);
          });
        }
        function fits(hs) {
          for (var r = 0; r < rows; r++) {
            var w = 0;
            var to = Math.min(items.length, (r + 1) * perRow);
            for (var i = r * perRow; i < to; i++) w += (items[i].__meta.width / items[i].__meta.height) * hs[i];
            if (w + gap * (to - r * perRow - 1) > W0) return false;
          }
          // Partners never outweigh the club logo (Rotary rule; a sensible default for everyone).
          for (var j = 0; j < hs.length; j++) {
            var m = items[j].__meta;
            if (hs[j] * hs[j] * (m.width / m.height) * f(m) > primaryArea * 0.8) return false;
          }
          return true;
        }
        var lo = 1;
        var hi = rowH * rowH * 8;
        for (var k = 0; k < 32; k++) {
          var mid = (lo + hi) / 2;
          if (fits(heights(mid))) lo = mid;
          else hi = mid;
        }
        var hs = heights(lo);
        return { rows: rows, gap: gap, hs: hs, ok: fits(hs), rowH: rowH };
      }
      var best = solve(1, 0.3);
      // One strip is the convention (clubs' posters run up to nine partners in a single row). Two
      // rows (where the design allows) only when one row can't hold them, or holds them so small
      // that two rows make them clearly bigger.
      var median = function (hs) { var a = hs.slice().sort(function (x, y) { return x - y; }); return a[Math.floor(a.length / 2)]; };
      var small = median(best.hs) < best.rowH * 0.45;
      if ((!best.ok || small) && allowTwo) {
        var two = solve(2, 0.3);
        if (two.ok && (!best.ok || median(two.hs) >= median(best.hs) * 1.25)) best = two;
      }
      if (!best.ok) best = solve(best.rows, 0.05);
      row.style.setProperty('--sponsor-gap', best.gap + 'px');
      row.classList.toggle('d-two-rows', best.rows === 2);
      if (best.rows === 2) row.style.maxWidth = '100%';
      items.forEach(function (it, i) {
        var img = it.querySelector('img');
        img.style.height = best.hs[i] + 'px';
        img.style.width = (it.__meta.width / it.__meta.height) * best.hs[i] + 'px';
      });
      // Two rows: break after the first half so both rows hold about the same number.
      if (best.rows === 2) {
        var half = Math.ceil(items.length / 2);
        var br = document.createElement('div');
        br.className = 'd-row-break';
        row.insertBefore(br, items[half]);
      }
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
    // The letters themselves: each text node's line boxes (an element's own box, e.g. a block <em>,
    // would count its full width).
    var rs = [];
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    var node;
    while ((node = walker.nextNode())) {
      if (!node.nodeValue || !node.nodeValue.trim()) continue;
      var range = document.createRange();
      range.selectNodeContents(node);
      Array.prototype.slice.call(range.getClientRects()).forEach(function (r) {
        if (r.width > 0 && r.height > 0) rs.push(r);
      });
    }
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
  // How much of a box (poster px) lies on the cut-out person's solid pixels (0..1): words over a
  // person are never allowed, whatever the contrast.
  var cutMaps = null;
  function cutoutMaps() {
    if (cutMaps) return cutMaps;
    cutMaps = [];
    $all('.d-cutout-img').forEach(function (img) {
      try {
        var r = rect(img);
        var cw = 160;
        var ch = Math.max(1, Math.round((cw * r.h) / Math.max(1, r.w)));
        var cv = document.createElement('canvas');
        cv.width = cw;
        cv.height = ch;
        var ctx = cv.getContext('2d');
        ctx.drawImage(img, 0, 0, cw, ch);
        var d = ctx.getImageData(0, 0, cw, ch).data;
        // The fade the engine put on cut sides counts as see-through.
        var fadeL = img.style.maskImage && img.style.maskImage.indexOf('transparent 0') >= 0;
        cutMaps.push({ r: r, w: cw, h: ch, a: d, fadeL: fadeL });
      } catch (e) {
        /* unreadable: no check */
      }
    });
    return cutMaps;
  }
  function overCutout(b) {
    var maps = cutoutMaps();
    if (!maps.length || b.w <= 0 || b.h <= 0) return 0;
    var hit = 0;
    var total = 0;
    for (var gy = 0; gy < 6; gy++) {
      for (var gx = 0; gx < 24; gx++) {
        var x = b.x + ((gx + 0.5) / 24) * b.w;
        var y = b.y + ((gy + 0.5) / 6) * b.h;
        total++;
        for (var k = 0; k < maps.length; k++) {
          var m = maps[k];
          var u = (x - m.r.x) / m.r.w;
          var v = (y - m.r.y) / m.r.h;
          if (u < 0 || v < 0 || u >= 1 || v >= 1) continue;
          if (m.fadeL && u < 0.12) continue;
          var px = Math.floor(u * m.w);
          var py = Math.floor(v * m.h);
          if (m.a[(py * m.w + px) * 4 + 3] > 140) {
            hit++;
            break;
          }
        }
      }
    }
    return hit / total;
  }

  // Words on a card or button of their own sit on that, not on what's behind it.
  function onOwnGround(el) {
    for (var c = el; c && c !== poster; c = c.parentElement) {
      var bg = getComputedStyle(c).backgroundColor;
      if (bg && bg !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(bg)) return true;
    }
    return false;
  }

  // Share of a text's box that something else sits on top of (a photo, a ring, a shape).
  // Probes a grid inside the letters' box and looks at everything stacked at each point, top first:
  // above the words there may only be things that paint nothing (layout boxes), other words (the
  // overlap check judges those), cut-out people (their own check) or decorations that ignore the
  // pointer (grain, light). Points where the words aren't hit at all (clipped) aren't counted here.
  var coveredBy = null;
  function paints(node) {
    if (!(node instanceof Element)) return false;
    var tag = node.tagName.toLowerCase();
    if (tag === 'img' || tag === 'canvas' || tag === 'video' || node instanceof SVGElement) return true;
    var cs = getComputedStyle(node);
    if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    if (cs.backgroundImage && cs.backgroundImage !== 'none') return true;
    var bg = cs.backgroundColor;
    if (bg && bg !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(bg)) return true;
    return false;
  }
  function masked(node) {
    for (var x = node; x && x !== poster; x = x.parentElement) {
      var cs = getComputedStyle(x);
      var mi = cs.maskImage || cs.webkitMaskImage;
      if (mi && mi !== 'none') return true;
    }
    return false;
  }
  function coveredShare(el, box) {
    var pr = poster.getBoundingClientRect();
    var cols = 7, rows = 3, hits = 0, n = 0;
    coveredBy = null;
    for (var i = 0; i < cols; i++) {
      for (var j = 0; j < rows; j++) {
        var x = pr.left + box.x + box.w * (0.08 + 0.84 * (i / (cols - 1)));
        var y = pr.top + box.y + box.h * (0.25 + 0.5 * (j / (rows - 1)));
        var stack = document.elementsFromPoint(x, y);
        var at = -1;
        for (var k = 0; k < stack.length; k++) if (stack[k] === el || el.contains(stack[k])) { at = k; break; }
        if (at < 0) continue;
        n++;

        for (var q = 0; q < at; q++) {
          var t = stack[q];
          if (t.contains(el)) continue;
          if (t.closest('[data-cutout]') || t.closest('[data-check="text"]')) continue;
          if (!paints(t)) continue;
          if (!coveredBy) coveredBy = (t.getAttribute('data-check') ? t.getAttribute('data-check') + ':' : '') + (String(t.className && t.className.baseVal !== undefined ? t.className.baseVal : t.className) || t.tagName.toLowerCase());
          hits++;
          break;
        }
      }
    }
    return n ? hits / n : 0;
  }

  // Share of a text's box lying on a bare photo: one not veiled by a fade laid over it and not
  // masked into the ground (those edges are soft, by design). Fades usually ignore the pointer, so
  // every layer takes part in the hit test while this looks.
  function onBarePhotoShare(el, box) {
    var pr = poster.getBoundingClientRect();
    var cols = 7, rows = 3, on = 0, n = 0;
    document.documentElement.classList.add('d-probing');
    try {
      for (var i = 0; i < cols; i++) {
        for (var j = 0; j < rows; j++) {
          var x = pr.left + box.x + box.w * (0.08 + 0.84 * (i / (cols - 1)));
          var y = pr.top + box.y + box.h * (0.25 + 0.5 * (j / (rows - 1)));
          var stack = document.elementsFromPoint(x, y);
          var at = -1;
          for (var k = 0; k < stack.length; k++) if (stack[k] === el || el.contains(stack[k])) { at = k; break; }
          if (at < 0) continue;
          n++;
          var veiled = false;
          for (var r = at + 1; r < stack.length; r++) {
            var below = stack[r];
            if (below === poster) break;
            if (below.contains(el)) continue;
            if (below.closest('[data-photo]')) {
              if (!veiled && !masked(below)) on++;
              break;
            }
            if (paints(below)) veiled = true;
          }
        }
      }
    } finally {
      document.documentElement.classList.remove('d-probing');
    }
    return n ? on / n : 0;
  }
  function measure() {
    var out = [];
    var n = 0;
    $all('[data-check]').forEach(function (el) {
      // Hidden on purpose (display: none, e.g. a detail the date block already shows): not on the poster.
      if (!el.getClientRects().length) return;
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
      if (kind === 'text') {
        // Words on their own coloured shape (a button, a pill): contrast is judged inside the shape,
        // away from its rounded ends, where the words actually sit.
        var obg = getComputedStyle(el).backgroundColor;
        if (obg && obg !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(obg)) {
          var rad = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, m.box.h / 2);
          var ix = Math.min(m.box.w * 0.3, rad + 2), iy = Math.min(m.box.h * 0.3, 2 + rad * 0.3);
          m.inner = { x: m.box.x + ix, y: m.box.y + iy, w: Math.max(1, m.box.w - ix * 2), h: Math.max(1, m.box.h - iy * 2) };
        }
        var cv = coveredShare(el, m.box);
        // Partly on a bare photo and partly off it: the line crosses the photo's edge.
        var bare = onBarePhotoShare(el, m.box);
        if (bare >= 0.08 && bare <= 0.92) m.photoEdge = Math.round(bare * 100) / 100;
        if (cv > 0) {
          m.covered = Math.round(cv * 100) / 100;
          if (why) why.push('under ' + coveredBy);
        }
      }
      if (kind === 'text' && !onOwnGround(el)) {
        var oc = overCutout(m.box);
        if (oc > 0) m.overPerson = Math.round(oc * 100) / 100;
        // data-person-ok="0.3": the design means the person to stand in front of these words
        // (huge letters read with part of them covered), up to that share.
        var allow = el.closest('[data-person-ok]');
        if (allow) m.personOk = Number(allow.getAttribute('data-person-ok')) || 0;
        // A face is about a tenth of the poster's short side across: words within that are on it.
        var rFace = MIN * 0.05;
        photoSubjects().forEach(function (s) {
          // With a faces box, a small margin around it; with only a point, a face-sized area.
          var rx = s.hh ? MIN * 0.012 : rFace;
          var ry = s.hh ? s.hh + MIN * 0.012 : rFace * 1.3;
          var hitX = s.x1 > m.box.x - rx && s.x0 < m.box.x + m.box.w + rx;
          var hitY = s.y > m.box.y - ry && s.y < m.box.y + m.box.h + ry;
          if (hitX && hitY) m.overSubject = true;
        });
      }
      if (kind === 'cutout') {
        var ci = el.querySelector('img');
        if (ci) m.box = rect(ci);
      }
      if (why && why.length) m.why = why.join('; ');
      if (kind === 'photo') {
        var up = 0;
        $all('img[data-upscale]', el).forEach(function (im) { up = Math.max(up, Number(im.getAttribute('data-upscale')) || 0); });
        if (up) m.upscale = up;
      }
      if (kind === 'logo' || kind === 'sponsor') {
        // Which version is shown, and whether it needed a plate.
        m.variant = el.getAttribute('data-variant') || undefined;
        if (el.getAttribute('data-plated')) m.plated = el.getAttribute('data-plated');
      }
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
    // Every logo and partner logo, to photograph what's behind it.
    logoGrounds: function () {
      return $all('.d-logo, .d-sponsor').map(function (el, i) {
        el.setAttribute('data-ground-key', 'g' + i);
        return { key: 'g' + i, box: rect(el) };
      });
    },
    // What's behind each (luminance low, high): its version is chosen again for that ground.
    setLogoGrounds: function (map) {
      $all('[data-ground-key]').forEach(function (el) {
        var g = map[el.getAttribute('data-ground-key')];
        if (!g) return;
        var img = el.querySelector('img');
        if (el.classList.contains('d-logo')) {
          var logo = logoFor(el.getAttribute('data-logo'));
          if (logo) useVersion(el, img, pickVersion(logo.variants, g));
        } else if (el.__meta) {
          useVersion(el, img, pickVersion(el.__meta.variants || [el.__meta], g));
        }
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
      // Boxes may follow measured words (var(--copy-top) …): publish them before placing pictures.
      publishMeasures();
      $all('.d-photo-img').forEach(placePhoto);
      placeCutouts();
      placeLogos();
      publishMeasures();
      document.documentElement.setAttribute('data-ready', '1');
    })
    .catch(function (e) {
      document.documentElement.setAttribute('data-error', String((e && e.message) || e));
      document.documentElement.setAttribute('data-ready', '1');
    });
})();

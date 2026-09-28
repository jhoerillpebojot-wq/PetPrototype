/* ============================================================
   FINUITY guided tour  (Fin shows you around)
   ------------------------------------------------------------
   Reuses Fin, the existing pet: the real #fin-pet-root element glides
   next to each highlighted element and an arrow points at it, while a
   speech bubble (styled like Fin's own) explains what to do.

   Steps live in virtual-pet/tour-steps.js (window.FinTourSteps) and point
   at real DOM elements through data-tour="..." attributes, never at fixed
   screen coordinates. This file finds the target, scrolls it into view,
   cuts a spotlight around it, and places Fin + the bubble in whichever
   spot fits (it re-checks on resize, scroll and layout changes).

   Public API (window.FinTour):
     start(fromUser)  begin the tour (wired to the ? Help button)
     stop()           leave the tour
     isActive()       true while the tour is running
     offer()          make Fin ask "Would you like me to show you around?"
     reset()          forget "later / never / done" so it is offered again

   Safe to remove: delete tour.js, tour-steps.js, tour.css, their tags in
   index.html, the Help button, and the data-tour attributes.
   ============================================================ */
(function(){
  'use strict';
  if(window.__finTourLoaded) return;
  window.__finTourLoaded = true;

  var LS_STATE = 'finTourState';        // {status:'done'|'skipped'|'later'|'never', at:ms}
  var SS_OFFERED = 'finTourOffered';    // offered once per browser session

  var DEF = {
    padding: 8,          // spotlight padding around the target
    gap: 14,             // space between target and bubble
    finGap: 26,          // space between target and Fin (room for the arrow)
    margin: 10,          // keep everything this far inside the screen
    topSafe: 72,         // px hidden behind the sticky header
    bottomSafe: 84,      // px hidden behind the mobile bottom nav
    cardWidth: 320,
    finSizeNarrow: 60,   // Fin's size (px) during the tour on narrow screens
    advanceDelay: 380,   // pause after the user's click before the next step
    findTimeout: 1800,   // how long to wait for a target to appear before skipping
    laterDays: 1,
    offerCheckMs: 2500,
    offerMaxTries: 120,
    offerQuietChecks: 2
  };
  var C = Object.assign({}, DEF, window.FinTourConfig || {});

  var INTERACTIVE = 'button,a,input,select,textarea,label,[onclick],.nav-item,.bnav-item,.pill,.card-link,.eye-btn,.theme-toggle';
  var BLOCKING_UI = '#welcome-splash,#tutorial-overlay,#auth-overlay,.pin-overlay,[id$="-modal"],#shortcuts-overlay.show';

  var S = {
    active: false, steps: [], idx: 0, dir: 1, token: 0,
    step: null, el: null, ui: null, shown: false,
    pet: null, petOrig: null, sig: '', missing: 0
  };

  /* ---------- small helpers ---------- */
  function reduced(){ return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function vpW(){ return document.documentElement.clientWidth || window.innerWidth; }
  function vpH(){ return window.innerHeight; }
  function clamp(v, lo, hi){ return Math.max(lo, Math.min(v, Math.max(lo, hi))); }
  function mk(l, t, w, h){ return { left:l, top:t, right:l+w, bottom:t+h, width:w, height:h, cx:l+w/2, cy:t+h/2 }; }
  function overlaps(a, b, m){
    m = m || 0;
    return !(a.right+m <= b.left || b.right+m <= a.left || a.bottom+m <= b.top || b.bottom+m <= a.top);
  }
  function overlapRatio(a, b){
    var w = Math.min(a.right,b.right) - Math.max(a.left,b.left);
    var h = Math.min(a.bottom,b.bottom) - Math.max(a.top,b.top);
    if(w<=0 || h<=0) return 0;
    return (w*h) / Math.max(1, b.width*b.height);
  }
  function distToRect(x, y, R){
    var dx = Math.max(R.left-x, 0, x-R.right), dy = Math.max(R.top-y, 0, y-R.bottom);
    return Math.sqrt(dx*dx + dy*dy);
  }
  function isNarrow(){ return vpW() < 700; }

  /* ---------- persisted state ---------- */
  function getState(){
    try{ return JSON.parse(localStorage.getItem(LS_STATE) || 'null'); }catch(e){ return null; }
  }
  function setState(status){
    try{ localStorage.setItem(LS_STATE, JSON.stringify({ status:status, at:Date.now() })); }catch(e){}
  }
  function eligible(){
    var st = getState();
    if(!st) return true;
    if(st.status === 'later') return Date.now() - (st.at||0) > C.laterDays*24*60*60*1000;
    return false;
  }

  /* ---------- finding targets ---------- */
  function queryAll(step){
    var sel = step.selector || (step.target ? '[data-tour="' + String(step.target).replace(/"/g,'\\"') + '"]' : null);
    if(!sel) return [];
    try{ return Array.prototype.slice.call(document.querySelectorAll(sel)); }catch(e){ return []; }
  }
  // Could this element become visible once its page is opened? (Used only to
  // keep "Step x of N" honest: e.g. the Goals nav link doesn't exist on the
  // mobile bottom bar, so that step is dropped up front.)
  function potentiallyVisible(el){
    for(var n = el; n && n !== document.body; n = n.parentElement){
      var cs = getComputedStyle(n);
      if(cs.display === 'none' && !(n.classList && n.classList.contains('section'))) return false;
    }
    return true;
  }
  function isVisible(el){
    if(!el || !el.isConnected) return false;
    var r = el.getBoundingClientRect();
    if(r.width < 2 || r.height < 2) return false;
    var cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  }
  function findTarget(step){
    var list = queryAll(step);
    for(var i=0;i<list.length;i++) if(isVisible(list[i])) return list[i];
    return null;
  }
  function waitForTarget(step, token, cb){
    var t0 = Date.now();
    (function poll(){
      if(token !== S.token || !S.active) return;
      var el = findTarget(step);
      if(el){ cb(el); return; }
      if(Date.now() - t0 > C.findTimeout){ cb(null); return; }
      setTimeout(poll, 100);
    })();
  }
  function ensurePage(step){
    if(!step.page || typeof window.show !== 'function') return false;
    var sec = document.getElementById(step.page);
    if(!sec || sec.classList.contains('active')) return false;
    try{ window.show(step.page); }catch(e){ return false; }
    return true;
  }
  function blocked(){
    var list = document.querySelectorAll(BLOCKING_UI);
    for(var i=0;i<list.length;i++){
      var el = list[i];
      if(el.closest && el.closest('#fin-tour-root')) continue;
      var cs = getComputedStyle(el);
      if(cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length) return true;
    }
    return false;
  }

  /* ---------- Fin (the real pet element) ---------- */
  function petMood(mood, ms){
    try{ if(window.FinPet && window.FinPet.setMood) window.FinPet.setMood(mood, ms||0); }catch(e){}
  }
  function petTakeover(){
    var P = window.FinPet, root = document.getElementById('fin-pet-root');
    S.pet = null;
    if(!P || !P.setTourMode || !root || root.classList.contains('fin-hidden')) return;
    P.setTourMode(true);
    var wasMin = root.classList.contains('fin-minimized');
    root.classList.remove('fin-minimized');
    var st = root.style;
    S.petOrig = { left:st.left, top:st.top, right:st.right, bottom:st.bottom, transform:st.transform, min:wasMin };
    st.transform = '';
    var r = root.getBoundingClientRect();
    S.petOrig.rect = { left:r.left, top:r.top };
    // switch from right/bottom anchoring to left/top so it can glide
    st.left = r.left + 'px'; st.top = r.top + 'px'; st.right = 'auto'; st.bottom = 'auto';
    void root.offsetWidth;
    root.classList.add('fin-touring');
    // On phones there's little free room around the target: Fin gets a bit smaller for the tour.
    if(isNarrow()) root.style.setProperty('--fin-avatar-size', C.finSizeNarrow + 'px');
    S.pet = root;
  }
  function petRelease(){
    var P = window.FinPet, root = S.pet, o = S.petOrig;
    S.pet = null; S.petOrig = null;
    if(P && P.setTourMode) P.setTourMode(false);
    if(!root || !o) return;
    root.style.left = o.rect.left + 'px';
    root.style.top = o.rect.top + 'px';
    root.style.removeProperty('--fin-avatar-size');   // grows back while still gliding home
    var restore = function(){
      root.classList.remove('fin-touring');
      var st = root.style;
      st.left = o.left; st.top = o.top; st.right = o.right; st.bottom = o.bottom; st.transform = o.transform;
      if(o.min) root.classList.add('fin-minimized');
    };
    if(reduced()) restore(); else setTimeout(restore, 720);
  }
  function petSize(){
    if(!S.pet) return null;
    var r = S.pet.getBoundingClientRect();
    return { w: r.width || 96, h: r.height || 96 };
  }

  /* ---------- UI ---------- */
  function build(){
    var r = document.createElement('div');
    r.id = 'fin-tour-root';
    r.className = 'ft-root';
    r.innerHTML =
      '<div class="ft-block" data-k="t"></div><div class="ft-block" data-k="b"></div>' +
      '<div class="ft-block" data-k="l"></div><div class="ft-block" data-k="r"></div>' +
      '<div class="ft-block ft-hole-block"></div>' +
      '<div class="ft-spot"></div>' +
      '<div class="ft-pointer ft-hidden"><div class="ft-pt-in"><svg viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M3 9h10V4l8 8-8 8v-5H3z" fill="currentColor" stroke="#0b0b0e" stroke-width="1.6" stroke-linejoin="round"/></svg></div></div>' +
      '<div class="ft-card" role="dialog" aria-live="polite" aria-labelledby="ft-title" tabindex="-1">' +
        '<button class="ft-close" type="button" aria-label="Skip tour">\u2715</button>' +
        '<div class="ft-stepno"></div>' +
        '<div class="ft-bar"><div class="ft-bar-fill"></div></div>' +
        '<div class="ft-title" id="ft-title"></div>' +
        '<div class="ft-desc"></div>' +
        '<div class="ft-hint"></div>' +
        '<div class="ft-actions">' +
          '<button class="ft-skip" type="button">Skip tour</button>' +
          '<button class="fin-bubble-btn fin-secondary ft-back" type="button">Back</button>' +
          '<button class="fin-bubble-btn ft-next" type="button">Next</button>' +
        '</div>' +
        '<div class="ft-tail" data-side="none"></div>' +
      '</div>';
    document.body.appendChild(r);
    var q = function(s){ return r.querySelector(s); };
    S.ui = {
      root: r, spot: q('.ft-spot'), holeBlock: q('.ft-hole-block'), pointer: q('.ft-pointer'),
      pointerIn: q('.ft-pt-in'), pointerSvg: q('.ft-pt-in svg'),
      card: q('.ft-card'), stepno: q('.ft-stepno'), fill: q('.ft-bar-fill'),
      title: q('.ft-title'), desc: q('.ft-desc'), hint: q('.ft-hint'),
      back: q('.ft-back'), next: q('.ft-next'), skip: q('.ft-skip'), close: q('.ft-close'), tail: q('.ft-tail'),
      blocks: { t:q('[data-k="t"]'), b:q('[data-k="b"]'), l:q('[data-k="l"]'), r:q('[data-k="r"]') }
    };
    S.ui.next.addEventListener('click', next);
    S.ui.back.addEventListener('click', back);
    S.ui.skip.addEventListener('click', function(){ stop('skipped'); });
    S.ui.close.addEventListener('click', function(){ stop('skipped'); });
    r.addEventListener('click', function(e){
      if(e.target.classList && e.target.classList.contains('ft-block')) nudge();
    });
  }
  function nudge(){
    if(reduced() || !S.ui) return;
    var c = S.ui.card;
    c.classList.remove('ft-nudge'); void c.offsetWidth; c.classList.add('ft-nudge');
    setTimeout(function(){ c.classList.remove('ft-nudge'); }, 360);
  }
  function destroyUI(){
    var ui = S.ui; S.ui = null;
    if(!ui) return;
    ui.root.classList.remove('ft-on');
    setTimeout(function(){ if(ui.root.parentNode) ui.root.parentNode.removeChild(ui.root); }, reduced() ? 0 : 320);
  }

  function hintFor(step){
    if(step.hint) return step.hint;
    var a = step.action || 'next';
    var touch = window.matchMedia && window.matchMedia('(hover: none)').matches;
    if(a === 'click') return (touch ? 'Tap' : 'Click') + ' the highlighted spot to continue, or press Next.';
    if(a === 'input') return 'Type in the highlighted field to continue, or press Next.';
    return '';
  }

  /* ---------- scrolling ---------- */
  function isPinned(el){
    for(var n = el; n && n !== document.body; n = n.parentElement){
      var p = getComputedStyle(n).position;
      if(p === 'fixed' || p === 'sticky') return true;
    }
    return false;
  }
  // Bring the target into the comfortable part of the screen, leaving room
  // for the bubble. Returns true if it scrolled.
  function ensureVisible(el, ch){
    if(isPinned(el)) return false;
    var vw = vpW(), vh = vpH();
    var top = C.topSafe, bottom = vh - C.bottomSafe, avail = bottom - top;
    var r = el.getBoundingClientRect();
    var roomAbove = r.top - top, roomBelow = bottom - r.bottom;
    var need = ch + C.gap + 6;
    var sideRoom = Math.max(r.left, vw - r.right) >= C.cardWidth + C.gap + 6;
    var inView = r.top >= top && r.bottom <= bottom;
    if(inView && (sideRoom || roomAbove >= need || roomBelow >= need)) return false;
    var desiredTop;
    if(r.height + need <= avail){
      // short enough: leave the bubble room below (or centre it if sides are free)
      desiredTop = sideRoom ? top + (avail - r.height)/2 : top + Math.max(8, Math.min(40, (avail - r.height - need)/2));
    } else {
      desiredTop = top + 8;   // tall target: show its top, bubble docks over the rest
    }
    var delta = r.top - desiredTop;
    if(Math.abs(delta) < 3) return false;
    try{ window.scrollBy({ top: delta, behavior: reduced() ? 'auto' : 'smooth' }); }
    catch(e){ window.scrollBy(0, delta); }
    return true;
  }

  /* ---------- layout ---------- */
  function targetBox(){
    var r = S.el.getBoundingClientRect();
    var pad = (S.step && S.step.padding != null) ? S.step.padding : C.padding;
    return mk(r.left - pad, r.top - pad, r.width + pad*2, r.height + pad*2);
  }
  function holeRect(){
    var vw = vpW(), vh = vpH(), T = targetBox();
    var l = clamp(T.left, 0, vw), t = clamp(T.top, 0, vh);
    var rgt = clamp(T.right, 0, vw), btm = clamp(T.bottom, 0, vh);
    return mk(l, t, Math.max(0, rgt - l), Math.max(0, btm - t));
  }
  function sideOrder(pref, T, vw, vh){
    var opp = { top:'bottom', bottom:'top', left:'right', right:'left' };
    if(!opp[pref]){
      return [['bottom', vh - T.bottom], ['top', T.top], ['right', vw - T.right], ['left', T.left]]
        .sort(function(a, b){ return b[1] - a[1]; }).map(function(x){ return x[0]; });
    }
    var others = (pref === 'left' || pref === 'right') ? ['bottom','top'] : ['right','left'];
    return [pref, opp[pref]].concat(others);
  }

  // Would Fin sit on top of something clickable? (sampled at 5 points)
  var hitCache = null;
  function uiHits(f){
    var key = Math.round(f.left) + ',' + Math.round(f.top);
    if(hitCache && key in hitCache) return hitCache[key];
    var n = 0;
    if(document.elementsFromPoint){
      var pts = [[.5,.5],[.2,.2],[.8,.2],[.2,.8],[.8,.8]], vw = vpW(), vh = vpH();
      for(var i=0;i<pts.length;i++){
        var x = f.left + f.width*pts[i][0], y = f.top + f.height*pts[i][1];
        if(x < 0 || y < 0 || x >= vw || y >= vh) continue;
        var stack = document.elementsFromPoint(x, y);
        for(var j=0;j<stack.length;j++){
          var el = stack[j];
          if(el.closest && (el.closest('#fin-tour-root') || el.closest('#fin-pet-root'))) continue;
          if(el.closest && el.closest(INTERACTIVE)){ n++; break; }
        }
      }
    }
    if(hitCache) hitCache[key] = n;
    return n;
  }

  function layout(){
    var vw = vpW(), vh = vpH(), m = C.margin, ui = S.ui;
    var cw = Math.min(C.cardWidth, vw - 2*m);
    ui.card.style.width = cw + 'px';
    var ch = ui.card.offsetHeight;
    var T = targetBox();
    // placement should consider only the on-screen part of the target
    var Tv = mk(clamp(T.left,0,vw), clamp(T.top,0,vh), 1, 1);
    Tv = mk(Tv.left, Tv.top, Math.max(1, clamp(T.right,0,vw) - Tv.left), Math.max(1, clamp(T.bottom,0,vh) - Tv.top));

    var pref = (isNarrow() && S.step.mobilePlacement) || S.step.placement || 'auto';
    var order = sideOrder(pref, Tv, vw, vh);
    var cands = [];
    order.forEach(function(side, idx){
      var x, y, ok;
      if(side === 'right'){ x = Tv.right + C.gap; y = Tv.cy - ch/2; ok = x + cw <= vw - m; }
      else if(side === 'left'){ x = Tv.left - C.gap - cw; y = Tv.cy - ch/2; ok = x >= m; }
      else if(side === 'bottom'){ x = Tv.cx - cw/2; y = Tv.bottom + C.gap; ok = y + ch <= vh - m; }
      else { x = Tv.cx - cw/2; y = Tv.top - C.gap - ch; ok = y >= m; }
      x = clamp(x, m, vw - m - cw); y = clamp(y, m, vh - m - ch);
      if(ok) cands.push({ rect: mk(x, y, cw, ch), idx: idx, dock: false });
    });
    var dockX = clamp(Tv.cx - cw/2, m, vw - m - cw);
    var bottomLimit = isNarrow() ? C.bottomSafe : m;
    cands.push({ rect: mk(dockX, vh - bottomLimit - ch, cw, ch), idx: 4, dock: true });
    cands.push({ rect: mk(dockX, C.topSafe, cw, ch), idx: 4, dock: true });

    cands.forEach(function(c){
      c.pen = c.idx*110 + (c.dock ? 150 : 0) + overlapRatio(c.rect, Tv)*400;
    });

    var fin = petSize();
    var best = null;
    hitCache = {};
    if(fin){
      var ring = function(R, gap, kind, cardRect){
        var out = [], xs = [R.left, R.cx - fin.w/2, R.right - fin.w], ys = [R.top, R.cy - fin.h/2, R.bottom - fin.h];
        if(cardRect){   // also try hugging the bubble, so Fin and its bubble stay together
          xs.push(cardRect.left - 8 - fin.w, cardRect.right + 8);
          ys.push(cardRect.top - 8 - fin.h, cardRect.bottom + 8);
        }
        xs.forEach(function(x){
          x = clamp(x, m, vw - m - fin.w);
          out.push({ l:x, t:R.top - gap - fin.h, kind:kind });
          out.push({ l:x, t:R.bottom + gap, kind:kind });
        });
        ys.forEach(function(y){
          y = clamp(y, m, vh - m - fin.h);
          out.push({ l:R.left - gap - fin.w, t:y, kind:kind });
          out.push({ l:R.right + gap, t:y, kind:kind });
        });
        return out;
      };
      cands.forEach(function(c){
        var spots = ring(Tv, C.finGap, 'T', c.rect).concat(ring(c.rect, 8, 'C'));
        spots.forEach(function(s){
          var f = mk(s.l, s.t, fin.w, fin.h);
          if(f.left < m - 0.5 || f.top < m - 0.5 || f.right > vw - m + 0.5 || f.bottom > vh - m + 0.5) return;
          if(overlaps(f, Tv, 4) || overlaps(f, c.rect, 6)) return;
          var toCard = Math.hypot(Math.max(c.rect.left - f.right, 0, f.left - c.rect.right), Math.max(c.rect.top - f.bottom, 0, f.top - c.rect.bottom));
          var sc = c.pen + distToRect(f.cx, f.cy, Tv) + toCard*0.9 + (s.kind === 'T' ? 0 : 120) + uiHits(f)*90;
          if(!best || sc < best.score) best = { score: sc, card: c, fin: f };
        });
      });
    }
    var chosen, finRect = null;
    if(best){ chosen = best.card; finRect = best.fin; }
    else {
      cands.sort(function(a, b){ return a.pen - b.pen; });
      chosen = cands[0];
      if(fin){
        var corners = [[m,m],[vw-m-fin.w,m],[m,vh-m-fin.h],[vw-m-fin.w,vh-m-fin.h]], far = -1;
        corners.forEach(function(p){
          var d = Math.hypot(p[0] + fin.w/2 - chosen.rect.cx, p[1] + fin.h/2 - chosen.rect.cy);
          if(d > far){ far = d; finRect = mk(p[0], p[1], fin.w, fin.h); }
        });
      }
    }
    hitCache = null;
    return { hole: holeRect(), card: chosen.rect, fin: finRect, T: Tv };
  }

  function applyHole(H){
    var ui = S.ui, vw = vpW(), vh = vpH();
    var rad = 12;
    try{ rad = parseFloat(getComputedStyle(S.el).borderTopLeftRadius) || 0; }catch(e){}
    var pad = (S.step && S.step.padding != null) ? S.step.padding : C.padding;
    rad = Math.min(Math.max(10, rad + pad*0.6), Math.min(H.width, H.height)/2 || 10);
    var s = ui.spot.style;
    s.left = H.left + 'px'; s.top = H.top + 'px'; s.width = H.width + 'px'; s.height = H.height + 'px'; s.borderRadius = rad + 'px';
    var b = ui.blocks;
    function put(el, l, t, w, h){ var st = el.style; st.left = l+'px'; st.top = t+'px'; st.width = Math.max(0,w)+'px'; st.height = Math.max(0,h)+'px'; }
    put(b.t, 0, 0, vw, H.top);
    put(b.b, 0, H.bottom, vw, vh - H.bottom);
    put(b.l, 0, H.top, H.left, H.height);
    put(b.r, H.right, H.top, vw - H.right, H.height);
    put(ui.holeBlock, H.left, H.top, H.width, H.height);
  }
  function updateHole(){
    if(!S.active || !S.el || !S.ui) return;
    applyHole(holeRect());
  }

  function applyLayout(L){
    var ui = S.ui;
    applyHole(L.hole);
    // bubble
    ui.card.style.left = L.card.left + 'px';
    ui.card.style.top = L.card.top + 'px';
    // Fin
    if(L.fin && S.pet){
      S.pet.style.left = L.fin.left + 'px';
      S.pet.style.top = L.fin.top + 'px';
    }
    // tail: on the bubble edge that faces Fin
    var tail = ui.tail;
    if(L.fin){
      var C0 = L.card, fx = L.fin.cx, fy = L.fin.cy, side;
      if(fx < C0.left) side = 'left'; else if(fx > C0.right) side = 'right';
      else if(fy < C0.top) side = 'top'; else side = 'bottom';
      tail.setAttribute('data-side', side);
      if(side === 'left' || side === 'right'){
        tail.style.left = ''; tail.style.top = (clamp(fy - C0.top, 18, C0.height - 18) - 6) + 'px';
      } else {
        tail.style.top = ''; tail.style.left = (clamp(fx - C0.left, 18, C0.width - 18) - 6) + 'px';
      }
    } else tail.setAttribute('data-side', 'none');
    // arrow from Fin toward the target
    var pt = ui.pointer;
    if(L.fin){
      var T = L.T, cx = L.fin.cx, cy = L.fin.cy;
      var px = clamp(cx, T.left, T.right), py = clamp(cy, T.top, T.bottom);
      var dx = px - cx, dy = py - cy, len = Math.hypot(dx, dy);
      if(len > 1){
        var ux = dx/len, uy = dy/len, rad = Math.max(L.fin.width, L.fin.height)/2;
        var dist = Math.min(rad + 14, Math.max(rad, len - 14));
        pt.style.left = (cx + ux*dist) + 'px';
        pt.style.top = (cy + uy*dist) + 'px';
        ui.pointerSvg.style.transform = 'rotate(' + (Math.atan2(uy, ux)*180/Math.PI) + 'deg)';
        ui.pointerIn.style.setProperty('--ft-dx', (ux*6) + 'px');
        ui.pointerIn.style.setProperty('--ft-dy', (uy*6) + 'px');
        pt.classList.remove('ft-hidden');
      } else pt.classList.add('ft-hidden');
    } else pt.classList.add('ft-hidden');
  }

  function placeAll(){
    if(!S.active || !S.el || !S.ui) return;
    var L = layout();
    var r = S.el.getBoundingClientRect();
    S.sig = [r.left, r.top, r.width, r.height].map(Math.round).join(',');
    applyLayout(L);
  }

  /* ---------- reacting to scroll / resize / layout changes ---------- */
  var html = document.documentElement;
  function settle(){
    html.classList.remove('ft-instant');
    if(S.recheckScroll){
      // the window was resized/rotated: the target may now be off-screen, so bring it back into view
      S.recheckScroll = false;
      if(S.el && S.ui && ensureVisible(S.el, S.ui.card.offsetHeight)) return;   // scroll events re-settle afterwards
    }
    placeAll();
  }
  function onResize(e){ S.recheckScroll = true; onMove(e); }
  function onMove(e){
    if(!S.active || !S.ui) return;
    if(e && e.target && e.target.nodeType === 1 && S.ui.root.contains(e.target)) return;
    html.classList.add('ft-instant');
    cancelAnimationFrame(S.spotRAF);
    S.spotRAF = requestAnimationFrame(updateHole);
    clearTimeout(S.settleT);
    S.settleT = setTimeout(settle, 160);
  }
  function tick(){
    if(!S.active || !S.step || !S.ui) return;
    if(!S.el || !isVisible(S.el)){
      var el = findTarget(S.step);
      if(el){ S.el = el; S.missing = 0; placeAll(); }
      else if(++S.missing >= 8){ S.missing = 0; goTo(S.idx + S.dir, S.dir); }  // vanished for ~3s: skip it
      return;
    }
    S.missing = 0;
    var r = S.el.getBoundingClientRect();
    var sig = [r.left, r.top, r.width, r.height].map(Math.round).join(',');
    if(sig !== S.sig){ S.sig = sig; onMove(null); }
  }
  function onKey(e){
    if(!S.active) return;
    if(e.key === 'Escape'){
      e.preventDefault(); e.stopPropagation();
      stop('skipped');
      return;
    }
    var t = e.target;
    if(t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if(e.key === 'ArrowRight'){ e.preventDefault(); next(); }
    else if(e.key === 'ArrowLeft'){ e.preventDefault(); back(); }
  }
  function bind(){
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    window.addEventListener('scroll', onMove, true);
    if(window.visualViewport){
      window.visualViewport.addEventListener('resize', onResize);
      window.visualViewport.addEventListener('scroll', onMove);
    }
    document.addEventListener('keydown', onKey, true);
    S.tickT = setInterval(tick, 400);
  }
  function unbind(){
    window.removeEventListener('resize', onResize);
    window.removeEventListener('orientationchange', onResize);
    window.removeEventListener('scroll', onMove, true);
    if(window.visualViewport){
      window.visualViewport.removeEventListener('resize', onResize);
      window.visualViewport.removeEventListener('scroll', onMove);
    }
    document.removeEventListener('keydown', onKey, true);
    clearInterval(S.tickT);
    clearTimeout(S.settleT); clearTimeout(S.advT); clearTimeout(S.inT);
    cancelAnimationFrame(S.spotRAF);
    disarm();
    html.classList.remove('ft-instant', 'ft-snap');
  }

  /* ---------- required actions (click / input) ---------- */
  function arm(step, token){
    var a = step.action || 'next';
    if(a === 'click'){
      S.onClick = function(e){
        if(S.el && (S.el === e.target || S.el.contains(e.target))) afterAction(token);
      };
      document.addEventListener('click', S.onClick, true);
    } else if(a === 'input'){
      S.onInput = function(e){
        var t = e.target;
        if(!S.el || !(S.el === t || S.el.contains(t))) return;
        clearTimeout(S.inT);
        if(t.value && String(t.value).trim()) S.inT = setTimeout(function(){ afterAction(token, true); }, 900);
      };
      document.addEventListener('input', S.onInput, true);
    }
  }
  function disarm(){
    if(S.onClick){ document.removeEventListener('click', S.onClick, true); S.onClick = null; }
    if(S.onInput){ document.removeEventListener('input', S.onInput, true); S.onInput = null; }
  }
  function afterAction(token, immediate){
    clearTimeout(S.advT);
    S.advT = setTimeout(function(){
      if(token !== S.token || !S.active) return;
      petMood('happy', 1100);
      goTo(S.idx + 1, 1);
    }, immediate ? 0 : C.advanceDelay);   // let the app's own click handler run first
  }

  /* ---------- step flow ---------- */
  function goTo(i, dir){
    if(!S.active) return;
    dir = dir || 1;
    var token = ++S.token;
    disarm();
    clearTimeout(S.advT); clearTimeout(S.inT);
    if(i >= S.steps.length){ finish(); return; }
    if(i < 0) i = 0;
    var step = S.steps[i];
    S.idx = i; S.dir = dir; S.step = step;
    var changed = ensurePage(step);
    setTimeout(function(){
      waitForTarget(step, token, function(el){
        if(token !== S.token || !S.active) return;
        if(!el){                       // target missing: skip this step, never break the site
          var n = i + dir;
          if(n < 0) return goTo(i + 1, 1);
          if(n >= S.steps.length) return finish();
          return goTo(n, dir);
        }
        S.el = el; S.missing = 0;
        showStep(step, i, token);
      });
    }, changed ? 140 : 0);
  }

  function showStep(step, i, token){
    var ui = S.ui, first = !S.shown, total = S.steps.length, a = step.action || 'next';
    ui.stepno.textContent = 'Step ' + (i+1) + ' of ' + total;
    ui.fill.style.width = ((i+1)/total*100) + '%';
    ui.title.textContent = step.title || '';
    ui.desc.textContent = step.description || '';
    ui.hint.textContent = hintFor(step);
    ui.back.disabled = (i === 0);
    ui.next.textContent = (i === total - 1) ? 'Finish' : 'Next';
    ui.next.classList.toggle('fin-secondary', a !== 'next' && i !== total - 1);
    var interactive = step.interactive != null ? !!step.interactive : (a === 'click' || a === 'input');
    ui.holeBlock.classList.toggle('ft-on', !interactive);
    ui.spot.classList.toggle('ft-pulse', a === 'click' || a === 'input');

    ui.card.style.width = Math.min(C.cardWidth, vpW() - 2*C.margin) + 'px';
    var scrolled = ensureVisible(S.el, ui.card.offsetHeight);

    if(first){
      S.shown = true;
      // start with the whole screen "lit" and shrink onto the first target
      html.classList.add('ft-instant', 'ft-snap');
      var s = ui.spot.style;
      s.left = '0px'; s.top = '0px'; s.width = vpW() + 'px'; s.height = vpH() + 'px';
      void ui.spot.offsetWidth;
      html.classList.remove('ft-instant');
      ui.root.classList.add('ft-on');
      placeAll();
      var fixTransitions = function(){ html.classList.remove('ft-snap'); };
      if(window.requestAnimationFrame) requestAnimationFrame(function(){ requestAnimationFrame(fixTransitions); });
      else fixTransitions();
    } else if(!scrolled){
      placeAll();
    } else {
      // scrolling: the spotlight follows live, everything else settles after
      clearTimeout(S.settleT);
      S.settleT = setTimeout(settle, reduced() ? 60 : 620);
    }

    if(S.pet && !reduced()){
      try{ window.FinPet.setAnimation('walking'); }catch(e){}
      setTimeout(function(){ if(token === S.token && S.active) petMood('talking', 1200); }, 700);
    } else if(S.pet){
      petMood('talking', 1200);
    }
    arm(step, token);
    if(a !== 'input'){ try{ ui.card.focus({ preventScroll:true }); }catch(e){} }
  }

  function next(){
    if(!S.active) return;
    if(S.idx >= S.steps.length - 1){ finish(); return; }
    goTo(S.idx + 1, 1);
  }
  function back(){
    if(!S.active || S.idx <= 0) return;
    goTo(S.idx - 1, -1);
  }
  function finish(){ stop('done'); }

  function start(fromUser){
    if(S.active) return true;
    if(blocked()){
      if(fromUser && typeof window.toast === 'function'){
        try{ window.toast('Close the open window first, then start the tour again.', 'error'); }catch(e){}
      }
      return false;
    }
    var steps = (window.FinTourSteps || []).filter(function(st){
      if(!st) return false;
      var list = queryAll(st);
      for(var i=0;i<list.length;i++) if(potentiallyVisible(list[i])) return true;
      return false;
    });
    if(!steps.length) return false;
    S.steps = steps; S.idx = 0; S.dir = 1; S.shown = false; S.el = null; S.step = null; S.sig = '';
    S.active = true;
    build();
    petTakeover();
    bind();
    goTo(0, 1);
    return true;
  }

  function stop(reason){
    if(!S.active) return;
    S.active = false;
    S.token++;
    unbind();
    destroyUI();
    petRelease();
    S.el = null; S.step = null;
    if(reason === 'done' || reason === 'skipped') setState(reason);
    var P = window.FinPet;
    if(P && P.say){
      var text = reason === 'done'
        ? 'And that\u2019s the tour! Tap me for tips any time, or the ? button up top to replay it.'
        : 'No problem! You can restart the tour any time with the ? button up top.';
      setTimeout(function(){
        try{ P.say({ text: text, mood: reason === 'done' ? 'happy' : 'idle' }); }catch(e){}
      }, reduced() ? 100 : 850);
    }
  }

  /* ---------- Fin offers the tour ---------- */
  function offerNow(){
    var P = window.FinPet;
    if(!P || !P.say || S.active) return false;
    return P.say({
      text: 'Would you like me to show you around?',
      mood: 'happy',
      stayMs: 45000,
      actions: [
        { label: 'Yes, show me around', kind: 'custom', onClick: function(){ setTimeout(function(){ start(false); }, 200); } },
        { label: 'Maybe later', kind: 'custom', onClick: function(){ setState('later'); } },
        { label: 'Don\u2019t show this again', kind: 'custom', onClick: function(){
            setState('never');
            setTimeout(function(){
              try{ P.say({ text: 'Okay, I won\u2019t ask again. If you change your mind, the ? button up top starts the tour.' }); }catch(e){}
            }, 350);
          } }
      ]
    });
  }

  // Wait until the app is really ready (splash / PIN / dialogs closed and
  // quiet for a moment), then ask once per session.
  function scheduleOffer(){
    if(!eligible()) return;
    try{ if(sessionStorage.getItem(SS_OFFERED) === '1') return; }catch(e){}
    var tries = 0, quiet = 0;
    var iv = setInterval(function(){
      tries++;
      if(tries > C.offerMaxTries || S.active || !eligible()){ clearInterval(iv); return; }
      var root = document.getElementById('fin-pet-root');
      if(!root || !window.FinPet || !window.FinPet.say) return;      // Fin not ready yet
      if(root.classList.contains('fin-minimized') || root.classList.contains('fin-hidden')){ clearInterval(iv); return; }
      if(blocked() || document.visibilityState !== 'visible'){ quiet = 0; return; }
      if(++quiet < C.offerQuietChecks) return;
      clearInterval(iv);
      try{ sessionStorage.setItem(SS_OFFERED, '1'); }catch(e){}
      offerNow();
    }, C.offerCheckMs);
  }

  window.FinTour = {
    start: start,
    stop: function(){ stop('skipped'); },
    isActive: function(){ return S.active; },
    offer: offerNow,
    reset: function(){
      try{ localStorage.removeItem(LS_STATE); sessionStorage.removeItem(SS_OFFERED); }catch(e){}
    }
  };

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleOffer);
  else scheduleOffer();
})();

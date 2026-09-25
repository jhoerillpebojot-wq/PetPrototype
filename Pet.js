/* ============================================================
   FINUITY Virtual Pet — "Fin"
   Mounts a small interactive companion into the existing page
   and hooks into the app's own functions (show, toast, and the
   add-entry functions) rather than creating a parallel system.
   No fake pages, no separate navigation — every action button
   the pet shows calls a real function that already exists in
   index.html.

   Safe to remove: delete this file, virtual-pet/pet-dialogue.js,
   virtual-pet/pet.css, and their three tags in index.html.
   ============================================================ */
(function(){
  if(window.__finPetLoaded) return; // guard against double-init
  window.__finPetLoaded = true;

  var CFG = {
    MIN_GAP_MS: 25000,          // minimum gap between two auto-triggered bubbles
    MODULE_REPEAT_MS: 70000,    // don't repeat the same module's message sooner than this
    IDLE_NUDGE_MS: 5*60*1000,   // inactivity nudge after 5 min
    SLEEP_MS: 12*60*1000,       // falls asleep after 12 min of no interaction
    BUBBLE_MS: 9000,            // auto-hide plain messages
    BUBBLE_MS_ACTION: 15000     // auto-hide messages that have an action button
  };

  var LS_MIN = 'finPetMinimized';
  var LS_ONBOARDED = 'finPetOnboarded';

  var els = {};
  var pet = {
    mood: 'idle',
    lastAutoAt: 0,
    lastModuleMsgAt: {},
    lastModule: null,
    idleTimer: null,
    sleepTimer: null,
    bubbleHideTimer: null,
    moodRevertTimer: null,
    sleeping: false
  };

  function $(sel,ctx){ return (ctx||document).querySelector(sel); }

  /* ---------- build DOM ---------- */
  function buildDOM(){
    var root = document.createElement('div');
    root.id = 'fin-pet-root';
    root.innerHTML =
      '<div class="fin-bubble" id="fin-bubble" role="status" aria-live="polite">' +
        '<button class="fin-bubble-close" id="fin-bubble-close" aria-label="Dismiss">✕</button>' +
        '<div class="fin-bubble-text" id="fin-bubble-text"></div>' +
        '<div class="fin-bubble-actions" id="fin-bubble-actions"></div>' +
      '</div>' +
      '<div class="fin-avatar-wrap" id="fin-avatar-wrap" title="Fin" role="button" tabindex="0" aria-label="Open Fin, your assistant">' +
        '<button class="fin-min-btn" id="fin-min-btn" aria-label="Minimize Fin" title="Minimize">–</button>' +
        '<div class="fin-think-dots"><span></span><span></span><span></span></div>' +
        '<div class="fin-zzz">Zz</div>' +
        '<div class="fin-sparkle" id="fin-sparkle"></div>' +
        buildSVG() +
      '</div>' +
      '<div class="fin-min-tab" id="fin-min-tab"><span class="fin-min-dot"></span>Fin</div>';
    document.body.appendChild(root);

    els.root = root;
    els.bubble = $('#fin-bubble',root);
    els.bubbleText = $('#fin-bubble-text',root);
    els.bubbleActions = $('#fin-bubble-actions',root);
    els.bubbleClose = $('#fin-bubble-close',root);
    els.avatarWrap = $('#fin-avatar-wrap',root);
    els.minBtn = $('#fin-min-btn',root);
    els.minTab = $('#fin-min-tab',root);
    els.mouth = $('#fin-mouth',root);
    els.browL = $('#fin-brow-l',root);
    els.browR = $('#fin-brow-r',root);
    els.eyeL = $('#fin-eye-l',root);
    els.eyeR = $('#fin-eye-r',root);

    setMood('idle');

    // restore minimized preference
    if(localStorage.getItem(LS_MIN)==='1'){
      root.classList.add('fin-minimized');
    }

    els.bubbleClose.addEventListener('click', function(e){
      e.stopPropagation();
      hideBubble();
    });
    els.avatarWrap.addEventListener('click', onAvatarClick);
    els.avatarWrap.addEventListener('keydown', function(e){
      if(e.key==='Enter' || e.key===' '){ e.preventDefault(); onAvatarClick(); }
    });
    els.minBtn.addEventListener('click', function(e){
      e.stopPropagation();
      minimize(true);
    });
    els.minTab.addEventListener('click', function(){ minimize(false); });
  }

  function buildSVG(){
    // A small round companion, easy to swap for a sprite/GIF later —
    // just replace this function's return value with an <img> tag.
    return (
      '<svg class="fin-avatar-svg" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">' +
        '<ellipse class="fin-body" cx="50" cy="54" rx="38" ry="34"/>' +
        '<ellipse class="fin-body" cx="50" cy="20" rx="10" ry="10"/>' +
        '<ellipse class="fin-belly" cx="50" cy="60" rx="22" ry="18"/>' +
        '<ellipse class="fin-cheek" cx="26" cy="58" rx="6" ry="4"/>' +
        '<ellipse class="fin-cheek" cx="74" cy="58" rx="6" ry="4"/>' +
        '<path class="fin-brow" id="fin-brow-l" d="" />' +
        '<path class="fin-brow" id="fin-brow-r" d="" />' +
        '<ellipse class="fin-eye" id="fin-eye-l" cx="38" cy="50" rx="4.4" ry="5.6"/>' +
        '<ellipse class="fin-eye" id="fin-eye-r" cx="62" cy="50" rx="4.4" ry="5.6"/>' +
        '<path class="fin-mouth" id="fin-mouth" d="M42 66 Q50 71 58 66" />' +
      '</svg>'
    );
  }

  /* ---------- mood / expression ---------- */
  var MOUTHS = {
    idle:      'M42 66 Q50 71 58 66',
    talking:   'M42 66 Q50 71 58 66',
    happy:     'M40 64 Q50 76 60 64',
    thinking:  'M43 68 Q50 68 57 68',
    concerned: 'M42 70 Q50 64 58 70',
    sleeping:  'M44 67 Q50 69 56 67'
  };
  var BROWS = {
    concerned: { l:'M32 40 Q38 44 44 41', r:'M56 41 Q62 44 68 40' },
    thinking:  { l:'M32 41 Q38 39 44 41', r:'M56 41 Q62 39 68 41' }
  };

  function setMood(mood, autoRevertMs){
    clearTimeout(pet.moodRevertTimer);
    pet.mood = mood;
    els.root.className = els.root.className.replace(/\bfin-state-\S+/g,'').trim();
    els.root.classList.add('fin-state-'+mood);
    if(els.mouth) els.mouth.setAttribute('d', MOUTHS[mood]||MOUTHS.idle);
    var brow = BROWS[mood];
    if(els.browL) els.browL.setAttribute('d', brow ? brow.l : '');
    if(els.browR) els.browR.setAttribute('d', brow ? brow.r : '');
    if(els.eyeL && els.eyeR){
      if(mood==='sleeping'){
        els.eyeL.setAttribute('ry','1'); els.eyeR.setAttribute('ry','1');
      } else {
        els.eyeL.setAttribute('ry','5.6'); els.eyeR.setAttribute('ry','5.6');
      }
    }
    if(autoRevertMs){
      pet.moodRevertTimer = setTimeout(function(){ setMood('idle'); }, autoRevertMs);
    }
  }

  /* ---------- bubble ---------- */
  function showBubble(msg, opts){
    opts = opts||{};
    clearTimeout(pet.bubbleHideTimer);
    if(els.root.classList.contains('fin-minimized')){
      // Still register that something happened; don't force it open on
      // the user, just make the minimized tab pulse briefly via the dot.
      return;
    }
    els.bubbleText.textContent = msg.text;
    els.bubbleActions.innerHTML = '';
    if(msg.actionText){
      var btn = document.createElement('button');
      btn.className = 'fin-bubble-btn';
      btn.textContent = msg.actionText;
      btn.addEventListener('click', function(){
        hideBubble();
        runAction(msg);
      });
      els.bubbleActions.appendChild(btn);
    }
    els.bubble.classList.add('fin-show');

    // brief talking flourish, then settle into the message's mood (or idle)
    var settleMood = msg.mood || 'idle';
    setMood('talking');
    setTimeout(function(){ setMood(settleMood); }, 420);

    var hideAfter = msg.actionText ? CFG.BUBBLE_MS_ACTION : CFG.BUBBLE_MS;
    pet.bubbleHideTimer = setTimeout(hideBubble, hideAfter);
  }

  function hideBubble(){
    clearTimeout(pet.bubbleHideTimer);
    els.bubble.classList.remove('fin-show');
  }

  function runAction(msg){
    if(msg.actionModule && typeof window.show==='function'){
      window.show(msg.actionModule);
      if(msg.actionFocus) focusSoon(msg.actionFocus, 80);
    } else if(msg.actionFocus){
      // already on the right module — just point at the field
      focusSoon(msg.actionFocus, 0);
    } else if(typeof msg.action === 'function'){
      msg.action();
    }
  }

  function focusSoon(id, delay){
    setTimeout(function(){
      var el = document.getElementById(id);
      if(el){ el.focus(); el.scrollIntoView({behavior:'smooth', block:'center'}); }
    }, delay);
  }

  /* ---------- interaction ---------- */
  function onAvatarClick(){
    resetIdle();
    if(pet.sleeping){ wake(); return; }
    var ctx = safeCtx();
    var line = window.FinPetDialogue.getClickLine(ctx);
    showBubble(line);
  }

  function minimize(on){
    els.root.classList.toggle('fin-minimized', on);
    localStorage.setItem(LS_MIN, on?'1':'0');
    if(!on) resetIdle();
  }

  function safeCtx(){
    try{ return window.FinPetDialogue.buildContext(); } catch(e){ return {}; }
  }

  /* ---------- auto messages (module enter) ---------- */
  function canShowAuto(moduleKey){
    var now = Date.now();
    if(now - pet.lastAutoAt < CFG.MIN_GAP_MS) return false;
    if(moduleKey){
      var last = pet.lastModuleMsgAt[moduleKey]||0;
      if(now - last < CFG.MODULE_REPEAT_MS) return false;
    }
    return true;
  }

  function markShown(moduleKey){
    pet.lastAutoAt = Date.now();
    if(moduleKey) pet.lastModuleMsgAt[moduleKey] = Date.now();
  }

  function onModuleEnter(moduleId){
    resetIdle();
    if(moduleId === pet.lastModule) {
      // re-navigating to the same module the user is already on — don't
      // pester them with the same thing again unless enough time passed
    }
    pet.lastModule = moduleId;
    if(!canShowAuto(moduleId)) return;
    var ctx = safeCtx();
    var msg = window.FinPetDialogue.getModuleMessage(moduleId, ctx);
    if(!msg) return;
    markShown(moduleId);
    showBubble(msg);
  }

  /* ---------- idle / sleep ---------- */
  function resetIdle(){
    pet.sleeping = false;
    clearTimeout(pet.idleTimer);
    clearTimeout(pet.sleepTimer);
    pet.idleTimer = setTimeout(function(){
      if(document.visibilityState!=='visible') return;
      var ctx = safeCtx();
      showBubble(window.FinPetDialogue.getIdleNudge(ctx));
    }, CFG.IDLE_NUDGE_MS);
    pet.sleepTimer = setTimeout(fallAsleep, CFG.SLEEP_MS);
  }

  function fallAsleep(){
    pet.sleeping = true;
    hideBubble();
    setMood('sleeping');
  }

  function wake(){
    pet.sleeping = false;
    var line = window.FinPetDialogue.getWakeLine();
    showBubble(line);
    resetIdle();
  }

  function wireActivityListeners(){
    ['mousemove','keydown','touchstart','scroll'].forEach(function(evt){
      document.addEventListener(evt, function(){
        if(pet.sleeping){ wake(); }
        else { resetIdle(); }
      }, {passive:true});
    });
    document.addEventListener('visibilitychange', function(){
      if(document.visibilityState==='visible') resetIdle();
    });
  }

  /* ---------- hook the host app's real functions ---------- */
  function hookApp(){
    if(typeof window.show === 'function' && !window.show.__finWrapped){
      var origShow = window.show;
      var wrapped = function(id){
        origShow(id);
        try{ onModuleEnter(id); }catch(e){}
      };
      wrapped.__finWrapped = true;
      window.show = wrapped;
    }

    if(typeof window.toast === 'function' && !window.toast.__finWrapped){
      var origToast = window.toast;
      var wrapped2 = function(msg,type){
        origToast(msg,type);
        try{
          if(type==='error'){
            setMood('concerned', 1600);
          } else if(Date.now()-pet.lastAutoAt > CFG.MIN_GAP_MS){
            setMood('happy', 1400);
          }
        }catch(e){}
      };
      wrapped2.__finWrapped = true;
      window.toast = wrapped2;
    }

    if(typeof window.closeSplash === 'function' && !window.closeSplash.__finWrapped){
      var origClose = window.closeSplash;
      var wrapped3 = function(){
        origClose();
        setTimeout(runFirstAppearance, 700);
      };
      wrapped3.__finWrapped = true;
      window.closeSplash = wrapped3;
    }
  }

  function runFirstAppearance(){
    var ctx = safeCtx();
    if(!localStorage.getItem(LS_ONBOARDED)){
      localStorage.setItem(LS_ONBOARDED,'1');
      showBubble({
        text: "Hi, I'm Fin! I'll hang around and point things out as you go — nothing you need to set up.",
        actionText: 'Got it'
      });
      markShown('dashboard');
    } else {
      onModuleEnter('dashboard');
    }
  }

  /* ---------- init ---------- */
  function init(){
    buildDOM();
    hookApp();
    wireActivityListeners();
    resetIdle();
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
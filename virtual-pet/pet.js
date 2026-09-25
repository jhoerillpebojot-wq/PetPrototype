/* ============================================================
   FINUITY Virtual Pet — "Fin"
   Mounts a small interactive companion into the existing page
   and hooks into the app's own functions (show, toast, addGoal,
   addToGoal, and the add-entry functions) rather than creating
   a parallel system. No fake pages, no separate navigation —
   every action button the pet shows calls a real function that
   already exists in index.html.

   Fin can now: give contextual tips on module entry; open a
   menu on click with a quick financial tip, a "how am I doing"
   check-in (with a spending-pace projection), a glossary term,
   or small talk; celebrate goals reached / loans settled; flag
   a real-time budget-threshold crossing the moment an expense
   is logged; flag loans due soon (not just overdue); offer a
   weekly recap on the first visit of a new week; nudge on
   savings goals that haven't been touched in a while; walk a
   brand-new user through each module the first time they visit
   it; and expose a small settings menu (speak-up frequency,
   per-category muting, a rename, and a tone toggle).

   Plus: a slow-moving color cue tied to the trailing 3-month
   savings rate, not any single day (see pet.css fin-trend-*);
   a small persistent badge shelf on the avatar for real
   milestones (streaks, a paid-off loan, a reached goal, a
   personal-best savings month); data-pattern insights spotted
   directly in transaction history (a category dominating the
   same weekday, the same top category three months running, a
   same-month-last-year spike) surfaced roughly weekly; personal
   bests compared only against the person's own past, never
   anyone else's; a local "Ask Fin" quick-query (spending by
   category, next loan due, budget left, streak) answered
   entirely from on-device state, no network call, via an inline
   text field in the bubble (not window.prompt, which is
   unreliable once this is installed as a standalone PWA); a
   one-time note after onboarding that everything Fin looks at
   stays on this device; and drag-to-reposition, so Fin can be
   picked up and parked anywhere on screen, with the spot
   remembered across sessions.

   Safe to remove: delete this file, virtual-pet/pet-dialogue.js,
   virtual-pet/pet.css, and their three tags in index.html.
   ============================================================ */
(function(){
  if(window.__finPetLoaded) return; // guard against double-init
  window.__finPetLoaded = true;

  var BASE_CFG = {
    MIN_GAP_MS: 25000,          // minimum gap between two auto-triggered bubbles
    MODULE_REPEAT_MS: 70000,    // don't repeat the same module's message sooner than this
    IDLE_NUDGE_MS: 5*60*1000,   // inactivity nudge after 5 min
    SLEEP_MS: 12*60*1000,       // falls asleep after 12 min of no interaction
    BUBBLE_MS: 9000,            // auto-hide plain messages
    BUBBLE_MS_ACTION: 15000     // auto-hide messages that have action button(s)
  };
  var CFG = Object.assign({}, BASE_CFG);

  var LS_MIN = 'finPetMinimized';
  var LS_ONBOARDED = 'finPetOnboarded';
  var LS_ONBOARD_STEPS = 'finPetOnboardSteps';    // module ids already walked through
  var LS_STREAK = 'finPetStreakMilestones';
  var LS_POSTACTION = 'finPetPostActionShown';    // one-time "what to do next" tips, keyed by dialogue.js's msg.key
  var LS_BUDGET_ALERT = 'finPetBudgetAlert';      // {month:'YYYY-M', levels:[75,100]}
  var LS_WEEKLY_RECAP = 'finPetWeeklyRecap';      // last week-key a recap was shown for
  var LS_GOAL_PROGRESS = 'finPetGoalProgress';    // {goalId: lastTouchedAtMs}
  var LS_GOAL_NUDGED = 'finPetGoalNudged';        // {goalId: lastNudgedAtMs}
  var LS_SETTINGS = 'finPetSettings';
  var LS_BADGES = 'finPetBadges';                 // string[] of earned badge ids
  var LS_BESTS = 'finPetBests';                   // {bestSavingsRatePct, longestStreakEver}
  var LS_PATTERN_LAST = 'finPetPatternInsightAt';  // ms timestamp of last pattern insight shown
  var LS_PRIVACY_SHOWN = 'finPetPrivacyShown';

  var PATTERN_INSIGHT_COOLDOWN_MS = 6*24*60*60*1000; // don't repeat data-pattern insights more than ~weekly

  var STALE_GOAL_DAYS = 14;
  var GOAL_RENUDGE_MS = 14*24*60*60*1000;

  var DEFAULT_SETTINGS = { frequency:'normal', muteTips:false, muteBudget:false, muteInsights:false, name:'Fin', tone:'playful' };

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
    sleeping: false,
    shownTips: new Set(),   // session memory so "Another tip" doesn't repeat immediately
    shownTerms: new Set()
  };

  function $(sel,ctx){ return (ctx||document).querySelector(sel); }

  /* ---------- settings (persisted preferences) ---------- */
  function getSettings(){
    try{
      var saved = JSON.parse(localStorage.getItem(LS_SETTINGS)||'{}');
      return Object.assign({}, DEFAULT_SETTINGS, saved);
    }catch(e){ return Object.assign({}, DEFAULT_SETTINGS); }
  }
  function saveSettings(s){
    try{ localStorage.setItem(LS_SETTINGS, JSON.stringify(s)); }catch(e){}
  }
  function toggleSetting(key){
    var s = getSettings();
    s[key] = !s[key];
    saveSettings(s);
    return s;
  }
  function cycleFrequency(){
    var s = getSettings();
    var order = ['quiet','normal','chatty'];
    var idx = order.indexOf(s.frequency);
    s.frequency = order[(idx+1)%order.length];
    saveSettings(s);
    applyFrequency(s);
    return s;
  }
  function cycleTone(){
    var s = getSettings();
    s.tone = s.tone==='businesslike' ? 'playful' : 'businesslike';
    saveSettings(s);
    return s;
  }
  function applyFrequency(s){
    s = s || getSettings();
    var mult = s.frequency==='quiet' ? 2.5 : s.frequency==='chatty' ? 0.5 : 1;
    CFG.IDLE_NUDGE_MS = Math.round(BASE_CFG.IDLE_NUDGE_MS * mult);
    CFG.MODULE_REPEAT_MS = Math.round(BASE_CFG.MODULE_REPEAT_MS * mult);
  }
  function applyName(name){
    name = (name||'Fin').trim() || 'Fin';
    if(els.avatarWrap){
      els.avatarWrap.title = name;
      els.avatarWrap.setAttribute('aria-label', 'Open '+name+', your assistant');
    }
    if(els.minName) els.minName.textContent = name;
  }

  /* ---------- build DOM ---------- */
  function buildDOM(){
    var root = document.createElement('div');
    root.id = 'fin-pet-root';
    root.innerHTML =
      '<div class="fin-bubble" id="fin-bubble" role="status" aria-live="polite">' +
        '<button class="fin-bubble-close" id="fin-bubble-close" aria-label="Dismiss">✕</button>' +
        '<div class="fin-bubble-text" id="fin-bubble-text"></div>' +
        '<div class="fin-bubble-actions" id="fin-bubble-actions"></div>' +
        '<div class="fin-input-row" id="fin-input-row">' +
          '<input type="text" class="fin-input-field" id="fin-input-field" autocomplete="off" />' +
          '<button class="fin-bubble-btn" id="fin-input-send">Send</button>' +
        '</div>' +
      '</div>' +
      '<div class="fin-avatar-wrap" id="fin-avatar-wrap" title="Fin" role="button" tabindex="0" aria-label="Open Fin, your assistant">' +
        '<button class="fin-min-btn" id="fin-min-btn" aria-label="Minimize Fin" title="Minimize">–</button>' +
        '<div class="fin-badge-shelf" id="fin-badge-shelf"></div>' +
        '<div class="fin-think-dots"><span></span><span></span><span></span></div>' +
        '<div class="fin-zzz">Zz</div>' +
        '<div class="fin-sparkle" id="fin-sparkle"></div>' +
        buildSVG() +
      '</div>' +
      '<div class="fin-min-tab" id="fin-min-tab"><span class="fin-min-dot"></span><span id="fin-min-name">Fin</span></div>';
    document.body.appendChild(root);

    els.root = root;
    els.bubble = $('#fin-bubble',root);
    els.bubbleText = $('#fin-bubble-text',root);
    els.bubbleActions = $('#fin-bubble-actions',root);
    els.bubbleClose = $('#fin-bubble-close',root);
    els.inputRow = $('#fin-input-row',root);
    els.inputField = $('#fin-input-field',root);
    els.inputSend = $('#fin-input-send',root);
    els.avatarWrap = $('#fin-avatar-wrap',root);
    els.minBtn = $('#fin-min-btn',root);
    els.minTab = $('#fin-min-tab',root);
    els.minName = $('#fin-min-name',root);
    els.mouth = $('#fin-mouth',root);
    els.browL = $('#fin-brow-l',root);
    els.browR = $('#fin-brow-r',root);
    els.eyeL = $('#fin-eye-l',root);
    els.eyeR = $('#fin-eye-r',root);
    els.badgeShelf = $('#fin-badge-shelf',root);

    setMood('idle');
    applyName(getSettings().name);
    renderBadgeShelf();

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
    els.inputSend.addEventListener('click', function(e){ e.stopPropagation(); submitInlineInput(); });
    els.inputField.addEventListener('click', function(e){ e.stopPropagation(); });
    els.inputField.addEventListener('keydown', function(e){
      if(e.key==='Enter'){ e.preventDefault(); submitInlineInput(); }
    });
    wireDrag();
    applySavedPosition();
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
  // A message is {text, mood?, actions?} where actions is a list of
  // {label, kind, module?, focus?}. For backward compatibility, the older
  // {text, actionText, actionModule, actionFocus} shape (still used by the
  // per-module messages in pet-dialogue.js) is normalized into that same
  // actions list.
  function normalizeActions(msg){
    if(Array.isArray(msg.actions)) return msg.actions;
    if(msg.actionText) return [{ label: msg.actionText, kind:'navigate', module: msg.actionModule, focus: msg.actionFocus }];
    return [];
  }

  function showBubble(msg){
    if(!msg) return;
    clearTimeout(pet.bubbleHideTimer);
    if(els.root.classList.contains('fin-minimized')){
      // Still register that something happened; don't force it open on
      // the user, just leave it for next time they open the tab.
      return;
    }
    hideInlineInput();
    els.bubbleText.textContent = msg.text;
    els.bubbleActions.innerHTML = '';

    var actionList = normalizeActions(msg);
    actionList.forEach(function(action, i){
      var btn = document.createElement('button');
      btn.className = 'fin-bubble-btn' + (i>0 ? ' fin-secondary' : '');
      btn.textContent = action.label;
      btn.addEventListener('click', function(){
        hideBubble();
        runAction(action);
      });
      els.bubbleActions.appendChild(btn);
    });

    els.bubble.classList.add('fin-show');

    // brief talking flourish, then settle into the message's mood (or idle)
    var settleMood = msg.mood || 'idle';
    setMood('talking');
    setTimeout(function(){ setMood(settleMood); }, 420);

    var hideAfter = actionList.length ? CFG.BUBBLE_MS_ACTION : CFG.BUBBLE_MS;
    pet.bubbleHideTimer = setTimeout(hideBubble, hideAfter);
  }

  function hideBubble(){
    clearTimeout(pet.bubbleHideTimer);
    els.bubble.classList.remove('fin-show');
    hideInlineInput();
  }

  // Inline text-entry inside the bubble itself, used instead of
  // window.prompt() — prompt()/alert()/confirm() are unreliable (often
  // silently do nothing) once FINUITY is installed as a standalone PWA,
  // since there's no browser chrome to host the native dialog.
  function showInlineInput(promptText, placeholder, onSubmit){
    clearTimeout(pet.bubbleHideTimer);
    if(els.root.classList.contains('fin-minimized')) return;
    els.bubbleText.textContent = promptText;
    els.bubbleActions.innerHTML = '';
    els.inputField.value = '';
    els.inputField.placeholder = placeholder || '';
    els.bubble.classList.add('fin-show');
    els.inputRow.classList.add('fin-show');
    pet._inputSubmit = onSubmit;
    setMood('thinking');
    setTimeout(function(){ els.inputField.focus(); }, 60);
  }

  function hideInlineInput(){
    if(els.inputRow) els.inputRow.classList.remove('fin-show');
  }

  function submitInlineInput(){
    var val = els.inputField.value;
    var cb = pet._inputSubmit;
    pet._inputSubmit = null;
    hideInlineInput();
    if(cb) cb(val);
  }

  function runAction(action){
    var dlg = window.FinPetDialogue;
    if(!action || !dlg) return;
    switch(action.kind){
      case 'navigate':
        if(action.module && typeof window.show==='function'){
          window.show(action.module);
          if(action.focus) focusSoon(action.focus, 80);
        } else if(action.focus){
          focusSoon(action.focus, 0);
        }
        break;
      case 'menu':
        showBubble(dlg.getMenuMessage(safeCtx(), getSettings().tone));
        break;
      case 'next':
        setMood('thinking');
        setTimeout(function(){ showBubble(dlg.getNextActionMessage(safeCtx())); }, 280);
        break;
      case 'tip':
        setMood('thinking');
        setTimeout(function(){ showBubble(dlg.getTipMessage(pet.shownTips, safeCtx())); }, 280);
        break;
      case 'glossary':
        setMood('thinking');
        setTimeout(function(){ showBubble(dlg.getGlossaryMessage(pet.shownTerms, safeCtx())); }, 280);
        break;
      case 'health':
        setMood('thinking');
        setTimeout(function(){ showBubble(dlg.getHealthMessage(enrichedCtx())); }, 280);
        break;
      case 'smalltalk':
        showBubble(dlg.getSmallTalkMessage(safeCtx(), getSettings().tone));
        break;
      case 'settings':
        showBubble(dlg.getSettingsMessage(getSettings()));
        break;
      case 'settings-notifications':
        showBubble(dlg.getSettingsNotificationsMessage(getSettings()));
        break;
      case 'settings-personalize':
        showBubble(dlg.getSettingsPersonalizeMessage(getSettings()));
        break;
      case 'settings-frequency':
        showBubble(dlg.getSettingsNotificationsMessage(cycleFrequency()));
        break;
      case 'settings-toggle-tips':
        showBubble(dlg.getSettingsNotificationsMessage(toggleSetting('muteTips')));
        break;
      case 'settings-toggle-budget':
        showBubble(dlg.getSettingsNotificationsMessage(toggleSetting('muteBudget')));
        break;
      case 'settings-toggle-insights':
        showBubble(dlg.getSettingsNotificationsMessage(toggleSetting('muteInsights')));
        break;
      case 'settings-toggle-tone':
        showBubble(dlg.getSettingsPersonalizeMessage(cycleTone()));
        break;
      case 'settings-rename':
        renamePet();
        break;
      case 'badges':
        showBubble(dlg.getBadgesMessage(getBadges()));
        break;
      case 'privacy':
        showBubble(dlg.getPrivacyMessage());
        break;
      case 'ask-menu':
        showBubble(dlg.getAskMenuMessage());
        break;
      case 'ask':
        setMood('thinking');
        setTimeout(function(){ showBubble(dlg.answerQuestion(action.query||'', enrichedCtx())); }, 260);
        break;
      case 'ask-custom':
        showInlineInput("What do you want to know?", "e.g. how much on food this month", function(val){
          setMood('thinking');
          setTimeout(function(){ showBubble(dlg.answerQuestion(val, enrichedCtx())); }, 260);
        });
        break;
      case 'dismiss':
      default:
        break;
    }
  }

  function renamePet(){
    var current = getSettings().name || 'Fin';
    showInlineInput("What should I call myself?", current, function(val){
      if(val && val.trim()){
        var s = getSettings();
        s.name = val.trim().slice(0,20);
        saveSettings(s);
        applyName(s.name);
      }
      showBubble(window.FinPetDialogue.getSettingsPersonalizeMessage(getSettings()));
    });
  }

  function focusSoon(id, delay){
    setTimeout(function(){
      var el = document.getElementById(id);
      if(el){ el.focus(); el.scrollIntoView({behavior:'smooth', block:'center'}); }
    }, delay);
  }

  /* ---------- interaction ---------- */
  function onAvatarClick(){
    if(pet.suppressClick){ pet.suppressClick = false; return; }
    resetIdle();
    if(pet.sleeping){ wake(); return; }
    showBubble(window.FinPetDialogue.getMenuMessage(safeCtx(), getSettings().tone));
  }

  function minimize(on){
    els.root.classList.toggle('fin-minimized', on);
    localStorage.setItem(LS_MIN, on?'1':'0');
    if(!on) resetIdle();
  }

  /* ---------- drag-to-reposition ----------
     Lets Fin be picked up and moved anywhere on screen, like an actual
     desk pet rather than a fixed corner widget. Position is saved so it
     sticks across sessions. Dragging the avatar moves the whole root
     (avatar + bubble + minimized tab together) so the bubble still
     appears right next to Fin wherever it's parked. */
  var LS_POS = 'finPetPos';
  var drag = { active:false, moved:false, pointerId:null, startX:0, startY:0, startLeft:0, startTop:0 };

  function clampAndApplyPosition(x, y){
    var r = els.root.getBoundingClientRect();
    var w = r.width || 80, h = r.height || 80;
    var maxX = Math.max(4, window.innerWidth - w - 4);
    var maxY = Math.max(4, window.innerHeight - h - 4);
    x = Math.max(4, Math.min(x, maxX));
    y = Math.max(4, Math.min(y, maxY));
    els.root.style.left = x+'px';
    els.root.style.top = y+'px';
    els.root.style.right = 'auto';
    els.root.style.bottom = 'auto';
    return {x:x, y:y};
  }

  function applySavedPosition(){
    var pos = null;
    try{ pos = JSON.parse(localStorage.getItem(LS_POS)||'null'); }catch(e){}
    if(pos && typeof pos.x==='number' && typeof pos.y==='number'){
      clampAndApplyPosition(pos.x, pos.y);
    }
  }

  function wireDrag(){
    els.avatarWrap.style.touchAction = 'none';
    els.avatarWrap.addEventListener('pointerdown', function(e){
      if(e.button!==undefined && e.button!==0 && e.pointerType==='mouse') return;
      drag.active = true; drag.moved = false; drag.pointerId = e.pointerId;
      var r = els.root.getBoundingClientRect();
      drag.startLeft = r.left; drag.startTop = r.top;
      drag.startX = e.clientX; drag.startY = e.clientY;
      try{ els.avatarWrap.setPointerCapture(e.pointerId); }catch(err){}
    });
    els.avatarWrap.addEventListener('pointermove', function(e){
      if(!drag.active || e.pointerId!==drag.pointerId) return;
      var dx = e.clientX-drag.startX, dy = e.clientY-drag.startY;
      if(!drag.moved && (Math.abs(dx)>6 || Math.abs(dy)>6)){
        drag.moved = true;
        els.root.classList.add('fin-dragging');
      }
      if(drag.moved){
        e.preventDefault();
        clampAndApplyPosition(drag.startLeft+dx, drag.startTop+dy);
      }
    });
    function endDrag(e){
      if(!drag.active || (e && e.pointerId!==drag.pointerId)) return;
      drag.active = false;
      els.root.classList.remove('fin-dragging');
      if(drag.moved){
        var r = els.root.getBoundingClientRect();
        try{ localStorage.setItem(LS_POS, JSON.stringify({x:r.left, y:r.top})); }catch(err){}
        pet.suppressClick = true; // this was a drag, not a tap — swallow the click that follows
      }
    }
    els.avatarWrap.addEventListener('pointerup', endDrag);
    els.avatarWrap.addEventListener('pointercancel', endDrag);
    window.addEventListener('resize', function(){
      if(els.root.style.left){
        var r = els.root.getBoundingClientRect();
        clampAndApplyPosition(r.left, r.top);
      }
    });
  }

  function safeCtx(){
    try{ return window.FinPetDialogue.buildContext(); } catch(e){ return {}; }
  }

  // Merges the pure, state-derived context with the bits only pet.js
  // tracks (personal bests, earned badges) so dialogue.js's formatters can
  // reference them without owning any persistence themselves.
  function enrichedCtx(){
    var ctx = safeCtx();
    var bests = getBests();
    ctx.bestSavingsRatePct = bests.bestSavingsRatePct;
    ctx.longestStreakEver = bests.longestStreakEver || 0;
    ctx.catTotals = ctx.catTotals || {};
    return ctx;
  }

  /* ---------- badges (persistent milestone shelf) ---------- */
  function getBadges(){
    try{ return JSON.parse(localStorage.getItem(LS_BADGES)||'[]'); }catch(e){ return []; }
  }
  function awardBadge(id){
    try{
      var list = getBadges();
      if(list.indexOf(id)===-1){
        list.push(id);
        localStorage.setItem(LS_BADGES, JSON.stringify(list));
        renderBadgeShelf();
        return true; // newly earned
      }
    }catch(e){}
    return false;
  }
  function renderBadgeShelf(){
    if(!els.badgeShelf) return;
    var dlg = window.FinPetDialogue;
    var defs = (dlg && dlg.BADGE_DEFS) || {};
    var earned = getBadges();
    els.badgeShelf.innerHTML = '';
    earned.forEach(function(id){
      var def = defs[id];
      if(!def) return;
      var span = document.createElement('span');
      span.className = 'fin-badge-dot';
      span.textContent = def.icon;
      span.title = def.label;
      els.badgeShelf.appendChild(span);
    });
  }

  /* ---------- personal bests (compare-to-self, never to others) ---------- */
  function getBests(){
    try{ return Object.assign({bestSavingsRatePct:null, longestStreakEver:0}, JSON.parse(localStorage.getItem(LS_BESTS)||'{}')); }catch(e){ return {bestSavingsRatePct:null, longestStreakEver:0}; }
  }
  function saveBests(b){
    try{ localStorage.setItem(LS_BESTS, JSON.stringify(b)); }catch(e){}
  }

  // Checked on dashboard visits and after a streak-milestone update. Only
  // ever compares the person's own history to itself, and only celebrates
  // a genuine new record (not the very first data point, and not trivially
  // small streaks/rates) to keep it meaningful rather than constant noise.
  function checkPersonalBests(ctx){
    var b = getBests();
    var newKind = null, newValue = null;

    if(ctx.savingsRatePct!==null && ctx.savingsRatePct>=10){
      if(b.bestSavingsRatePct===null){
        b.bestSavingsRatePct = ctx.savingsRatePct;
      } else if(ctx.savingsRatePct>b.bestSavingsRatePct){
        b.bestSavingsRatePct = ctx.savingsRatePct;
        newKind = 'savings'; newValue = ctx.savingsRatePct;
      }
    }
    if(ctx.streakDays>=3 && ctx.streakDays>(b.longestStreakEver||0)){
      var wasSet = (b.longestStreakEver||0)>0;
      b.longestStreakEver = ctx.streakDays;
      if(wasSet){ newKind = newKind || 'streak'; newValue = newValue===null ? ctx.streakDays : newValue; }
    }
    saveBests(b);

    if(newKind && canShowAuto('milestone')){
      if(newKind==='savings') awardBadge('best-saver');
      markShown('milestone');
      var msg = window.FinPetDialogue.getNewBestCelebration(newKind, newValue);
      if(msg) setTimeout(function(){ showBubble(msg); }, 1000);
    }
  }

  /* ---------- data-pattern insights (weekday concentration, category
     streaks, same-time-last-year spikes) — spaced out to roughly weekly
     so they read as genuine observations, not constant chatter. ---------- */
  function checkPatternInsight(){
    if(getSettings().muteInsights) return;
    var last = 0;
    try{ last = parseInt(localStorage.getItem(LS_PATTERN_LAST)||'0',10) || 0; }catch(e){}
    if(Date.now()-last < PATTERN_INSIGHT_COOLDOWN_MS) return;
    if(!canShowAuto('milestone')) return;
    var msg = safe(function(){ return window.FinPetDialogue.getPatternInsight(); }, null);
    if(!msg) return;
    try{ localStorage.setItem(LS_PATTERN_LAST, String(Date.now())); }catch(e){}
    markShown('milestone');
    setTimeout(function(){ showBubble(msg); }, 1200);
  }

  /* ---------- visual trend cue ----------
     A subtle, lasting cue (not a toast) tied to the trailing 3-month
     savings rate rather than any single day — see pet.css for what each
     class actually looks like. */
  function applyTrendClass(ctx){
    if(!els.root) return;
    els.root.className = els.root.className.replace(/\bfin-trend-\S+/g,'').trim();
    if(ctx.trendClass) els.root.classList.add('fin-trend-'+ctx.trendClass);
  }

  /* ---------- auto messages (module enter) ---------- */
  function canShowAuto(key){
    var now = Date.now();
    if(now - pet.lastAutoAt < CFG.MIN_GAP_MS) return false;
    if(key){
      var last = pet.lastModuleMsgAt[key]||0;
      if(now - last < CFG.MODULE_REPEAT_MS) return false;
    }
    return true;
  }

  function markShown(key){
    pet.lastAutoAt = Date.now();
    if(key) pet.lastModuleMsgAt[key] = Date.now();
  }

  function onModuleEnter(moduleId){
    resetIdle();
    pet.lastModule = moduleId;
    var ctx = safeCtx();

    // First-run walkthrough takes priority over the regular per-module
    // message, but only for the modules it actually covers, and only
    // the first time each one is visited.
    if(!localStorage.getItem(LS_ONBOARDED)){
      var shownSteps = getOnboardShown();
      if(shownSteps.indexOf(moduleId)===-1){
        var stepMsg = window.FinPetDialogue.getOnboardingStepMessage(moduleId);
        if(stepMsg){
          markOnboardShown(moduleId);
          markShown(moduleId);
          showBubble(stepMsg);
          finishOnboardingIfDone();
          return;
        }
      }
    }

    if(moduleId==='dashboard'){
      applyTrendClass(ctx);
      checkPersonalBests(ctx);
    }

    // A new week deserves an unprompted recap instead of making the
    // person ask for a check-in themselves.
    if(moduleId==='dashboard' && checkWeeklyRecap(ctx)) return;

    if(canShowAuto(moduleId)){
      var msg = window.FinPetDialogue.getModuleMessage(moduleId, ctx);
      if(msg){ markShown(moduleId); showBubble(msg); return; }
    }

    if(moduleId==='dashboard') checkPatternInsight();
    if(moduleId==='goals') checkStaleGoals();
  }

  /* ---------- milestones & streaks (read off the app's own toasts) ---------- */
  function getCelebratedStreaks(){
    try{ return JSON.parse(localStorage.getItem(LS_STREAK)||'[]'); } catch(e){ return []; }
  }
  function markStreakCelebrated(days){
    try{
      var list = getCelebratedStreaks();
      if(list.indexOf(days)===-1){
        list.push(days);
        localStorage.setItem(LS_STREAK, JSON.stringify(list));
      }
    }catch(e){}
  }

  function checkStreakMilestone(){
    var ctx = safeCtx();
    if(!ctx.streakDays) return;
    checkPersonalBests(ctx);
    if(getCelebratedStreaks().indexOf(ctx.streakDays)!==-1) return;
    var msg = window.FinPetDialogue.getStreakCelebration(ctx.streakDays);
    if(!msg) return;
    markStreakCelebrated(ctx.streakDays);
    if(ctx.streakDays===7) awardBadge('streak-7');
    if(ctx.streakDays===30) awardBadge('streak-30');
    markShown('milestone');
    setTimeout(function(){ showBubble(msg); }, 1400);
  }

  function checkMilestoneToast(toastMsg){
    if(!canShowAuto('milestone')) return;
    var msg = window.FinPetDialogue.getMilestoneMessage(toastMsg);
    if(!msg) return;
    if(typeof toastMsg==='string'){
      if(toastMsg.indexOf('🎉 Goal reached!')===0) awardBadge('goal-hit');
      if(toastMsg.indexOf('Loan settled')===0 || toastMsg.indexOf('fully settled')!==-1) awardBadge('loan-free');
    }
    markShown('milestone');
    setTimeout(function(){ showBubble(msg); }, 900);
  }

  function getPostActionShown(){
    try{ return JSON.parse(localStorage.getItem(LS_POSTACTION)||'[]'); } catch(e){ return []; }
  }
  function markPostActionShown(key){
    try{
      var list = getPostActionShown();
      if(list.indexOf(key)===-1){
        list.push(key);
        localStorage.setItem(LS_POSTACTION, JSON.stringify(list));
      }
    }catch(e){}
  }

  // "Here's a sensible next step" after a specific, first-time-ish action —
  // each one only ever shown once (tracked by dialogue.js's msg.key), so it
  // reads as a helpful nudge rather than nagging on every repeat action.
  function checkPostAction(toastMsg){
    if(!canShowAuto('milestone')) return;
    var ctx = safeCtx();
    if(toastMsg==='Budget saved ✓') awardBadge('first-month-budgeted');
    var msg = window.FinPetDialogue.getPostActionMessage(toastMsg, ctx);
    if(!msg) return;
    if(msg.key && getPostActionShown().indexOf(msg.key)!==-1) return;
    if(msg.key) markPostActionShown(msg.key);
    markShown('milestone');
    setTimeout(function(){ showBubble(msg); }, 900);
  }

  /* ---------- real-time budget alerts ----------
     Fires the moment an "Expense logged" toast crosses the 75% or 100%
     mark for the month, rather than waiting for a dashboard visit.
     Threshold crossings are remembered per calendar month so the same
     alert doesn't repeat on every subsequent expense that month. */
  function getBudgetAlertState(){
    try{ return JSON.parse(localStorage.getItem(LS_BUDGET_ALERT)||'{}'); } catch(e){ return {}; }
  }
  function saveBudgetAlertState(s){
    try{ localStorage.setItem(LS_BUDGET_ALERT, JSON.stringify(s)); }catch(e){}
  }
  function currentMonthKey(){
    var d = new Date();
    return d.getFullYear()+'-'+(d.getMonth()+1);
  }
  function checkBudgetAlert(toastMsg){
    if(typeof toastMsg!=='string' || toastMsg.indexOf('Expense logged')!==0) return;
    if(getSettings().muteBudget) return;
    var ctx = safeCtx();
    if(ctx.budgetPct===null) return;

    var monthKey = currentMonthKey();
    var st = getBudgetAlertState();
    if(st.month!==monthKey){ st = { month: monthKey, levels: [] }; }

    var level = null;
    if(ctx.budgetPct>=100 && st.levels.indexOf(100)===-1) level = 100;
    else if(ctx.budgetPct>=75 && ctx.budgetPct<100 && st.levels.indexOf(75)===-1) level = 75;
    if(level===null) return;

    st.levels.push(level);
    if(level===100 && st.levels.indexOf(75)===-1) st.levels.push(75);
    saveBudgetAlertState(st);

    markShown('milestone');
    setTimeout(function(){ showBubble(window.FinPetDialogue.getBudgetAlertMessage(ctx, level)); }, 700);
  }

  /* ---------- weekly recap ---------- */
  function getLastWeeklyRecapKey(){
    try{ return localStorage.getItem(LS_WEEKLY_RECAP)||''; }catch(e){ return ''; }
  }
  function markWeeklyRecapKey(key){
    try{ localStorage.setItem(LS_WEEKLY_RECAP, key); }catch(e){}
  }
  // Returns true if it showed (or silently started tracking) a recap, so
  // the caller can skip the regular dashboard message this visit.
  function checkWeeklyRecap(ctx){
    if(getSettings().muteInsights) return false;
    if(!localStorage.getItem(LS_ONBOARDED)) return false; // let onboarding finish first
    if(!ctx.weekKey) return false;
    var last = getLastWeeklyRecapKey();
    if(ctx.weekKey===last) return false;
    markWeeklyRecapKey(ctx.weekKey);
    if(!last) return false; // first time we've ever tracked a week — nothing to recap yet
    var msg = window.FinPetDialogue.getWeeklyRecapMessage(ctx);
    if(!msg) return false;
    markShown('dashboard');
    showBubble(msg);
    return true;
  }

  /* ---------- goal-progress tracking + stale-goal nudges ----------
     state.goals doesn't carry a "last added to" timestamp, so pet.js
     tracks one itself (keyed by goal id) by wrapping the app's own
     addGoal/addToGoal functions — no changes to index.html needed. */
  function getAppState(){
    try{ return (typeof state!=='undefined' ? state : null) || {}; }catch(e){ return {}; }
  }
  function getGoalProgressMap(){
    try{ return JSON.parse(localStorage.getItem(LS_GOAL_PROGRESS)||'{}'); }catch(e){ return {}; }
  }
  function recordGoalProgress(id){
    if(id===undefined || id===null) return;
    try{
      var map = getGoalProgressMap();
      map[id] = Date.now();
      localStorage.setItem(LS_GOAL_PROGRESS, JSON.stringify(map));
    }catch(e){}
  }
  function getGoalNudgedMap(){
    try{ return JSON.parse(localStorage.getItem(LS_GOAL_NUDGED)||'{}'); }catch(e){ return {}; }
  }
  function markGoalNudged(id){
    try{
      var map = getGoalNudgedMap();
      map[id] = Date.now();
      localStorage.setItem(LS_GOAL_NUDGED, JSON.stringify(map));
    }catch(e){}
  }

  function checkStaleGoals(){
    if(getSettings().muteInsights) return;
    if(!canShowAuto('milestone')) return;
    var goals = getAppState().goals || [];
    if(!goals.length) return;
    var progressMap = getGoalProgressMap();
    var nudgedMap = getGoalNudgedMap();
    var now = Date.now();
    var candidate = null, longestGap = -1;
    goals.forEach(function(g){
      if(!g || g.saved>=g.target) return; // don't nudge goals that are done
      var last = progressMap[g.id];
      if(last===undefined){
        // Never tracked before (goal predates this feature) — start
        // tracking from now rather than assuming it's stale already.
        recordGoalProgress(g.id);
        return;
      }
      var ageMs = now-last;
      if(ageMs < STALE_GOAL_DAYS*86400000) return;
      var lastNudge = nudgedMap[g.id]||0;
      if(now-lastNudge < GOAL_RENUDGE_MS) return;
      if(ageMs>longestGap){ longestGap = ageMs; candidate = g; }
    });
    if(!candidate) return;
    var daysSince = Math.floor(longestGap/86400000);
    var msg = window.FinPetDialogue.getGoalNudgeMessage(candidate, daysSince);
    if(!msg) return;
    markGoalNudged(candidate.id);
    markShown('milestone');
    showBubble(msg);
  }

  /* ---------- idle / sleep ---------- */
  function resetIdle(){
    pet.sleeping = false;
    clearTimeout(pet.idleTimer);
    clearTimeout(pet.sleepTimer);
    pet.idleTimer = setTimeout(function(){
      if(document.visibilityState!=='visible') return;
      var s = getSettings();
      // Mix in a financial tip some of the time instead of plain small talk —
      // idle moments are a low-friction place to surface a bit of knowledge —
      // unless the person's muted idle tips specifically.
      if(!s.muteTips && Math.random()<0.5){
        showBubble(window.FinPetDialogue.getTipMessage(pet.shownTips, safeCtx()));
      } else {
        showBubble(window.FinPetDialogue.getIdleNudge(safeCtx(), s.tone));
      }
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
    var line = window.FinPetDialogue.getWakeLine(getSettings().tone);
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

  /* ---------- onboarding walkthrough tracking ---------- */
  function getOnboardShown(){
    try{ return JSON.parse(localStorage.getItem(LS_ONBOARD_STEPS)||'[]'); }catch(e){ return []; }
  }
  function markOnboardShown(moduleId){
    try{
      var list = getOnboardShown();
      if(list.indexOf(moduleId)===-1){
        list.push(moduleId);
        localStorage.setItem(LS_ONBOARD_STEPS, JSON.stringify(list));
      }
    }catch(e){}
  }
  function finishOnboardingIfDone(){
    var shown = getOnboardShown();
    var steps = safe(function(){ return window.FinPetDialogue.getOnboardingModules(); }, []);
    var allShown = steps.length>0 && steps.every(function(m){ return shown.indexOf(m)!==-1; });
    if(allShown){
      try{ localStorage.setItem(LS_ONBOARDED,'1'); }catch(e){}
      maybeShowPrivacyNotice();
    }
  }

  // A one-time trust note, shown once right after the walkthrough finishes
  // (so it lands after the person has seen what Fin actually looks at).
  function maybeShowPrivacyNotice(){
    if(localStorage.getItem(LS_PRIVACY_SHOWN)==='1') return;
    try{ localStorage.setItem(LS_PRIVACY_SHOWN,'1'); }catch(e){}
    setTimeout(function(){
      markShown('milestone');
      showBubble(window.FinPetDialogue.getPrivacyMessage());
    }, 1800);
  }
  function safe(fn, fallback){ try{ return fn(); }catch(e){ return fallback; } }

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
            return;
          }
          if(Date.now()-pet.lastAutoAt > CFG.MIN_GAP_MS){
            setMood('happy', 1400);
          }
          // A goal-reached / loan-settled toast is a real, app-confirmed
          // event — worth a small celebration rather than staying silent.
          checkMilestoneToast(msg);
          // A handful of specific first-time actions get a one-time
          // "here's what makes sense next" nudge.
          checkPostAction(msg);
          // Real-time budget-threshold check, right as the expense lands.
          checkBudgetAlert(msg);
          if(typeof msg==='string' && msg.indexOf('logged')!==-1){
            checkStreakMilestone();
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

    // Track goal-progress timestamps (for stale-goal nudges) by wrapping
    // the app's own goal functions — no index.html changes required.
    if(typeof window.addToGoal === 'function' && !window.addToGoal.__finWrapped){
      var origAddToGoal = window.addToGoal;
      var wrapped4 = function(id){
        origAddToGoal(id);
        try{ recordGoalProgress(id); }catch(e){}
      };
      wrapped4.__finWrapped = true;
      window.addToGoal = wrapped4;
    }
    if(typeof window.addGoal === 'function' && !window.addGoal.__finWrapped){
      var origAddGoal = window.addGoal;
      var wrapped5 = function(){
        origAddGoal();
        try{
          var goals = getAppState().goals || [];
          var last = goals[goals.length-1];
          if(last) recordGoalProgress(last.id);
        }catch(e){}
      };
      wrapped5.__finWrapped = true;
      window.addGoal = wrapped5;
    }
  }

  function runFirstAppearance(){
    // The very first bubble is just the dashboard's onboarding step —
    // onModuleEnter handles showing it and tracking that it's been shown.
    onModuleEnter('dashboard');
  }

  /* ---------- init ---------- */
  function init(){
    applyFrequency(getSettings());
    buildDOM();
    hookApp();
    wireActivityListeners();
    resetIdle();
    setTimeout(function(){ applyTrendClass(safeCtx()); }, 300);
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

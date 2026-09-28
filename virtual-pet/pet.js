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

   Fin is drawn as a pixel-art coin with a graduation cap (crisp SVG pixels built from
   small sprite maps in buildSprite; no image files).

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
  var LS_SPIKE_WARNED = 'finPetSpikeWarned';        // {category: msTimestamp} — once-per-week-ish per category
  var LS_GOAL_PCT_SHOWN = 'finPetGoalPctShown';     // {goalId: [25,50,75,90]} thresholds already celebrated
  var LS_GOAL_SAVED_SNAP = 'finPetGoalSavedSnap';   // {goalId: lastKnownSavedAmount} — to diff top-ups
  var LS_LOAN_AMOUNT_SNAP = 'finPetLoanAmountSnap'; // {loanId: lastKnownOutstandingAmount} — to diff paydowns

  var SPIKE_COOLDOWN_MS = 6*24*60*60*1000; // matches the pattern-insight cadence — real observation, not chatter
  var SPIKE_MIN_SAMPLE = 3;   // need at least this many prior expenses in a category before "usual" means anything
  var SPIKE_RATIO = 1.75;     // at least 75% above the category's own average
  var SPIKE_MIN_ABS = 300;    // and at least this many pesos above it, so small categories don't trip on tiny variance
  var GOAL_PCT_THRESHOLDS = [25,50,75,90];

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
    shownTerms: new Set(),
    bubbleQueue: [],        // FIFO queue for auto-triggered messages (see queueBubble)
    queueBusy: false,
    sinceLastHereChecked: false,
    tour: false             // true while the guided tour (tour.js) is running: Fin stays quiet
  };

  // Toast copy that genuinely represents good financial news, used to
  // gate the pet's happy-mood reaction. Whitelisted rather than
  // "anything that isn't type:'error'" — several non-error toasts (a
  // recurring expense not yet logged, a loan due soon) are cautionary,
  // not celebratory, and shouldn't make Fin bounce with joy over them.
  var GOOD_NEWS_PREFIXES = [
    'Expense logged','Expense updated','Income added','Income entry updated',
    'Loan added','Loan updated','Loan settled','wallet added','wallet renamed',
    'wallet removed',' updated ✓','Goal added','Goal updated','🎉 Goal reached!',
    'Added ₱','Added ','Deducted ','fully settled','Budget saved','Backup saved',
    'CSV downloaded','Data restored','Report downloaded','FINUITY installed',
    'Name updated','PIN updated','PIN reset','Recovery question saved',
    'Account linked','Linked to Google','Updated with your latest data'
  ];
  function isGoodNewsToast(msg){
    if(typeof msg!=='string') return false;
    return GOOD_NEWS_PREFIXES.some(function(p){ return msg.indexOf(p)!==-1; });
  }

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
        buildSprite() +
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
    els.sprite = $('#fin-sprite',root);
    els.badgeShelf = $('#fin-badge-shelf',root);

    SpriteFX.start();
    setMood('idle');
    scheduleBlink();
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

  function buildSprite(){
    // Fin is a pixel-art coin wearing a graduation cap. The art lives in the
    // small pixel maps below (32x32 grid, one character = one pixel, '.' =
    // empty, letters index the palette P), which are turned into crisp SVG
    // <path>s once at build time - no image files, no gradients, no blur.
    // To retouch Fin, edit a map or a palette colour. Expressions are still
    // just data-anim values on the <svg>; the show/hide rules and the stepped,
    // frame-by-frame motion live in pet.css (the ".finc" section).
    var GRID = 32;
    var P = {
      o:'#4a2c05',                                   // coin outline
      a:'#d99a14', b:'#f0b92c', c:'#b57a0b',         // milled rim (checker + shadow side)
      i:'#b8780a',                                   // inner ring line
      g:'#ffc93c', l:'#ffe27a', s:'#eaa51f', w:'#fff6c2', // face: base / light / shade / shine
      d:'#2e1c02', m:'#8a2a18', p:'#ff8a7a', k:'#ff7f6e', // ink / mouth inside / tongue / cheek
      t:'#7cc4ff', u:'#3b8ad6',                      // tear
      x:'#0b1229', n:'#3a4d8c', N:'#6a83c9', z:'#1b2650', B:'#2a3a70', // cap
      y:'#ffd84a', r:'#c98a12'                       // gold trim / tassel
    };

    function layer(){ return {}; }
    function put(L, x, y, c){ L[y*GRID + x] = c; }
    function art(L, x0, y0, rows){
      rows.forEach(function(row, dy){
        for(var dx=0; dx<row.length; dx++){
          var ch = row.charAt(dx);
          if(ch !== '.') put(L, x0+dx, y0+dy, ch);
        }
      });
      return L;
    }
    // one <path> per colour, horizontal runs merged
    function svgOf(L){
      var byColor = {};
      Object.keys(L).forEach(function(k){
        k = +k;
        (byColor[L[k]] = byColor[L[k]] || []).push(k);
      });
      return Object.keys(byColor).map(function(c){
        var ks = byColor[c].sort(function(a,b){ return a-b; });
        var d = '', i = 0;
        while(i < ks.length){
          var start = ks[i], n = 1;
          while(i+n < ks.length && ks[i+n] === start+n && (start+n) % GRID !== 0) n++;
          d += 'M'+(start % GRID)+' '+Math.floor(start / GRID)+'h'+n+'v1h-'+n+'z';
          i += n;
        }
        return '<path fill="'+P[c]+'" d="'+d+'"/>';
      }).join('');
    }
    function part(cls, build){
      var L = layer(); build(L);
      return '<g class="v '+cls+'">'+svgOf(L)+'</g>';
    }

    /* ----- coin body: a pixel circle shaded from a top-left light ----- */
    var CX = 16, CY = 21, x, y;
    function dist(px, py){ var dx = px+.5-CX, dy = py+.5-CY; return Math.sqrt(dx*dx + dy*dy); }
    function inCoin(px, py){ return px>=0 && py>=0 && px<GRID && py<GRID && dist(px,py) <= 11; }
    var coin = layer();
    for(y=0; y<GRID; y++){
      for(x=0; x<GRID; x++){
        if(!inCoin(x,y)) continue;
        var d = dist(x,y), tone = (x+.5-CX) + (y+.5-CY), c;
        if(!inCoin(x-1,y) || !inCoin(x+1,y) || !inCoin(x,y-1) || !inCoin(x,y+1)) c = 'o';
        else if(d > 8.4) c = tone > 5 ? 'c' : ((x+y) % 2 ? 'a' : 'b');
        else if(d > 7.6) c = 'i';
        else c = tone < -6 ? 'l' : tone > 7 ? 's' : 'g';
        put(coin, x, y, c);
      }
    }
    [[9,19],[9,18],[9,17],[10,16],[11,15]].forEach(function(p){ put(coin, p[0], p[1], 'w'); });

    /* ----- graduation cap: band + flat board with a 1px underside ----- */
    var band = layer();
    for(y=9; y<=12; y++){
      for(x=10; x<=21; x++) put(band, x, y, (x===10 || x===21 || y===12) ? 'x' : 'B');
    }
    var widths = [4,10,16,22,28,22,16,10,4], M = {}, T = {}, board = layer();
    widths.forEach(function(w, r){
      for(var i=0; i<w; i++) M[(1+r)*GRID + 16 - w/2 + i] = r;
    });
    Object.keys(M).forEach(function(k){
      k = +k;
      if(M[k] >= 4 && !((k+GRID) in M)) T[k+GRID] = 1;
    });
    function inBoard(k){ return (k in M) || (k in T); }
    function isEdge(k){ return inBoard(k) && (!inBoard(k-1) || !inBoard(k+1) || !inBoard(k-GRID) || !inBoard(k+GRID)); }
    Object.keys(M).concat(Object.keys(T)).forEach(function(k){
      k = +k;
      var c;
      if(isEdge(k)) c = 'x';
      else if(k in T) c = 'z';
      else if(M[k] <= 4 && (isEdge(k-GRID) || isEdge(k-1))) c = 'N';
      else c = 'n';
      board[k] = c;
    });
    art(board, 15, 5, ['yy','yr']);           // button
    art(board, 17, 5, ['yyyyyyyyyyyy']);      // cord to the corner
    var tassel = layer();
    art(tassel, 28, 6, ['y','y','y']);
    art(tassel, 27, 9, ['yyy','yyr','y.r','y.r']);

    /* ----- hands, sparks, glint ----- */
    var HAND = ['.oo.','olgo','ogso','.oo.'];
    function spark(cx, cy){
      return '<g class="spark">'+svgOf(art(layer(), cx-1, cy-1, ['.y.','ywy','.y.']))+'</g>';
    }

    /* ----- face parts (only the ones for the current data-anim show) ----- */
    var face =
      part('eyes-open',  function(L){ var e=['wd','dd','dd']; art(L,11,19,e); art(L,19,19,e); }) +
      part('eyes-blink', function(L){ art(L,11,21,['dd']); art(L,19,21,['dd']); }) +
      part('eyes-wide',  function(L){ var e=['wdd','ddd','ddd','ddd']; art(L,11,19,e); art(L,18,19,e); }) +
      part('eyes-happy', function(L){ var e=['.d.','d.d']; art(L,11,20,e); art(L,19,20,e); }) +
      part('eyes-sleep', function(L){ var e=['d..d','.dd.']; art(L,10,20,e); art(L,18,20,e); }) +
      part('brows-worry',function(L){ art(L,11,16,['.dd','d..']); art(L,18,16,['dd.','..d']); }) +
      part('brows-up',   function(L){ art(L,11,16,['dd']); art(L,19,16,['dd']); }) +
      part('brows-think',function(L){ art(L,11,17,['dd']); art(L,19,15,['dd.','..d']); }) +
      part('mouth-smile',function(L){ art(L,13,24,['d....d','.dddd.']); }) +
      part('mouth-happy',function(L){ art(L,13,24,['dddddd','dmmmmd','.dppd.','..dd..']); }) +
      part('mouth-talk', function(L){ art(L,14,24,['.dd.','dmmd','.dd.']); }) +
      part('mouth-shut', function(L){ art(L,14,25,['dddd']); }) +
      part('mouth-sad',  function(L){ art(L,13,26,['.dddd.','d....d']); }) +
      part('mouth-o',    function(L){ art(L,14,24,['.dd.','dmmd','dmmd','.dd.']); }) +
      part('mouth-z',    function(L){ art(L,15,25,['dd']); }) +
      part('mouth-think',function(L){ art(L,14,24,['...d','ddd.']); }) +
      part('tear',       function(L){ art(L,10,22,['t','u']); });

    var cheeks = svgOf(art(art(layer(), 9, 23, ['kk']), 21, 23, ['kk']));

    return '' +
      '<svg class="fin-avatar-sprite finc" id="fin-sprite" data-anim="idle" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" aria-hidden="true" focusable="false">' +
      '<g class="finc-body"><g class="finc-spin">' +
      '<g class="finc-hand finc-hand-l">'+svgOf(art(layer(), 2, 25, HAND))+'</g>' +
      '<g class="finc-hand finc-hand-r">'+svgOf(art(layer(), 26, 25, HAND))+'</g>' +
      svgOf(coin) +
      '<g class="finc-cheek">'+cheeks+'</g>' +
      face +
      '<g class="finc-hat">'+svgOf(band)+svgOf(board)+'<g class="finc-tassel">'+svgOf(tassel)+'</g></g>' +
      '<g class="v sparks">'+spark(3,14)+spark(29,17)+spark(2,22)+'</g>' +
      '<g class="finc-glint">'+svgOf(art(layer(), 21, 13, ['.w.','www','.w.']))+'</g>' +
      '</g></g>' +
      '</svg>';
  }

  /* ---------- expression controller ----------
     Same public shape the rest of pet.js already uses (start,
     setAnimation, isBlinking), but instead of cycling PNG frames it
     just flips the data-anim attribute on the coin's <svg>. CSS does
     the rest, so there is nothing to preload and nothing to resize. */
  var ANIMS = {
    idle:      { loop:true },
    blink:     { ms:170 },
    talking:   { loop:true },
    happy:     { ms:1000 },
    sad:       { ms:1500 },
    sleepy:    { loop:true },
    surprised: { ms:950 },
    thinking:  { loop:true },
    walking:   { loop:true },
    wave:      { ms:1300 }
  };
  // Fin only ever had these six moods; map each onto the closest
  // expression rather than inventing new trigger points.
  var MOOD_TO_ANIM = {
    idle:      'idle',
    talking:   'talking',
    happy:     'happy',
    thinking:  'thinking',
    concerned: 'sad',
    sleeping:  'sleepy',
    surprised: 'surprised',
    waving:    'wave'
  };
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var SpriteFX = (function(){
    var current = null;
    var timer = null;

    function setAnimation(name, onComplete){
      if(!ANIMS[name]) name = 'idle';
      clearTimeout(timer);
      current = name;
      var a = ANIMS[name];
      var svg = els.sprite;
      if(svg){
        // Re-triggering a one-shot (happy twice in a row, say) needs the
        // attribute removed first, otherwise CSS won't restart the motion.
        if(!a.loop && svg.getAttribute('data-anim')===name){
          svg.removeAttribute('data-anim');
          svg.getBoundingClientRect();
        }
        svg.setAttribute('data-anim', name);
      }
      if(!a.loop && a.ms){
        timer = setTimeout(function(){
          if(current===name && onComplete) onComplete();
        }, a.ms);
      }
    }

    function start(){ if(!current) setAnimation('idle'); }

    return { start:start, setAnimation:setAnimation, get current(){ return current; },
      isBlinking:function(){ return current==='blink'; } };
  })();

  // Blink is layered on top of idle only — it never interrupts talking,
  // thinking, happy, sad or sleepy, and it's on its own timer so it
  // doesn't add a second loop fighting the main one. Each trigger plays
  // two short blinks back-to-back (a natural double-blink) instead of one -
  // a single ~440ms flash reads as barely-there, especially since it's
  // easy to miss entirely; two in a row with a small gap between them is
  // what actually registers as "the pet blinked."
  var BLINK_REPEATS = 2;
  var BLINK_GAP_MS = 150;
  var blinkTimer = null;
  function playBlink(timesLeft, onDone){
    SpriteFX.setAnimation('blink', function(){
      timesLeft--;
      if(timesLeft>0 && pet.mood==='idle' && !pet.sleeping){
        setTimeout(function(){ playBlink(timesLeft, onDone); }, BLINK_GAP_MS);
      } else if(onDone){
        onDone();
      }
    });
  }
  function scheduleBlink(){
    clearTimeout(blinkTimer);
    if(reducedMotion) return;
    var delay = 3000 + Math.random()*4000;
    blinkTimer = setTimeout(function(){
      if(pet.mood==='idle' && !pet.sleeping){
        playBlink(BLINK_REPEATS, function(){
          if(pet.mood==='idle') SpriteFX.setAnimation('idle');
        });
      }
      scheduleBlink();
    }, delay);
  }

  /* ---------- mood / expression ---------- */
  var MOOD_DEFER_RETRY_MS = 70;
  function setMood(mood, autoRevertMs){
    // If a blink is mid-flash, applying the new mood right now would swap
    // SpriteFX's current animation out from under it - the blink cuts off
    // after a frame or two and jumps straight into the new mood's frames,
    // which reads as "it blinked then instantly switched to another
    // emotion." A blink is short (well under half a second per flash), so
    // a brief wait here is unnoticeable and lets it finish naturally first.
    if(SpriteFX.isBlinking()){
      setTimeout(function(){ setMood(mood, autoRevertMs); }, MOOD_DEFER_RETRY_MS);
      return;
    }
    clearTimeout(pet.moodRevertTimer);
    pet.mood = mood;
    els.root.className = els.root.className.replace(/\bfin-state-\S+/g,'').trim();
    els.root.classList.add('fin-state-'+mood);
    var anim = MOOD_TO_ANIM[mood] || 'idle';
    SpriteFX.setAnimation(anim, function(){
      // non-looping reactions (happy/sad) settle back to idle on their own
      // once played through, same as the old CSS "play twice then stop" did
      if(pet.mood===mood) setMood('idle');
    });
    if(autoRevertMs){
      pet.moodRevertTimer = setTimeout(function(){ setMood('idle'); }, autoRevertMs);
    }
  }

  /* ---------- optional: walking / greeting API ----------
     Not currently called from anywhere in Fin's own logic (Fin doesn't
     walk around today), but wired up in case you want to hook it to
     something later — e.g. pet.walkTo(200) or FinPet.wave(). */
  var walkRAF = null;
  function stopWalking(){
    if(walkRAF) cancelAnimationFrame(walkRAF);
    walkRAF = null;
    if(pet.mood==='idle') SpriteFX.setAnimation('idle');
  }
  function walkTo(targetRightPx, onArrive){
    if(!els.root) return;
    var startRight = parseFloat(getComputedStyle(els.root).right) || 0;
    var startTs = null;
    var duration = Math.min(2200, Math.max(500, Math.abs(targetRightPx-startRight)*6));
    var goingLeft = targetRightPx > startRight; // increasing "right" moves the element visually left
    els.root.style.transform = goingLeft ? 'scaleX(1)' : 'scaleX(-1)';
    SpriteFX.setAnimation('walking');
    if(walkRAF) cancelAnimationFrame(walkRAF);
    function step(ts){
      if(startTs==null) startTs = ts;
      var t = Math.min(1, (ts-startTs)/duration);
      els.root.style.right = (startRight + (targetRightPx-startRight)*t) + 'px';
      if(t<1){ walkRAF = requestAnimationFrame(step); }
      else { stopWalking(); if(onArrive) onArrive(); }
    }
    walkRAF = requestAnimationFrame(step);
  }
  function walkLeft(distance){ walkTo((parseFloat(getComputedStyle(els.root).right)||0) + (distance||120)); }
  function walkRight(distance){ walkTo(Math.max(0, (parseFloat(getComputedStyle(els.root).right)||0) - (distance||120))); }
  function wave(){
    SpriteFX.setAnimation('wave', function(){ if(pet.mood==='idle') SpriteFX.setAnimation('idle'); });
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
    if(pet.tour) return; // the guided tour owns Fin's voice while it runs
    clearTimeout(pet.bubbleHideTimer);
    if(els.root.classList.contains('fin-minimized')){
      // Still register that something happened; don't force it open on
      // the user, just leave it for next time they open the tab.
      return;
    }
    hideInlineInput();
    pet.reactionShowing = false;
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

    var hideAfter = msg.stayMs || (actionList.length ? CFG.BUBBLE_MS_ACTION : CFG.BUBBLE_MS);
    pet.bubbleHideTimer = setTimeout(hideBubble, hideAfter);
  }

  function hideBubble(){
    clearTimeout(pet.bubbleHideTimer);
    pet.reactionShowing = false;
    els.bubble.classList.remove('fin-show');
    hideInlineInput();
    releaseQueue();
  }

  // ---------- auto-message FIFO queue ----------
  // Several independent checks (budget alerts, milestones, post-action
  // tips, streak celebrations, weekly recap, personal bests, pattern
  // insights, staleness nudges...) can all decide to speak up around the
  // same time, each on its own setTimeout. Left uncoordinated, whichever
  // timer resolves last silently overwrites whatever bubble was already
  // showing — the person never even sees the earlier message. Routing all
  // of them through this queue instead means they show one at a time, in
  // the order they were requested, and nothing gets silently dropped.
  var BUBBLE_QUEUE_MAX = 5;
  function queueBubble(msg, delayMs){
    if(!msg) return;
    if(pet.bubbleQueue.length>=BUBBLE_QUEUE_MAX) return; // don't grow unbounded if a lot piles up
    pet.bubbleQueue.push({ msg: msg, delay: delayMs||0 });
    processQueue();
  }
  function processQueue(){
    if(pet.queueBusy) return;
    var next = pet.bubbleQueue.shift();
    if(!next) return;
    pet.queueBusy = true;
    setTimeout(function(){
      showBubble(next.msg);
      if(els.root.classList.contains('fin-minimized') || pet.tour){
        // showBubble no-op'd (minimized / touring) — nothing will ever call hideBubble
        // for it, so release the queue ourselves instead of stalling on it.
        releaseQueue();
      }
    }, next.delay);
  }
  function releaseQueue(){
    if(!pet.queueBusy) return;
    pet.queueBusy = false;
    if(pet.bubbleQueue.length) setTimeout(processQueue, 350);
  }

  // Inline text-entry inside the bubble itself, used instead of
  // window.prompt() — prompt()/alert()/confirm() are unreliable (often
  // silently do nothing) once FINUITY is installed as a standalone PWA,
  // since there's no browser chrome to host the native dialog.
  function showInlineInput(promptText, placeholder, onSubmit){
    clearTimeout(pet.bubbleHideTimer);
    if(els.root.classList.contains('fin-minimized')) return;
    pet.reactionShowing = false;
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
      case 'custom':
        if(typeof action.onClick==='function') action.onClick();
        break;
      case 'tour':
        if(window.FinTour && typeof window.FinTour.start==='function') window.FinTour.start(true);
        else showBubble({ text:"The tour isn't available right now." });
        break;
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
      case 'goal-quick-add':
        if(typeof window.addToGoal==='function' && action.goalId!==undefined && action.amount){
          window.addToGoal(action.goalId, action.amount);
        }
        break;
      case 'loan-settle':
        if(typeof window.openSettleLoan==='function' && action.loanId!==undefined){
          window.openSettleLoan(action.loanId);
        }
        break;
      case 'loan-partial-pay':
        showInlineInput("How much to log toward this loan?", "e.g. 500", function(val){
          var amt = parseFloat(val);
          if(amt>0 && typeof window.adjustLoan==='function' && action.loanId!==undefined){
            window.adjustLoan(action.loanId, 'deduct', amt);
          }
        });
        break;
      case 'log-recurring':
        if(typeof window.logRecurring==='function' && action.templateId!==undefined){
          window.logRecurring(action.templateId);
        }
        break;
      case 'carry-over-budget':
        if(typeof window.setBudgetLimit==='function' && action.amount!==undefined){
          window.setBudgetLimit(action.amount);
        }
        break;
      case 'settings-toggle-push':
        requestNotificationPermission().then(function(perm){
          var s = getSettings();
          s.pushEnabled = (perm==='granted');
          saveSettings(s);
          showBubble(dlg.getSettingsNotificationsMessage(s));
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
    // Tap the pet again while a bubble is open to close it (tap = open/close toggle).
    if(els.bubble.classList.contains('fin-show')){ hideBubble(); return; }
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
      if(msg) queueBubble(msg, 1000);
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
    queueBubble(msg, 1200);
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
    if(pet.tour) return; // the guided tour is navigating; don't burn first-run tips or queue chatter
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
      checkPaceWarning(ctx);
      checkSurplusSuggestion(ctx);
      checkIncomeStale(ctx);
      checkBudgetStale(ctx);
      checkWalletStale(ctx);
      checkMonthCarryover(ctx);
      checkSinceLastHere();
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
    if(moduleId==='loans') checkIdleLoans();
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
    queueBubble(msg, 1400);
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
  // Driven by the app's own custom events (eventName + detail) instead of
  // matching substrings of the toast copy — see wireFinEvents().
  function checkPostAction(eventName, detail){
    if(!canShowAuto('milestone')) return;
    var ctx = safeCtx();
    var msg = window.FinPetDialogue.getPostActionMessage(eventName, detail, ctx);
    if(!msg) return;
    if(msg.key && getPostActionShown().indexOf(msg.key)!==-1) return;
    if(msg.key) markPostActionShown(msg.key);
    markShown('milestone');
    queueBubble(msg, 900);
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
  function checkBudgetAlert(){
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
    queueBubble(window.FinPetDialogue.getBudgetAlertMessage(ctx, level), 700);
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
    // Routed through the same queue as personal-bests/milestones/etc. so a
    // record set on this same visit can't silently stomp the recap (or
    // vice versa) the way two independent setTimeouts used to.
    queueBubble(msg, 0);
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
    queueBubble(msg, 0);
  }

  /* ---------- loan-progress tracking + idle-loan nudges (item 20) ----------
     Loans carry no "last touched" timestamp of their own, so pet.js tracks
     one itself, the same way it already does for goals — updated whenever
     fin:loan-added / fin:loan-adjusted / fin:loan-settled fires. */
  var LS_LOAN_PROGRESS = 'finPetLoanProgress';
  var LS_LOAN_IDLE_WARNED = 'finPetLoanIdleWarned';
  var LOAN_IDLE_DAYS = 90;
  function getLoanProgressMap(){
    try{ return JSON.parse(localStorage.getItem(LS_LOAN_PROGRESS)||'{}'); }catch(e){ return {}; }
  }
  function recordLoanProgress(id){
    if(id===undefined || id===null) return;
    try{
      var map = getLoanProgressMap();
      map[id] = Date.now();
      localStorage.setItem(LS_LOAN_PROGRESS, JSON.stringify(map));
    }catch(e){}
  }
  function getLoanIdleWarnedMap(){
    try{ return JSON.parse(localStorage.getItem(LS_LOAN_IDLE_WARNED)||'{}'); }catch(e){ return {}; }
  }
  function checkIdleLoans(){
    if(getSettings().muteInsights) return;
    if(!canShowAuto('milestone')) return;
    var loans = (getAppState().loans||[]).filter(function(l){ return l && !l.settled && !l.due; });
    if(!loans.length) return;
    var map = getLoanProgressMap();
    var warned = getLoanIdleWarnedMap();
    var now = Date.now();
    var candidate = null, longestGap = -1;
    loans.forEach(function(l){
      var last = map[l.id];
      if(last===undefined){
        // Never tracked before (loan predates this feature, or was added
        // before this session) — start tracking from now rather than
        // assuming it's already been sitting idle.
        recordLoanProgress(l.id);
        return;
      }
      var ageMs = now-last;
      if(ageMs < LOAN_IDLE_DAYS*86400000) return;
      var lastWarn = warned[l.id]||0;
      if(now-lastWarn < GOAL_RENUDGE_MS) return;
      if(ageMs>longestGap){ longestGap=ageMs; candidate=l; }
    });
    if(!candidate) return;
    warned[candidate.id] = now;
    try{ localStorage.setItem(LS_LOAN_IDLE_WARNED, JSON.stringify(warned)); }catch(e){}
    markShown('milestone');
    queueBubble(window.FinPetDialogue.getLoanIdleMessage(candidate, Math.floor(longestGap/86400000)), 0);
  }

  /* ---------- proactive nudges (pace, surplus, staleness, since-last-here) ----------
     A cluster of once-per-period checks, each gated by its own localStorage
     marker so it fires at most once per relevant window (a month, a visit)
     rather than nagging on every dashboard visit. */

  function checkPaceWarning(ctx){
    if(getSettings().muteBudget) return;
    if(!ctx.budgetLimit || ctx.projectedPct===null || ctx.projectedPct===undefined) return;
    if(ctx.budgetPct!==null && ctx.budgetPct>=75) return; // the real 75%/100% alert already covers this
    if(!ctx.daysInMonth) return;
    var timeFrac = ctx.dayOfMonth/ctx.daysInMonth;
    var spendFrac = (ctx.budgetPct||0)/100;
    if(spendFrac - timeFrac < 0.2) return; // not meaningfully ahead of pace
    var monthKey = currentMonthKey();
    var LS_PACE_WARNED = 'finPetPaceWarned';
    if(localStorage.getItem(LS_PACE_WARNED)===monthKey) return;
    try{ localStorage.setItem(LS_PACE_WARNED, monthKey); }catch(e){}
    if(!canShowAuto('milestone')) return;
    markShown('milestone');
    queueBubble(window.FinPetDialogue.getPaceWarningMessage(ctx, Math.round(timeFrac*100)), 600);
  }

  function checkSurplusSuggestion(ctx){
    if(getSettings().muteInsights) return;
    if(!ctx.budgetLimit || !ctx.curIncome) return;
    var surplus = ctx.curIncome - ctx.budgetLimit - ctx.curExp;
    if(surplus < 500) return;
    var goals = (getAppState().goals||[]).filter(function(g){ return g && g.target>0 && g.saved<g.target; });
    if(!goals.length) return;
    var monthKey = currentMonthKey();
    var LS_SURPLUS = 'finPetSurplusSuggested';
    var last = null;
    try{ last = JSON.parse(localStorage.getItem(LS_SURPLUS)||'null'); }catch(e){}
    if(last && last.month===monthKey) return;
    try{ localStorage.setItem(LS_SURPLUS, JSON.stringify({month:monthKey})); }catch(e){}
    if(!canShowAuto('milestone')) return;
    markShown('milestone');
    queueBubble(window.FinPetDialogue.getSurplusSuggestionMessage(goals[0], surplus), 800);
  }

  function checkIncomeStale(ctx){
    if(getSettings().muteInsights) return;
    if(!ctx.incomeStale) return;
    var monthKey = currentMonthKey();
    var LS_INCOME_STALE = 'finPetIncomeStaleWarned';
    if(localStorage.getItem(LS_INCOME_STALE)===monthKey) return;
    try{ localStorage.setItem(LS_INCOME_STALE, monthKey); }catch(e){}
    if(!canShowAuto('milestone')) return;
    markShown('milestone');
    queueBubble(window.FinPetDialogue.getIncomeStaleMessage(ctx), 500);
  }

  // Tracks when the current budget figure was last (re)saved, so
  // checkBudgetStale can tell "never revisited" apart from "just set it".
  var LS_BUDGET_SET_AT = 'finPetBudgetSetAt';
  function recordBudgetSet(amount){
    if(!amount) return;
    try{ localStorage.setItem(LS_BUDGET_SET_AT, JSON.stringify({amount:amount, setAt:Date.now()})); }catch(e){}
  }
  function getBudgetSetRecord(){
    try{ return JSON.parse(localStorage.getItem(LS_BUDGET_SET_AT)||'null'); }catch(e){ return null; }
  }
  function checkBudgetStale(ctx){
    if(getSettings().muteInsights) return;
    if(!ctx.budgetLimit || !ctx.curExp) return;
    var rec = getBudgetSetRecord();
    if(!rec || rec.amount!==ctx.budgetLimit) return; // never tracked, or changed since — nothing stale to flag yet
    var monthsSince = (Date.now()-rec.setAt) / (30*86400000);
    if(monthsSince<3) return;
    var diffPct = Math.abs(ctx.curExp-ctx.budgetLimit)/ctx.budgetLimit;
    if(diffPct<0.25) return;
    var monthKey = currentMonthKey();
    var LS_BUDGET_STALE_WARNED = 'finPetBudgetStaleWarned';
    if(localStorage.getItem(LS_BUDGET_STALE_WARNED)===monthKey) return;
    try{ localStorage.setItem(LS_BUDGET_STALE_WARNED, monthKey); }catch(e){}
    if(!canShowAuto('milestone')) return;
    markShown('milestone');
    queueBubble(window.FinPetDialogue.getBudgetStaleMessage(ctx, diffPct), 500);
  }

  function checkWalletStale(ctx){
    if(getSettings().muteInsights) return;
    if(!ctx.staleWallet) return;
    var key = String(ctx.staleWallet.wallet.id);
    var monthKey = currentMonthKey();
    var LS_WALLET_STALE_WARNED = 'finPetWalletStaleWarned';
    var seen = {};
    try{ seen = JSON.parse(localStorage.getItem(LS_WALLET_STALE_WARNED)||'{}'); }catch(e){}
    if(seen[key]===monthKey) return;
    seen[key] = monthKey;
    try{ localStorage.setItem(LS_WALLET_STALE_WARNED, JSON.stringify(seen)); }catch(e){}
    if(!canShowAuto('milestone')) return;
    markShown('milestone');
    queueBubble(window.FinPetDialogue.getWalletStaleMessage(ctx.staleWallet), 500);
  }

  // Start-of-month "carry over last time's budget?" — the app doesn't
  // reset the budget figure automatically between months, so this only
  // has something to offer when the current figure is 0 but a previous
  // nonzero figure was tracked (e.g. it was manually cleared).
  function checkMonthCarryover(ctx){
    if(getSettings().muteInsights) return;
    if(ctx.dayOfMonth>3) return;
    if(ctx.budgetLimit>0) return;
    var rec = getBudgetSetRecord();
    if(!rec || !rec.amount) return;
    var monthKey = currentMonthKey();
    var LS_CARRYOVER = 'finPetCarryoverPrompted';
    if(localStorage.getItem(LS_CARRYOVER)===monthKey) return;
    try{ localStorage.setItem(LS_CARRYOVER, monthKey); }catch(e){}
    if(!canShowAuto('milestone')) return;
    markShown('milestone');
    queueBubble(window.FinPetDialogue.getCarryoverMessage(rec.amount), 500);
  }

  // A lighter, more frequent cousin of the weekly recap — checked once per
  // session on the first dashboard visit, comparing to the last time the
  // app was actually opened rather than waiting for a new calendar week.
  var LS_LAST_SEEN = 'finPetLastSeenAt';
  function checkSinceLastHere(){
    if(pet.sinceLastHereChecked) return;
    pet.sinceLastHereChecked = true;
    if(getSettings().muteInsights) return;
    if(!localStorage.getItem(LS_ONBOARDED)) return;
    var prev = 0;
    try{ prev = parseInt(localStorage.getItem(LS_LAST_SEEN)||'0',10)||0; }catch(e){}
    var now = Date.now();
    try{ localStorage.setItem(LS_LAST_SEEN, String(now)); }catch(e){}
    if(!prev) return; // first time we've tracked this — nothing to compare yet
    var gapDays = Math.floor((now-prev)/86400000);
    if(gapDays<1 || gapDays>30) return; // too soon, or too long for a "since last here" delta to still be the right format
    var msg = safe(function(){ return window.FinPetDialogue.getSinceLastHereMessage(gapDays, safeCtx()); }, null);
    if(!msg) return;
    if(!canShowAuto('dashboard')) return;
    markShown('dashboard');
    queueBubble(msg, 400);
  }

  // Hooked into the recurring-expense-missing toast (dispatched by
  // index.html as fin:recurring-missing with a template id per item) so
  // it's an actionable "Log it" instead of a passive toast that's easy to
  // miss.
  function checkRecurringMissing(detail){
    if(getSettings().muteTips) return;
    var items = (detail && detail.items) || [];
    if(!items.length) return;
    if(!canShowAuto('milestone')) return;
    var msg = window.FinPetDialogue.getRecurringMissingMessage(items);
    if(!msg) return;
    markShown('milestone');
    queueBubble(msg, 600);
  }

  /* ---------- reactions to previously-silent real actions ----------
     Three real, frequent things a person does in this app used to produce
     either nothing (a partial goal top-up, a partial loan payment) or the
     same wordless happy-bounce as everything else on the GOOD_NEWS_PREFIXES
     list (an outsized expense). Each of these reads the app's own state
     directly — via getAppState(), the same accessor recordGoalProgress/
     checkStaleGoals already use — rather than assuming an event's `detail`
     carries a field this file can't verify from here (no index.html to
     check against). Each keeps its own small snapshot in localStorage so it
     can diff "before" vs "after" without needing the event payload to
     carry a delta. */

  // A markedly bigger-than-usual expense in a category with enough history
  // to have a real "usual" to compare against. Gated like the pattern
  // insights (roughly once a week per category) so it reads as "I noticed
  // something," not a reaction to every single entry.
  function checkExpenseSpike(){
    if(getSettings().muteInsights) return;
    var expenses = getAppState().expenses || [];
    if(!expenses.length) return;
    var last = expenses[expenses.length-1];
    if(!last || !last.cat || !(last.amount>0)) return;
    var history = expenses.slice(0, -1).filter(function(e){ return e && e.cat===last.cat && e.amount>0; });
    if(history.length < SPIKE_MIN_SAMPLE) return;
    var avg = history.reduce(function(a,e){ return a+e.amount; }, 0) / history.length;
    if(avg<=0) return;
    if(last.amount/avg < SPIKE_RATIO) return;
    if(last.amount-avg < SPIKE_MIN_ABS) return;
    var warned = {};
    try{ warned = JSON.parse(localStorage.getItem(LS_SPIKE_WARNED)||'{}'); }catch(e){}
    if(Date.now() - (warned[last.cat]||0) < SPIKE_COOLDOWN_MS) return;
    if(!canShowAuto('milestone')) return;
    warned[last.cat] = Date.now();
    try{ localStorage.setItem(LS_SPIKE_WARNED, JSON.stringify(warned)); }catch(e){}
    markShown('milestone');
    queueBubble(window.FinPetDialogue.getExpenseSpikeMessage(last, avg), 500);
  }

  // Goals: react to a partial top-up crossing a new 25/50/75/90% threshold,
  // not just the moment it's fully reached (fin:goal-progress with
  // d.reached already handles that case). Needs a saved-amount snapshot
  // since state.goals carries no history of its own.
  function getGoalPctShownMap(){
    try{ return JSON.parse(localStorage.getItem(LS_GOAL_PCT_SHOWN)||'{}'); }catch(e){ return {}; }
  }
  function getGoalSavedSnapMap(){
    try{ return JSON.parse(localStorage.getItem(LS_GOAL_SAVED_SNAP)||'{}'); }catch(e){ return {}; }
  }
  function seedGoalSavedSnap(goal){
    if(!goal || goal.id===undefined) return;
    var snap = getGoalSavedSnapMap();
    if(snap[goal.id]===undefined){
      snap[goal.id] = goal.saved||0;
      try{ localStorage.setItem(LS_GOAL_SAVED_SNAP, JSON.stringify(snap)); }catch(e){}
    }
  }
  function checkGoalProgressPct(goal){
    if(!goal || !(goal.target>0) || goal.id===undefined) return;
    if(getSettings().muteInsights) return;
    var snap = getGoalSavedSnapMap();
    var prevSaved = snap[goal.id];
    snap[goal.id] = goal.saved;
    try{ localStorage.setItem(LS_GOAL_SAVED_SNAP, JSON.stringify(snap)); }catch(e){}
    if(prevSaved===undefined) return; // first time tracking this goal — nothing to diff against yet
    var added = goal.saved - prevSaved;
    if(!(added>0)) return;
    var pct = Math.round((goal.saved/goal.target)*100);
    var shownMap = getGoalPctShownMap();
    var shown = shownMap[goal.id] || [];
    var crossed = GOAL_PCT_THRESHOLDS.filter(function(t){ return pct>=t && shown.indexOf(t)===-1; });
    if(!crossed.length) return;
    var level = crossed[crossed.length-1];
    shownMap[goal.id] = shown.concat(crossed);
    try{ localStorage.setItem(LS_GOAL_PCT_SHOWN, JSON.stringify(shownMap)); }catch(e){}
    if(!canShowAuto('milestone')) return;
    markShown('milestone');
    queueBubble(window.FinPetDialogue.getGoalProgressMessage(goal, added, level), 900);
  }

  // Loans: react to a partial payment (not settled — that's its own event)
  // with the actual amount just paid down. Same snapshot approach as goals,
  // since state.loans carries no "amount before this change" of its own.
  function getLoanAmountSnapMap(){
    try{ return JSON.parse(localStorage.getItem(LS_LOAN_AMOUNT_SNAP)||'{}'); }catch(e){ return {}; }
  }
  function seedLoanAmountSnap(loan){
    if(!loan || loan.id===undefined) return;
    var snap = getLoanAmountSnapMap();
    if(snap[loan.id]===undefined){
      snap[loan.id] = loan.amount;
      try{ localStorage.setItem(LS_LOAN_AMOUNT_SNAP, JSON.stringify(snap)); }catch(e){}
    }
  }
  function checkLoanPaymentAmount(loan){
    if(!loan || loan.settled || loan.id===undefined) return;
    if(getSettings().muteInsights) return;
    var snap = getLoanAmountSnapMap();
    var prevAmt = snap[loan.id];
    snap[loan.id] = loan.amount;
    try{ localStorage.setItem(LS_LOAN_AMOUNT_SNAP, JSON.stringify(snap)); }catch(e){}
    if(!(prevAmt>0)) return; // no baseline yet, or it was already at/below zero
    var paid = prevAmt - loan.amount;
    if(!(paid>0) || !(loan.amount>0)) return; // paid down to exactly zero is fin:loan-settled's job, not this one
    if(!canShowAuto('milestone')) return;
    markShown('milestone');
    queueBubble(window.FinPetDialogue.getLoanPaymentMessage(loan, paid), 900);
  }

  /* ---------- streak-at-risk evening nudge + Notification API (item 13, 16) ----------
     Best-effort only: without a push server, a Notification can only be
     shown while this tab's process is still alive somewhere (open but
     backgrounded) — not after the browser/app has actually been closed.
     True "reaches you even when FINUITY isn't open" delivery needs a
     server-side Push API integration, which is out of scope without a
     backend. This still covers the common case (tab open, phone locked or
     on another app) better than doing nothing. */
  function notificationsEnabled(){
    return !!(getSettings().pushEnabled && ('Notification' in window) && Notification.permission==='granted');
  }
  function requestNotificationPermission(){
    if(!('Notification' in window)) return Promise.resolve('unsupported');
    if(Notification.permission==='granted') return Promise.resolve('granted');
    if(Notification.permission==='denied') return Promise.resolve('denied');
    return Notification.requestPermission();
  }
  function notifyIfHidden(title, body, tag){
    if(!notificationsEnabled()) return;
    if(document.visibilityState==='visible') return; // the bubble already covers the foreground case
    if(!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then(function(reg){
      reg.showNotification(title, { body: body, tag: tag, icon: 'icon-192.png', badge: 'icon-192.png' });
    }).catch(function(){});
  }

  var LS_STREAK_RISK = 'finPetStreakRiskWarned';
  function checkStreakRisk(ctx){
    if(getSettings().muteInsights) return;
    if(ctx.timeOfDay!=='evening') return;
    if(ctx.loggedExpenseToday || ctx.streakDays<3) return;
    var todayKey = safe(function(){ return window.today(); }, new Date().toDateString());
    if(localStorage.getItem(LS_STREAK_RISK)===todayKey) return;
    try{ localStorage.setItem(LS_STREAK_RISK, todayKey); }catch(e){}
    notifyIfHidden("Don't break the streak", "Your "+ctx.streakDays+"-day logging streak is still alive — log today's expenses before it resets.", 'streak-risk');
    if(!canShowAuto('milestone')) return;
    markShown('milestone');
    queueBubble(window.FinPetDialogue.getStreakRiskMessage(ctx), 500);
  }

  var LS_LOAN_NOTIFIED = 'finPetLoanNotified';
  function checkLoanDueSoonNotify(ctx){
    if(!ctx.dueSoonLoan || ctx.dueSoonLoan.daysUntil>1) return;
    var key = ctx.dueSoonLoan.id+'|'+ctx.dueSoonLoan.due;
    var seen = [];
    try{ seen = JSON.parse(localStorage.getItem(LS_LOAN_NOTIFIED)||'[]'); }catch(e){}
    if(seen.indexOf(key)!==-1) return;
    seen.push(key);
    try{ localStorage.setItem(LS_LOAN_NOTIFIED, JSON.stringify(seen.slice(-30))); }catch(e){}
    notifyIfHidden('Loan due soon', '"'+ctx.dueSoonLoan.name+'" is due '+(ctx.dueSoonLoan.daysUntil<=0?'today':'tomorrow')+'.', 'loan-due');
  }

  // Runs the checks that need to fire even if the person never leaves the
  // dashboard open — evening streak risk and a next-day loan due date —
  // on a light interval plus whenever the tab becomes visible again.
  function runPeriodicChecks(){
    var ctx = safeCtx();
    checkStreakRisk(ctx);
    checkLoanDueSoonNotify(ctx);
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
    markShown('milestone');
    queueBubble(window.FinPetDialogue.getPrivacyMessage(), 1800);
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
            reactToToast(msg, type);
            return;
          }
          // Whitelist-gated, not "anything that isn't an error" — see
          // GOOD_NEWS_PREFIXES above. A few non-error toasts (a recurring
          // expense not yet logged, a loan due soon) are cautionary, not
          // something to bounce happily about.
          if(isGoodNewsToast(msg) && Date.now()-pet.lastAutoAt > CFG.MIN_GAP_MS){
            setMood('happy', 1400);
          }
          reactToToast(msg, type);
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

    wireFinEvents();
    wireReactions();
  }

  // Listens for the custom events index.html dispatches from the handful
  // of places that matter (see the fin:* CustomEvent calls there) instead
  // of parsing toast copy for substrings — a toast string can be reworded
  // freely now without silently breaking any of this.
  function wireFinEvents(){
    if(window.__finEventsWired) return;
    window.__finEventsWired = true;

    window.addEventListener('fin:expense-logged', function(){
      try{
        checkBudgetAlert();
        checkPaceWarning(safeCtx());
        checkStreakMilestone();
        checkExpenseSpike();
      }catch(e){}
    });
    window.addEventListener('fin:income-added', function(e){
      try{ checkPostAction('fin:income-added', e.detail); }catch(err){}
    });
    window.addEventListener('fin:wallet-added', function(e){
      try{ checkPostAction('fin:wallet-added', e.detail); }catch(err){}
    });
    window.addEventListener('fin:goal-added', function(e){
      try{
        var d = e.detail||{};
        checkPostAction('fin:goal-added', d);
        // Seed the saved-amount snapshot at creation (almost always 0) so
        // the first real top-up has a baseline to diff against instead of
        // silently being treated as "first time seeing this goal."
        if(d.goal) seedGoalSavedSnap(d.goal);
      }catch(err){}
    });
    window.addEventListener('fin:goal-progress', function(e){
      try{
        var d = e.detail||{};
        if(d.reached){
          awardBadge('goal-hit');
          if(canShowAuto('milestone')){
            markShown('milestone');
            queueBubble(window.FinPetDialogue.getGoalReachedMessage(d.goal), 900);
          }
        } else if(d.goal){
          checkGoalProgressPct(d.goal);
        }
      }catch(err){}
    });
    window.addEventListener('fin:loan-added', function(e){
      try{
        var d = e.detail||{};
        if(d.loan){ recordLoanProgress(d.loan.id); seedLoanAmountSnap(d.loan); }
        checkPostAction('fin:loan-added', d);
      }catch(err){}
    });
    window.addEventListener('fin:loan-adjusted', function(e){
      try{
        var d = e.detail||{};
        if(d.loan){ recordLoanProgress(d.loan.id); checkLoanPaymentAmount(d.loan); }
      }catch(err){}
    });
    window.addEventListener('fin:loan-settled', function(e){
      try{
        var d = e.detail||{};
        awardBadge('loan-free');
        if(d.loan) recordLoanProgress(d.loan.id);
        if(canShowAuto('milestone')){
          markShown('milestone');
          // A loan paid down to exactly zero via the deduct flow reads
          // slightly differently ("fully paid off") than one settled
          // through the modal ("settled") — detail.wallet is only present
          // on the modal path, which is the cue used to pick the phrasing.
          queueBubble(window.FinPetDialogue.getLoanSettledMessage(d.loan, !d.wallet), 900);
        }
      }catch(err){}
    });
    window.addEventListener('fin:budget-saved', function(e){
      try{
        var d = e.detail||{};
        if(d.amount) awardBadge('first-month-budgeted');
        recordBudgetSet(d.amount);
        checkPostAction('fin:budget-saved', d);
      }catch(err){}
    });
    window.addEventListener('fin:recurring-missing', function(e){
      try{ checkRecurringMissing(e.detail); }catch(err){}
    });
  }

  function runFirstAppearance(){
    // The very first bubble is just the dashboard's onboarding step —
    // onModuleEnter handles showing it and tracking that it's been shown.
    onModuleEnter('dashboard');
  }

  /* ---------- reactions to every action ----------
     The pet reacts to what the person actually does, from three sources:
       1. the app's own fin:* events (they carry real details: amount,
          category, wallet, goal, loan...),
       2. toast() text (covers edits, removals, exports, settings, and
          the friendly "you missed something" errors),
       3. a few wrapped functions that have no toast or event (theme,
          hide balances, opening an edit form, stats, filters).
     Each reaction always plays a mood animation right away. A short
     spoken line is added only when nothing more important is already
     on screen or waiting in the queue, so it never talks over budget
     alerts, celebrations or the menu. */
  var REACT_DELAY_MS = 900;       // lets richer messages (alerts, goals...) queue up first
  var REACT_ERR_DELAY_MS = 150;   // input mistakes deserve a fast nudge
  var REACT_MIN_GAP_MS = 2200;    // don't chatter on rapid-fire actions
  var REACT_BUBBLE_MS = 4200;     // reactions are brief

  function react(kind, data){
    try{
      if(!els.root || els.root.classList.contains('fin-minimized') || pet.tour) return;
      var dlg = window.FinPetDialogue;
      if(!dlg || typeof dlg.getReaction!=='function') return;
      var s = getSettings();
      var isErr = kind.indexOf('err-')===0;
      var now = Date.now();
      // An error toast and a follow-up "opened" reaction can land together
      // (e.g. Settle with no wallets) — let the error win.
      if(!isErr && pet.reactErrAt && now-pet.reactErrAt<400) return;
      var r = dlg.getReaction(kind, data||{}, safeCtx(), s.tone);
      if(!r) return;
      if(isErr) pet.reactErrAt = now;

      resetIdle();
      if(r.mood) setMood(r.mood, r.mood==='thinking' ? 1400 : 0);

      if(!r.text) return;
      if(s.frequency==='quiet' && !isErr) return; // "quiet" keeps the animation, drops the words
      clearTimeout(pet.reactTimer);
      pet.reactTimer = setTimeout(function(){
        if(els.root.classList.contains('fin-minimized')) return;
        if(pet.queueBusy || pet.bubbleQueue.length) return; // a richer message owns the bubble
        if(els.bubble.classList.contains('fin-show') && !pet.reactionShowing) return; // don't stomp the menu
        var t = Date.now();
        if(!isErr && t-(pet.lastReactSpeakAt||0) < REACT_MIN_GAP_MS) return;
        pet.lastReactSpeakAt = t;
        showReactionBubble(r.text);
      }, isErr ? REACT_ERR_DELAY_MS : REACT_DELAY_MS);
    }catch(e){}
  }

  function showReactionBubble(text){
    clearTimeout(pet.bubbleHideTimer);
    hideInlineInput();
    els.bubbleText.textContent = text;
    els.bubbleActions.innerHTML = '';
    els.bubble.classList.add('fin-show');
    pet.reactionShowing = true;
    pet.bubbleHideTimer = setTimeout(hideBubble, REACT_BUBBLE_MS);
  }

  // toast() text -> reaction. `null` kind means "an fin:* event already
  // reacts to this one with real details, so don't double up".
  var TOAST_RULES = [
    // already handled by fin:* events
    [/^Expense logged/, null], [/^Income added/, null], [/^Loan added/, null], [/wallet added ✓$/, null],
    [/^Goal added/, null], [/^🎉 Goal reached/, null], [/added to .* ✓$/i, null], [/^Deducted /, null],
    [/fully settled/, null], [/^Loan settled/, null], [/^Budget saved/, null], [/ logged ✓/, null],
    [/^↺ .*recurring/, null], [/^⚠ .*overdue/, null], [/^⏰/, null],
    // input mistakes and problems
    [/valid amount/, 'err-amount'], [/^Add a description/, 'err-desc'], [/^Enter a (goal |wallet |new )?name/, 'err-name'],
    [/valid balance/, 'err-balance'], [/too long/, 'err-longname'], [/already exists/, 'err-dupe'],
    [/Cannot remove last wallet/, 'err-lastwallet'], [/Add a wallet first|Pick a wallet/, 'err-nowallet'],
    [/no outstanding amount/, 'err-nooutstanding'], [/Pick a backup file/, 'err-nofile'],
    [/Invalid backup file/, 'err-badfile'], [/Could not read file/, 'err-readfile'],
    [/Cloud sync failed|Could not reach cloud/, 'err-cloud'], [/^Linking failed/, 'err-linking'],
    [/pop-ups/, 'err-popup'], [/already logged this month/, 'err-already'],
    // edits, removals, data, account
    [/^Income entry updated/, 'income-edited'], [/^Expense updated/, 'expense-edited'],
    [/^Loan updated/, 'loan-edited'], [/^Goal updated/, 'goal-edited'], [/^Goal removed/, 'goal-removed'],
    [/^Removed$/, function(){ return 'removed-'+(pet.lastDelType||''); }],
    [/^Wallet renamed to (.+) ✓$/, 'wallet-renamed', function(m){ return {name:m[1]}; }],
    [/^(.+) wallet removed$/, 'wallet-removed', function(m){ return {label:m[1]}; }],
    [/^Marked as outstanding/, 'loan-unsettled'],
    [/^CSV downloaded/, 'csv'], [/^Backup saved/, 'backup'], [/^Data restored/, 'restore'],
    [/^Report downloaded/, 'report'], [/^Opening print/, 'print'],
    [/^Name updated/, 'name-updated'], [/^PIN updated/, 'pin-updated'], [/^PIN reset/, 'pin-reset'],
    [/^PIN removed/, 'pin-removed'], [/^Recovery question saved/, 'recovery-saved'],
    [/^Updated with your latest data/, 'cloud-updated'], [/^Linked to Google|^Account linked/, 'google-linked'],
    [/^FINUITY installed/, 'installed'], [/^Welcome, (.+?)!/, 'welcome', function(m){ return {name:m[1]}; }],
    [/^All data cleared/, 'cleared'], [/^Account reset/, 'account-reset'],
    [/^(.+) updated ✓$/, 'balance-updated', function(m){ return {label:m[1]}; }]
  ];
  function reactToToast(msg, type){
    if(typeof msg!=='string') return;
    for(var i=0;i<TOAST_RULES.length;i++){
      var rule = TOAST_RULES[i];
      var m = rule[0].exec(msg);
      if(!m) continue;
      if(rule[1]===null) return;
      var kind = typeof rule[1]==='function' ? rule[1]() : rule[1];
      var data = rule[2] ? rule[2](m) : {};
      if(kind==='removed-') kind = 'removed';
      react(kind, data);
      return;
    }
    if(type==='error') react('err-generic', {});
  }

  // Wrap an app function so the pet notices it, without changing what it does.
  function wrapAction(name, pre, post){
    var orig = window[name];
    if(typeof orig!=='function' || orig.__finReact) return;
    var w = function(){
      var args = arguments;
      try{ if(pre) pre.apply(null, args); }catch(e){}
      var result = orig.apply(this, args);
      try{ if(post) post.apply(null, args); }catch(e){}
      return result;
    };
    w.__finReact = true;
    window[name] = w;
  }

  function wireReactions(){
    if(window.__finReactionsWired) return;
    window.__finReactionsWired = true;

    // real details from the app's own events
    var EVT = {
      'fin:expense-logged': 'expense',
      'fin:income-added': 'income',
      'fin:wallet-added': 'wallet-added',
      'fin:goal-added': 'goal-added',
      'fin:goal-progress': 'goal-progress',
      'fin:loan-added': 'loan-added',
      'fin:loan-adjusted': 'loan-adjusted',
      'fin:loan-settled': 'loan-settled',
      'fin:budget-saved': 'budget-saved'
    };
    Object.keys(EVT).forEach(function(evt){
      window.addEventListener(evt, function(e){ react(EVT[evt], (e && e.detail) || {}); });
    });

    // actions with no toast/event of their own
    wrapAction('del', function(type){ pet.lastDelType = type; });
    wrapAction('toggleTheme', null, function(){ react('theme', { light: document.body.classList.contains('light') }); });
    wrapAction('toggleHideBalances', null, function(){ react('hide-balances', { hidden: !!getAppState().hideBalances }); });
    wrapAction('openEditExpense', null, function(){ react('edit-open', { what:'an expense' }); });
    wrapAction('openEditIncome', null, function(){ react('edit-open', { what:'an income entry' }); });
    wrapAction('openEditLoan', null, function(){ react('edit-open', { what:'a loan' }); });
    wrapAction('openEditGoal', null, function(){ react('edit-open', { what:'a goal' }); });
    wrapAction('openSettleLoan', null, function(){ react('settle-open', {}); });
    wrapAction('openStatsModal', null, function(type){ react('stats-open', { type:type }); });
    wrapAction('setExpFilter', null, function(){ react('filter', {}); });
  }

  /* ---------- init ---------- */
  function init(){
    applyFrequency(getSettings());
    buildDOM();
    hookApp();
    wireActivityListeners();
    resetIdle();
    setTimeout(function(){ applyTrendClass(safeCtx()); }, 300);

    // Streak-risk / loan-due-tomorrow checks need to run even if the
    // person never revisits the dashboard today — a light interval plus a
    // check on regaining visibility covers that without any server.
    setTimeout(runPeriodicChecks, 4000);
    setInterval(function(){
      if(document.visibilityState==='visible') runPeriodicChecks();
    }, 10*60*1000);
    document.addEventListener('visibilitychange', function(){
      if(document.visibilityState==='visible') runPeriodicChecks();
    });
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Not used by Fin's own logic today (Fin doesn't currently walk or
  // wave on its own), but here so any future hook-up doesn't need to
  // touch this file again.
  window.FinPet = {
    setAnimation: function(name){ SpriteFX.setAnimation(name); },
    walkTo: walkTo,
    walkLeft: walkLeft,
    walkRight: walkRight,
    stopWalking: stopWalking,
    wave: wave,
    // ---- used by the guided tour (virtual-pet/tour.js) ----
    say: function(msg){
      if(!els.root || pet.tour || els.root.classList.contains('fin-minimized')) return false;
      showBubble(msg);
      return true;
    },
    setMood: function(mood, autoRevertMs){ setMood(mood, autoRevertMs); },
    setTourMode: function(on){
      pet.tour = !!on;
      if(on){ pet.bubbleQueue = []; clearTimeout(pet.reactTimer); hideBubble(); }
      else { resetIdle(); setMood('idle'); }
    }
  };
})();

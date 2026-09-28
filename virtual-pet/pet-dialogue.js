/* ============================================================
   FINUITY Virtual Pet — dialogue & context
   Pure data + pure functions. Nothing here touches the DOM or
   localStorage; pet.js is the only file that renders anything
   or persists preferences/tracking data. This file only reads
   the host app's existing global `state` object and helper
   functions (today(), fmt(), CAT_LABELS) — it never invents
   transaction data and never writes to `state`.

   Sections:
   1. context builder (reads app state)
   2. per-module contextual messages
   3. menu + small talk (tone-aware)
   4. financial tips knowledge base (context-weighted)
   5. financial glossary (context-weighted)
   6. "how am I doing" check-in (with spending-pace projection)
   7. milestones (toast-triggered) + logging-streak celebrations
   8. real-time budget alerts
   9. weekly recap + stale-goal nudges
   10. first-run onboarding walkthrough
   11. Fin settings menus
   12. pattern insights (weekday/category/YoY, from real history)
   13. personal bests (compare-to-self only)
   14. Ask Fin (local, pattern-matched Q&A, no network)
   15. on-device / privacy line
   16. badges (persistent milestone shelf)
   17. instant reactions to every action (getReaction)
   ============================================================ */
(function(global){

  function safe(fn,fallback){ try{ return fn(); }catch(e){ return fallback; } }

  function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

  // Weighted random index: given a list of positive weights, picks an
  // index with probability proportional to its weight. Falls back to a
  // plain uniform pick if the weights are degenerate.
  function weightedPickIndex(weights){
    var total = weights.reduce(function(a,b){ return a+b; }, 0);
    if(!(total>0)) return Math.floor(Math.random()*weights.length);
    var r = Math.random()*total;
    for(var i=0;i<weights.length;i++){
      r -= weights[i];
      if(r<=0) return i;
    }
    return weights.length-1;
  }

  function fmtSafe(n){
    return safe(()=>global.fmt(n), '₱'+Number(n||0).toFixed(2));
  }

  // NOTE: index.html declares `state` and `CAT_LABELS` with `const` at the
  // top level of a classic (non-module) <script> tag. Top-level let/const
  // bindings do NOT become properties of `window`, so `global.state` /
  // `global.CAT_LABELS` are always undefined even though the app works
  // fine — only `window.fmt` / `window.today` work because those are
  // `function` declarations, which DO attach to the global object. Since
  // pet-dialogue.js loads as a later classic <script> in the same page, it
  // shares the same global lexical environment as index.html's inline
  // script, so a bare reference to the identifier `state` (guarded with
  // typeof so this file never throws if loaded standalone) resolves
  // correctly. This one fix is what makes every context-driven message in
  // this file — old and new — actually see the user's real data.
  
  function appState(){
    return safe(()=> (typeof state!=='undefined' ? state : null), null) || {};
  }
  function appCatLabels(){
    return safe(()=> (typeof CAT_LABELS!=='undefined' ? CAT_LABELS : null), null);
  }
  // Same lexical-scope trick as appState() above, for the `cloudUser`
  // variable index.html declares with `let`. Used to make the privacy
  // message accurate for signed-in users, whose data does sync to the
  // cloud (see getPrivacyMessage below).
  function isSyncing(){
    return !!safe(()=> (typeof cloudUser!=='undefined' && cloudUser && !cloudUser.isAnonymous), false);
  }

  var FALLBACK_CAT_LABELS = {
    food:'🍜 Food', transport:'🚌 Transport', shopping:'🛍️ Shopping',
    utilities:'💡 Utilities', health:'💊 Health', entertainment:'🎮 Entertainment',
    'loan-payment':'💸 Loan Payment', 'other-exp':'📦 Other'
  };
  function catLabel(cat){
    var labels = appCatLabels() || FALLBACK_CAT_LABELS;
    return labels[cat] || cat;
  }

  function toLocalISO(d){
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }

  function daysBetween(fromStr, toStr){
    var a = new Date(fromStr+'T00:00:00');
    var b = new Date(toStr+'T00:00:00');
    return Math.round((b-a)/86400000);
  }

  // ISO-ish "year-Wxx" key, good enough to detect "a new week has started"
  // without needing exact ISO-8601 week numbering.
  function weekKeyFor(dateStr){
    var d = new Date(dateStr+'T00:00:00');
    d.setDate(d.getDate()+4-(d.getDay()||7));
    var yearStart = new Date(d.getFullYear(),0,1);
    var weekNo = Math.ceil((((d-yearStart)/86400000)+1)/7);
    return d.getFullYear()+'-W'+weekNo;
  }

  // Longest run of consecutive calendar days (ending today, or ending
  // yesterday if nothing's been logged yet today) with >=1 expense logged.
  function computeStreak(expenses, todayStr){
    if(!expenses.length) return 0;
    var dateSet = new Set(expenses.map(e=>e.date));
    var d = new Date(todayStr+'T00:00:00');
    if(!dateSet.has(todayStr)) d.setDate(d.getDate()-1);
    var streak = 0;
    while(dateSet.has(toLocalISO(d)) && streak < 3650){
      streak++;
      d.setDate(d.getDate()-1);
    }
    return streak;
  }

  /* ---------- 1. context ---------- */
  // Snapshot of "what's actually going on" in the app right now, built
  // fresh each time a message is requested. Every field is derived from
  // the real `state` object the host app already maintains.
  function buildContext(){
    const st = appState();
    const income = st.income || [];
    const expenses = st.expenses || [];
    const loans = st.loans || [];
    const goals = st.goals || [];
    const wallets = st.wallets || [];
    const now = new Date();
    const hour = now.getHours();
    const todayStr = safe(()=>global.today(), toLocalISO(now));

    const timeOfDay = hour<5 ? 'night' : hour<12 ? 'morning' : hour<17 ? 'afternoon' : hour<21 ? 'evening' : 'night';

    const todayExpenses = todayStr ? expenses.filter(e=>e.date===todayStr) : [];
    const loggedExpenseToday = todayExpenses.length>0;

    const unsettledLoans = loans.filter(l=>!l.settled);
    const payable = unsettledLoans.filter(l=>l.type==='payable');
    const receivable = unsettledLoans.filter(l=>l.type==='receivable');
    const overdue = unsettledLoans.filter(l=>l.due && l.due < (todayStr||''));

    // Due within the next few days (today included) but not yet overdue.
    const DUE_SOON_WINDOW_DAYS = 3;
    let dueSoonCutoffStr = todayStr;
    if(todayStr){
      const cutoff = new Date(todayStr+'T00:00:00');
      cutoff.setDate(cutoff.getDate()+DUE_SOON_WINDOW_DAYS);
      dueSoonCutoffStr = toLocalISO(cutoff);
    }
    const dueSoonList = todayStr ? unsettledLoans
      .filter(l=>l.due && l.due>=todayStr && l.due<=dueSoonCutoffStr)
      .sort((a,b)=> a.due<b.due ? -1 : a.due>b.due ? 1 : 0) : [];
    const dueSoonLoan = dueSoonList.length ? Object.assign({}, dueSoonList[0], { daysUntil: daysBetween(todayStr, dueSoonList[0].due) }) : null;

    const curMonth = now.getMonth(), curYear = now.getFullYear();
    const curMonthName = now.toLocaleString('en-US',{month:'long'});
    const prevDate = new Date(curYear, curMonth-1, 1);
    const prevMonthName = prevDate.toLocaleString('en-US',{month:'long'});
    const prevMonthYear = prevDate.getFullYear();

    const curExpenses = expenses.filter(e=>{
      const d = new Date(e.date);
      return !isNaN(d) && d.getMonth()===curMonth && d.getFullYear()===curYear;
    });
    const curExp = curExpenses.reduce((a,b)=>a+b.amount,0);
    const prevExp = expenses.filter(e=>{
      const d = new Date(e.date);
      return !isNaN(d) && d.getMonth()===prevDate.getMonth() && d.getFullYear()===prevMonthYear;
    }).reduce((a,b)=>a+b.amount,0);

    const curIncome = income.filter(i=>i.month===curMonthName && i.year===curYear).reduce((a,b)=>a+b.amount,0);
    const prevIncome = income.filter(i=>i.month===prevMonthName && i.year===prevMonthYear).reduce((a,b)=>a+b.amount,0);

    const savingsRatePct = curIncome>0 ? Math.round(((curIncome-curExp)/curIncome)*100) : null;
    const spendingDeltaPct = prevExp>0 ? Math.round(((curExp-prevExp)/prevExp)*100) : null;

    const catTotals = {};
    curExpenses.forEach(e=>{ catTotals[e.cat] = (catTotals[e.cat]||0) + e.amount; });
    let topCat = null, topCatAmt = 0;
    Object.keys(catTotals).forEach(c=>{ if(catTotals[c]>topCatAmt){ topCatAmt=catTotals[c]; topCat=c; } });
    const topCategory = topCat ? { cat: topCat, label: catLabel(topCat), amount: topCatAmt } : null;

    // Trailing 3-month savings rate (this month + the 2 before it), used as
    // a slower-moving "trend" signal rather than a single volatile month —
    // this is what the pet's subtle visual state tracks, not today's number.
    let trailingIncome = 0, trailingExp = 0, monthsWithIncome = 0;
    for(let back=0; back<3; back++){
      const md = new Date(curYear, curMonth-back, 1);
      const mName = md.toLocaleString('en-US',{month:'long'});
      const mYear = md.getFullYear();
      const mInc = income.filter(i=>i.month===mName && i.year===mYear).reduce((a,b)=>a+b.amount,0);
      const mExp = expenses.filter(e=>{ const d=new Date(e.date); return !isNaN(d) && d.getMonth()===md.getMonth() && d.getFullYear()===mYear; }).reduce((a,b)=>a+b.amount,0);
      trailingIncome += mInc; trailingExp += mExp;
      if(mInc>0) monthsWithIncome++;
    }
    const trailingSavingsRatePct = trailingIncome>0 ? Math.round(((trailingIncome-trailingExp)/trailingIncome)*100) : null;
    // Coarse trend bucket, used only for a subtle cosmetic cue — never a
    // score, never shown as a number unless the person asks for a check-in.
    const trendClass = trailingSavingsRatePct===null ? null
      : trailingSavingsRatePct>=20 ? 'good'
      : trailingSavingsRatePct>=0 ? 'neutral'
      : 'tight';

    const budgetLimit = st.budgetLimit || 0;
    const budgetPct = budgetLimit>0 ? Math.round((curExp/budgetLimit)*100) : null;

    // Spending-pace projection: "at this rate, you're on track for ₱X by
    // month-end" — a straight-line extrapolation from days elapsed.
    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(curYear, curMonth+1, 0).getDate();
    const projectedSpend = dayOfMonth>0 ? Math.round((curExp/dayOfMonth)*daysInMonth) : curExp;
    const projectedPct = budgetLimit>0 ? Math.round((projectedSpend/budgetLimit)*100) : null;
    const projectedOverBudget = budgetLimit>0 && projectedSpend>budgetLimit;

    const negativeWallets = wallets.filter(w=>w.balance<0);

    // Wallet that's had no income/expense activity in a long stretch (a
    // reconciliation check, not just a negative-balance one) — wallets
    // already carry an `updated` timestamp from balance changes, so this
    // needs no extra tracking of its own.
    const WALLET_STALE_DAYS = 45;
    let staleWallet = null;
    if(todayStr && wallets.length){
      const lastActivity = {};
      wallets.forEach(w=>{ lastActivity[w.id] = w.updated || null; });
      expenses.forEach(e=>{ if(e.source && (!lastActivity[e.source] || e.date>lastActivity[e.source])) lastActivity[e.source]=e.date; });
      income.forEach(i=>{ if(i.wallet && i.dateAdded && (!lastActivity[i.wallet] || i.dateAdded>lastActivity[i.wallet])) lastActivity[i.wallet]=i.dateAdded; });
      let oldestGap = -1;
      wallets.forEach(w=>{
        const last = lastActivity[w.id];
        const gapDays = last ? daysBetween(last, todayStr) : null;
        const effectiveGap = gapDays===null ? WALLET_STALE_DAYS : gapDays; // never-touched wallet counts as stale
        if(effectiveGap>=WALLET_STALE_DAYS && effectiveGap>oldestGap){ oldestGap=effectiveGap; staleWallet = { wallet:w, days: gapDays }; }
      });
    }

    // Monthly income silently sitting at 0 even though it's been logged
    // before — a few days into the month is enough to tell "hasn't gotten
    // to it yet" apart from a real gap that's quietly corrupting the
    // savings rate, trend cue, and pace projection.
    const incomeStale = income.length>0 && now.getDate()>=4 &&
      income.filter(i=>i.month===curMonthName && i.year===curYear).reduce((a,b)=>a+b.amount,0)===0;

    const nearGoal = goals.find(g=>g.target>0 && g.saved<g.target && (g.saved/g.target)>=0.9);

    const streakDays = safe(()=>computeStreak(expenses, todayStr), 0);

    // Trailing 7-day window, used for the weekly recap.
    let weeklyExpenseTotal = 0, weeklyTopCategory = null, weekExpenseCount = 0, weekKey = null;
    if(todayStr){
      weekKey = weekKeyFor(todayStr);
      const weekAgo = new Date(todayStr+'T00:00:00');
      weekAgo.setDate(weekAgo.getDate()-7);
      const weekAgoStr = toLocalISO(weekAgo);
      const weekExpenses = expenses.filter(e=> e.date>weekAgoStr && e.date<=todayStr);
      weekExpenseCount = weekExpenses.length;
      weeklyExpenseTotal = weekExpenses.reduce((a,b)=>a+b.amount,0);
      const weekCatTotals = {};
      weekExpenses.forEach(e=>{ weekCatTotals[e.cat] = (weekCatTotals[e.cat]||0) + e.amount; });
      let wTopCat=null, wTopAmt=0;
      Object.keys(weekCatTotals).forEach(c=>{ if(weekCatTotals[c]>wTopAmt){ wTopAmt=weekCatTotals[c]; wTopCat=c; } });
      weeklyTopCategory = wTopCat ? { cat: wTopCat, label: catLabel(wTopCat), amount: wTopAmt } : null;
    }

    return {
      timeOfDay,
      username: st.username || '',
      counts: { income: income.length, expenses: expenses.length, loans: unsettledLoans.length, goals: goals.length, wallets: wallets.length },
      loggedExpenseToday,
      payableCount: payable.length,
      receivableCount: receivable.length,
      overdueCount: overdue.length,
      overdueLoan: overdue[0]||null,
      dueSoonCount: dueSoonList.length,
      dueSoonLoan,
      budgetLimit, budgetPct,
      overBudget: budgetPct!==null && budgetPct>=100,
      budgetWarn: budgetPct!==null && budgetPct>=75 && budgetPct<100,
      dayOfMonth, daysInMonth, projectedSpend, projectedPct, projectedOverBudget,
      hasNegativeWallet: negativeWallets.length>0,
      negativeWallet: negativeWallets[0]||null,
      staleWallet,
      incomeStale,
      nearGoal,
      hasWallets: wallets.length>0,
      hasIncome: income.length>0,
      hasExpenses: expenses.length>0,
      hasLoans: loans.length>0,
      hasGoals: goals.length>0,
      curIncome, curExp, prevIncome, prevExp,
      savingsRatePct, spendingDeltaPct,
      topCategory, catTotals,
      trailingSavingsRatePct, trendClass,
      totalPayable: payable.reduce((a,b)=>a+b.amount,0),
      totalReceivable: receivable.reduce((a,b)=>a+b.amount,0),
      streakDays,
      weekKey, weeklyExpenseTotal, weeklyTopCategory, weekExpenseCount
    };
  }

  /* ---------- 2. per-module messages ----------
     Each entry returns either null (nothing worth saying) or
     {text, actionText, actionModule, actionFocus}. actionModule
     is a real module id the pet will pass to the host's own
     show() function; actionFocus is an optional input id to
     focus after navigating there. (pet.js also accepts a richer
     {text, actions:[{label,kind,...}]} shape — see section 3+.) */

  function dashboardMessage(ctx){
    const greetWord = ctx.timeOfDay==='morning' ? 'Good morning' : ctx.timeOfDay==='afternoon' ? 'Good afternoon' : ctx.timeOfDay==='evening' ? 'Good evening' : 'Still up';
    const name = ctx.username ? `, ${ctx.username}` : '';

    if(ctx.overdueCount>0){
      const l = ctx.overdueLoan;
      return { text:`${greetWord}${name}! Heads up — "${l.name}" looks past its due date.`, mood:'concerned',
        actions:[
          { label:'Mark Settled', kind:'loan-settle', loanId:l.id },
          { label:'Log Partial Payment', kind:'loan-partial-pay', loanId:l.id },
          { label:'View Loans', kind:'navigate', module:'loans' }
        ] };
    }
    if(ctx.overBudget){
      return { text:`${greetWord}${name}. You're over your budget for this month.`, actionText:'Check Budget', actionModule:'goals' };
    }
    if(ctx.dueSoonCount>0){
      const l = ctx.dueSoonLoan;
      const when = l.daysUntil<=0 ? 'today' : l.daysUntil===1 ? 'tomorrow' : `in ${l.daysUntil} days`;
      return { text:`${greetWord}${name}. "${l.name}" is due ${when} — worth settling before it's overdue.`,
        actions:[
          { label:'Mark Settled', kind:'loan-settle', loanId:l.id },
          { label:'Log Partial Payment', kind:'loan-partial-pay', loanId:l.id },
          { label:'View Loans', kind:'navigate', module:'loans' }
        ] };
    }
    if(!ctx.loggedExpenseToday && ctx.hasExpenses){
      return { text:`${greetWord}${name}! Haven't seen an expense logged today yet.`, actionText:'Add Expense', actionModule:'expenses', actionFocus:'exp-desc' };
    }
    if(ctx.budgetWarn){
      return { text:`${greetWord}${name}. You're at ${ctx.budgetPct}% of this month's budget — worth a glance.`, actionText:'View Budget', actionModule:'goals' };
    }
    if(ctx.nearGoal){
      const remaining = Math.max(0, Math.round((ctx.nearGoal.target-ctx.nearGoal.saved)*100)/100);
      return { text:`${greetWord}${name}! "${ctx.nearGoal.name}" is almost fully funded — ${fmtSafe(remaining)} left.`,
        actions:[
          { label:'Add '+fmtSafe(remaining)+' now', kind:'goal-quick-add', goalId:ctx.nearGoal.id, amount:remaining },
          { label:'View Goal', kind:'navigate', module:'goals' }
        ] };
    }
    if(ctx.payableCount>0){
      return { text:`${greetWord}${name}. You still owe on ${ctx.payableCount} loan${ctx.payableCount>1?'s':''}.`, actionText:'View Loans', actionModule:'loans' };
    }
    if(!ctx.hasIncome && !ctx.hasExpenses){
      return { text:`${greetWord}${name}! I'm Fin. Let's log your first entry — income or an expense, your call.`, actionText:'Add Income', actionModule:'income', actionFocus:'inc-amount' };
    }
    if(ctx.streakDays>=3){
      return { text:`${greetWord}${name}! ${ctx.streakDays}-day logging streak going — nice and steady.`, mood:'happy' };
    }
    return { text:`${greetWord}${name}! Everything here looks steady.`, mood:'happy' };
  }

  function incomeMessage(ctx){
    if(!ctx.hasIncome){
      return { text:"Nothing logged here yet. Add your first income entry whenever you're ready.", actionText:'Add Income', actionFocus:'inc-amount' };
    }
    return null;
  }

  function expensesMessage(ctx){
    if(!ctx.hasExpenses){
      return { text:"No expenses recorded yet. Logging them as they happen keeps your budget honest.", actionText:'Log One', actionFocus:'exp-desc' };
    }
    if(!ctx.loggedExpenseToday){
      return { text:"Nothing logged for today yet — even small ones add up if they slip through.", actionText:'Add Expense', actionFocus:'exp-desc' };
    }
    return null;
  }

  function balancesMessage(ctx){
    if(ctx.hasNegativeWallet){
      return { text:`"${ctx.negativeWallet.label}" has dipped below zero.`, mood:'concerned' };
    }
    if(!ctx.hasWallets){
      return { text:"No wallets set up yet — add one to start tracking where your money actually sits." };
    }
    return null;
  }

  function loansMessage(ctx){
    if(ctx.overdueCount>0){
      const l = ctx.overdueLoan;
      return { text:`"${l.name}" is past its due date. Worth following up.`, mood:'concerned',
        actions:[
          { label:'Mark Settled', kind:'loan-settle', loanId:l.id },
          { label:'Log Partial Payment', kind:'loan-partial-pay', loanId:l.id }
        ] };
    }
    if(ctx.dueSoonCount>0){
      const l = ctx.dueSoonLoan;
      const when = l.daysUntil<=0 ? 'today' : l.daysUntil===1 ? 'tomorrow' : `in ${l.daysUntil} days`;
      return { text:`"${l.name}" is due ${when} — might be worth settling before it's overdue.`,
        actions:[
          { label:'Mark Settled', kind:'loan-settle', loanId:l.id },
          { label:'Log Partial Payment', kind:'loan-partial-pay', loanId:l.id }
        ] };
    }
    if(ctx.payableCount>0){
      return { text:`You have ${ctx.payableCount} loan${ctx.payableCount>1?'s':''} still outstanding.` };
    }
    if(ctx.receivableCount>0){
      return { text:`${ctx.receivableCount} loan${ctx.receivableCount>1?'s are':' is'} owed back to you.` };
    }
    if(!ctx.hasLoans){
      return { text:"No loans on record — nice and clean." };
    }
    return { text:"All settled here. Nothing owed either way." };
  }

  function goalsMessage(ctx){
    if(ctx.overBudget){
      return { text:`You're over budget by ${ctx.budgetPct-100}% this month.`, mood:'concerned' };
    }
    if(ctx.nearGoal){
      const remaining = Math.max(0, Math.round((ctx.nearGoal.target-ctx.nearGoal.saved)*100)/100);
      return { text:`"${ctx.nearGoal.name}" is at ${Math.round(ctx.nearGoal.saved/ctx.nearGoal.target*100)}% — so close!`, mood:'happy',
        actions:[ { label:'Add '+fmtSafe(remaining)+' now', kind:'goal-quick-add', goalId:ctx.nearGoal.id, amount:remaining } ] };
    }
    if(!ctx.budgetLimit){
      return { text:"You haven't set a monthly budget yet. It's a quick way to keep spending in check." };
    }
    if(!ctx.hasGoals){
      return { text:"No savings goals yet. Even a small target can help money feel less abstract." };
    }
    return null;
  }

  function settingsMessage(ctx){
    return null; // settings is self-explanatory; don't clutter it
  }

  function exportMessage(ctx){
    if(ctx.hasIncome || ctx.hasExpenses){
      return { text:"You can pull a report of any month or year from here." };
    }
    return null;
  }

  const MODULE_HANDLERS = {
    dashboard: dashboardMessage,
    income: incomeMessage,
    expenses: expensesMessage,
    balances: balancesMessage,
    loans: loansMessage,
    goals: goalsMessage,
    settings: settingsMessage,
    export: exportMessage
  };

  function getModuleMessage(moduleId, ctx){
    const handler = MODULE_HANDLERS[moduleId];
    if(!handler) return null;
    return safe(()=>handler(ctx), null);
  }

  /* ---------- 3. menu + small talk (tone-aware) ---------- */

  const TONE_LINES = {
    playful: {
      click: [
        "Hey! Need something?", "I'm here if you need me.", "Just keeping an eye on things.",
        "Poke me anytime — I like the attention.", "All quiet on my end.",
        "I've been watching those pesos move around today.", "Bubble life is pretty cozy, not gonna lie.",
        "Nothing on fire, if that's what you're checking.", "Just vibing near your budget.",
        "Click, click — I'm listening.", "Ask me something if you're curious about your numbers."
      ],
      idle: ["Psst... still there?", "Take your time — I'll be here.", "No rush. Just checking in.", "I'll just be here, looking at your wallets."],
      wake: ["Oh, hey — welcome back!", "You're back! What'd I miss?"],
      menu: "What do you need?"
    },
    businesslike: {
      click: [
        "How can I help?", "Standing by.", "Let me know if you need anything.",
        "Ready when you are.", "No updates at the moment.", "Everything's tracking normally.",
        "Available if you have a question about your finances.", "Nothing flagged right now."
      ],
      idle: ["Still there? I can wait.", "Whenever you're ready.", "No rush — checking in."],
      wake: ["Welcome back.", "You're back — here's where things stand."],
      menu: "How can I help?"
    }
  };
  function toneSet(tone){ return TONE_LINES[tone] || TONE_LINES.playful; }

  function getMenuMessage(ctx, tone){
    return {
      text: toneSet(tone).menu,
      actions: [
        { label:'🧭 What\'s next?', kind:'next' },
        { label:'🗺️ Show me around', kind:'tour' },
        { label:'💡 Quick tip', kind:'tip' },
        { label:'📊 Check-in', kind:'health' },
        { label:'📖 Explain a term', kind:'glossary' },
        { label:'❓ Ask me something', kind:'ask-menu' },
        { label:'👋 Just chat', kind:'smalltalk' },
        { label:'⚙️ Settings', kind:'settings' }
      ]
    };
  }

  // A single, ordered "what should I do right now" pointer — distinct from
  // dashboardMessage (which leads with alerts). This one leads with
  // onboarding/navigation: the next empty piece of the picture, in the
  // order that makes the rest of the app make sense.
  function getNextActionMessage(ctx){
    if(!ctx.hasWallets){
      return { text:"Start with a wallet — income, expenses, and balances are all tracked against one.",
        actions:[ { label:'Add Wallet', kind:'navigate', module:'balances', focus:'new-wallet-name' }, { label:'Menu', kind:'menu' } ] };
    }
    if(!ctx.hasIncome){
      return { text:"Next, log some income so your wallet balances have something behind them.",
        actions:[ { label:'Add Income', kind:'navigate', module:'income', focus:'inc-amount' }, { label:'Menu', kind:'menu' } ] };
    }
    if(!ctx.hasExpenses){
      return { text:"Now try logging an expense — that's where the day-to-day picture actually comes from.",
        actions:[ { label:'Add Expense', kind:'navigate', module:'expenses', focus:'exp-desc' }, { label:'Menu', kind:'menu' } ] };
    }
    if(!ctx.budgetLimit){
      return { text:"The basics are logged. Setting a monthly budget is a quick way to keep spending in check from here on.",
        actions:[ { label:'Set Budget', kind:'navigate', module:'goals' }, { label:'Menu', kind:'menu' } ] };
    }
    if(!ctx.hasGoals){
      return { text:"Everything's tracked and budgeted. A savings goal is a good next step if there's something specific you're saving toward.",
        actions:[ { label:'Add Goal', kind:'navigate', module:'goals' }, { label:'Menu', kind:'menu' } ] };
    }
    if(ctx.overdueCount>0){
      return { text:`The basics are all covered. One thing worth a look: "${ctx.overdueLoan.name}" is past its due date.`, mood:'concerned',
        actions:[ { label:'View Loans', kind:'navigate', module:'loans' }, { label:'Menu', kind:'menu' } ] };
    }
    if(ctx.dueSoonCount>0){
      const l = ctx.dueSoonLoan;
      const when = l.daysUntil<=0 ? 'today' : l.daysUntil===1 ? 'tomorrow' : `in ${l.daysUntil} days`;
      return { text:`Everything's covered. Just a nudge: "${l.name}" is due ${when}.`,
        actions:[ { label:'View Loans', kind:'navigate', module:'loans' }, { label:'Menu', kind:'menu' } ] };
    }
    if(ctx.overBudget){
      return { text:"Everything's set up — you're just over budget for this month, worth a look when you get a chance.", mood:'concerned',
        actions:[ { label:'Check Budget', kind:'navigate', module:'goals' }, { label:'Menu', kind:'menu' } ] };
    }
    return { text:"Wallets, income, expenses, a budget, and goals are all set up. I'll flag anything that needs attention as it comes up.", mood:'happy',
      actions:[ { label:'Menu', kind:'menu' } ] };
  }

  function getSmallTalkMessage(ctx, tone){
    // Occasionally surface a real recommendation instead of small talk.
    if(Math.random()<0.4){
      const rec = safe(()=>dashboardMessage(ctx), null);
      if(rec && rec.actionText){
        return {
          text: rec.text,
          mood: rec.mood,
          actions: [
            { label: rec.actionText, kind:'navigate', module: rec.actionModule, focus: rec.actionFocus },
            { label:'Menu', kind:'menu' }
          ]
        };
      }
    }
    return {
      text: pick(toneSet(tone).click),
      actions:[ { label:'❓ Ask something', kind:'ask-menu' }, { label:'Menu', kind:'menu' } ]
    };
  }

  // Half the time (when there's something real to point to), the idle
  // timer surfaces an actual fact from ctx instead of a canned line — this
  // is the trigger people notice most since it's unprompted, so it's the
  // one most worth tying to real state rather than a random pick.
  function getIdleNudge(ctx, tone){
    ctx = ctx || {};
    const real = [];
    if(ctx.streakDays>=2 && !ctx.loggedExpenseToday){
      real.push(`Still got that ${ctx.streakDays}-day streak going — nothing logged yet today, though.`);
    }
    if(ctx.budgetLimit>0 && ctx.budgetPct!==null && ctx.budgetPct<75){
      real.push(`${100-ctx.budgetPct}% of this month's budget still unused, if that's useful to know.`);
    }
    if(ctx.dueSoonLoan){
      const l = ctx.dueSoonLoan;
      const when = l.daysUntil<=0 ? 'today' : l.daysUntil===1 ? 'tomorrow' : `in ${l.daysUntil} days`;
      real.push(`Quiet reminder: "${l.name}" is due ${when}.`);
    }
    if(ctx.nearGoal && ctx.nearGoal.target>0){
      const pct = Math.round((ctx.nearGoal.saved/ctx.nearGoal.target)*100);
      real.push(`"${ctx.nearGoal.name}" is ${pct}% of the way there — close now.`);
    }
    if(real.length && Math.random()<0.5) return { text: pick(real) };
    return { text: pick(toneSet(tone).idle) };
  }

  function getWakeLine(tone){
    return { text: pick(toneSet(tone).wake) };
  }

  /* ---------- 4. financial tips knowledge base ----------
     General personal-finance education, not personalized advice —
     Fin never tells the user what to specifically do with their money.
     Each tip is tagged so getTipMessage can weight the pool toward
     what's actually relevant right now instead of picking uniformly. */

  // Shared weighting: boosts a tip/term when its tag matches what's
  // currently going on in the user's data.
  function contextWeight(tags, ctx){
    var w = 1;
    tags = tags || [];
    ctx = ctx || {};
    if(tags.indexOf('debt')!==-1 && ctx.payableCount>0) w += 2;
    if(tags.indexOf('budget')!==-1 && !ctx.budgetLimit) w += 2;
    if(tags.indexOf('saving')!==-1 && !ctx.hasGoals) w += 2;
    if(tags.indexOf('tracking')!==-1 && ctx.hasExpenses && !ctx.loggedExpenseToday) w += 1;
    return w;
  }

  const FIN_TIPS = [
    { text:"A common starting point for a budget is the 50/30/20 split: roughly 50% of income to needs, 30% to wants, 20% to savings or debt.", tags:['budget'] },
    { text:"An emergency fund is money set aside for the unexpected — job loss, a medical bill, a broken phone — kept separate from everyday spending.", tags:['saving'] },
    { text:"Many budgeters aim to build 3 to 6 months of essential expenses in an emergency fund before focusing heavily on other savings goals.", tags:['saving'] },
    { text:"Fixed expenses (like rent) stay roughly the same each month; variable expenses (like food or transport) change — knowing which is which makes a budget easier to trust.", tags:['budget','tracking'] },
    { text:"Tracking every expense, even small ones, is one of the simplest ways to see where money is actually going, not just where you think it's going.", tags:['tracking'] },
    { text:"A 'sinking fund' is a small pot you save into gradually for a known future expense — like an annual insurance payment — so it doesn't hit as a surprise.", tags:['saving'] },
    { text:"When paying off several debts, the 'avalanche' method targets the highest interest rate first; the 'snowball' method targets the smallest balance first for quick wins.", tags:['debt'] },
    { text:"Interest can work for you or against you — money saved earns interest over time, while money borrowed accrues interest that grows what's owed.", tags:['debt','saving'] },
    { text:"A wallet or account balance going negative usually means a payment cleared before the money to cover it did — worth watching if it happens often.", tags:['tracking'] },
    { text:"Reviewing spending by category once a month can reveal patterns that are easy to miss day-to-day, like how small recurring purchases add up.", tags:['tracking','budget'] },
    { text:"Setting a specific number for a savings goal — not just 'save more' — tends to make it easier to track progress and stay motivated.", tags:['saving'] },
    { text:"A budget isn't meant to be perfect from day one; most people adjust the categories and limits a few times before it actually fits their life.", tags:['budget'] },
    { text:"Separating 'needs' from 'wants' before a purchase is a simple habit that can make bigger financial decisions easier later.", tags:['budget'] },
    { text:"Automating a transfer to savings right after income arrives — before spending happens — is a common way to make saving consistent.", tags:['saving'] },
    { text:"Net worth is simply what you own minus what you owe. Tracking it over months matters more than any single number on its own.", tags:['tracking'] },
    { text:"Loans that are 'receivable' are money owed to you; loans that are 'payable' are money you owe — mixing the two up is a common bookkeeping slip.", tags:['debt','tracking'] },
    { text:"Recurring subscriptions are easy to forget about since they don't require an active decision each month — a periodic review can catch ones that quietly aren't worth it anymore.", tags:['tracking','budget'] },
    { text:"A budget limit works best when it's realistic. Setting it too low often just leads to abandoning it a few weeks in.", tags:['budget'] },
    { text:"Windfalls — bonuses, gifts, tax refunds — are easy to spend without noticing. Deciding in advance how much goes to savings can help it actually stick.", tags:['saving'] },
    { text:"Comparing this month's spending to last month's is often more useful than comparing to a 'budget' that hasn't been reviewed in a while.", tags:['tracking','budget'] },
    { text:"Paying more than the minimum on a debt, even a small amount extra, reduces the total interest paid over the life of that debt.", tags:['debt'] },
    { text:"Cash flow is the timing of money in versus money out — even a healthy income can feel tight if bills are due before paychecks land.", tags:['budget','tracking'] },
    { text:"Opportunity cost is what you give up by choosing one option over another — including the choice to spend now instead of save.", tags:['saving'] },
    { text:"A goal with a saved amount close to its target is a good moment to double-check the target is still realistic, not just push through blindly.", tags:['saving'] }
  ];

  function getTipMessage(excludeSet, ctx){
    excludeSet = excludeSet || new Set();
    ctx = ctx || {};
    if(excludeSet.size >= FIN_TIPS.length) excludeSet.clear();
    const pool = FIN_TIPS.map((_,i)=>i).filter(i=>!excludeSet.has(i));
    const candidates = pool.length ? pool : FIN_TIPS.map((_,i)=>i);
    const weights = candidates.map(i=>contextWeight(FIN_TIPS[i].tags, ctx));
    const idx = candidates[weightedPickIndex(weights)];
    excludeSet.add(idx);
    return {
      idx,
      text: FIN_TIPS[idx].text,
      mood: 'idle',
      actions: [ { label:'Another tip', kind:'tip' }, { label:'Menu', kind:'menu' } ]
    };
  }

  /* ---------- 5. financial glossary (context-weighted) ---------- */

  const FIN_GLOSSARY = [
    { term:"Net Worth", def:"What you own (assets) minus what you owe (liabilities). A single snapshot number, useful mainly when tracked over time.", tags:['tracking'] },
    { term:"Emergency Fund", def:"Money set aside specifically for unexpected expenses, kept separate from everyday spending or investing.", tags:['saving'] },
    { term:"Cash Flow", def:"The movement of money in and out over a period — income coming in, expenses going out, and the timing between them.", tags:['budget','tracking'] },
    { term:"Asset", def:"Anything of value that you own — cash, savings, property, investments.", tags:['tracking'] },
    { term:"Liability", def:"Something you owe — a loan, a credit balance, any debt.", tags:['debt'] },
    { term:"Amortization", def:"Paying off a debt gradually through regular payments, each covering part interest and part principal.", tags:['debt'] },
    { term:"Principal", def:"The original amount borrowed or invested, before interest is added.", tags:['debt'] },
    { term:"Interest Rate", def:"The percentage charged on borrowed money, or earned on saved/invested money, usually expressed per year.", tags:['debt'] },
    { term:"Compound Interest", def:"Interest calculated on both the original amount and any interest already earned or charged — it grows faster than simple interest over time.", tags:['debt','saving'] },
    { term:"Debt-to-Income Ratio", def:"Total monthly debt payments divided by monthly income — a common way to gauge how manageable someone's debt load is.", tags:['debt'] },
    { term:"Fixed Expense", def:"A cost that stays roughly the same each period, like rent or a loan payment.", tags:['budget'] },
    { term:"Variable Expense", def:"A cost that changes month to month, like food, transport, or entertainment.", tags:['budget'] },
    { term:"Sinking Fund", def:"Savings set aside gradually for a specific, known future expense — like a yearly renewal fee.", tags:['saving'] },
    { term:"Opportunity Cost", def:"What you give up by choosing one option instead of another — including spending now instead of saving.", tags:['saving'] },
    { term:"Diversification", def:"Spreading money across different assets or sources instead of relying on just one, to reduce risk.", tags:['saving'] },
    { term:"Liquidity", def:"How quickly and easily an asset can be turned into cash without losing value — cash itself is the most liquid.", tags:['tracking'] },
    { term:"Inflation", def:"The general rise in prices over time, which reduces how much a fixed amount of money can buy.", tags:['saving'] },
    { term:"Savings Rate", def:"The portion of income that's saved rather than spent, usually shown as a percentage.", tags:['saving'] },
    { term:"50/30/20 Rule", def:"A rough budgeting split: about 50% of income to needs, 30% to wants, and 20% to savings or debt repayment.", tags:['budget'] }
  ];

  function getGlossaryMessage(excludeSet, ctx){
    excludeSet = excludeSet || new Set();
    ctx = ctx || {};
    if(excludeSet.size >= FIN_GLOSSARY.length) excludeSet.clear();
    const pool = FIN_GLOSSARY.map((_,i)=>i).filter(i=>!excludeSet.has(i));
    const candidates = pool.length ? pool : FIN_GLOSSARY.map((_,i)=>i);
    const weights = candidates.map(i=>contextWeight(FIN_GLOSSARY[i].tags, ctx));
    const idx = candidates[weightedPickIndex(weights)];
    excludeSet.add(idx);
    const item = FIN_GLOSSARY[idx];
    return {
      idx,
      text: `${item.term} — ${item.def}`,
      mood: 'idle',
      actions: [ { label:'Another term', kind:'glossary' }, { label:'Menu', kind:'menu' } ]
    };
  }

  /* ---------- 6. "how am I doing" check-in (+ spending-pace projection) ---------- */

  function getHealthMessage(ctx){
    const parts = [];
    if(ctx.curIncome>0){
      parts.push(`This month: ${fmtSafe(ctx.curIncome)} in, ${fmtSafe(ctx.curExp)} out.`);
      if(ctx.savingsRatePct!==null){
        parts.push(ctx.savingsRatePct>=0
          ? `That's roughly a ${ctx.savingsRatePct}% savings rate so far.`
          : `You've spent about ${Math.abs(ctx.savingsRatePct)}% more than you've brought in this month.`);
      }
    } else if(ctx.curExp>0){
      parts.push(`No income logged yet this month, but ${fmtSafe(ctx.curExp)} in expenses so far.`);
    } else {
      parts.push("Nothing logged for this month yet.");
    }
    if(ctx.spendingDeltaPct!==null){
      parts.push(ctx.spendingDeltaPct>0
        ? `Spending is up ${ctx.spendingDeltaPct}% versus last month.`
        : ctx.spendingDeltaPct<0
          ? `Spending is down ${Math.abs(ctx.spendingDeltaPct)}% versus last month.`
          : `Spending is about the same as last month.`);
    }
    if(ctx.topCategory){
      parts.push(`Biggest category this month: ${ctx.topCategory.label} (${fmtSafe(ctx.topCategory.amount)}).`);
    }
    if(ctx.budgetLimit>0 && ctx.curExp>0){
      parts.push(`At this pace, you're on track for about ${fmtSafe(ctx.projectedSpend)} by month-end${ctx.projectedOverBudget ? ' — over your '+fmtSafe(ctx.budgetLimit)+' budget' : ', within your '+fmtSafe(ctx.budgetLimit)+' budget'}.`);
    }
    if(ctx.totalPayable>0){
      parts.push(`Still owed on loans: ${fmtSafe(ctx.totalPayable)}.`);
    }
    if(ctx.streakDays>=2){
      parts.push(`You've logged expenses ${ctx.streakDays} days in a row.`);
    }
    const bestLine = getPersonalBestLine(ctx);
    if(bestLine) parts.push(bestLine);
    const mood = (ctx.overBudget || ctx.projectedOverBudget || (ctx.savingsRatePct!==null && ctx.savingsRatePct<0)) ? 'concerned'
      : (ctx.savingsRatePct!==null && ctx.savingsRatePct>=20) ? 'happy' : 'idle';
    return {
      text: parts.join(' '),
      mood,
      actions: [ { label:'Another check-in', kind:'health' }, { label:'Menu', kind:'menu' } ]
    };
  }

  /* ---------- 7. milestones & streaks ---------- */

  // Fires off the app's own custom events (dispatched from the handful of
  // places in index.html that matter — see fin:goal-progress/fin:loan-settled)
  // rather than parsing the toast copy shown to the user. A copy edit to a
  // toast string can no longer silently break these.
  function getGoalReachedMessage(goal){
    const name = goal && goal.name;
    const label = name ? `"${name}"` : 'your goal';
    const amtText = goal && goal.target>0 ? ` — ${fmtSafe(goal.target)} saved in full` : '';
    return { text: `You just hit ${label}${amtText}! That's worth celebrating. 🎉`, mood:'happy' };
  }
  function getLoanSettledMessage(loan, wasPaidToZero){
    // loan.amount is the outstanding balance, which is usually already 0 by
    // the time this event fires — only mention it when it's genuinely
    // still populated (some settle paths pass the pre-zeroed object).
    const amtText = loan && loan.amount>0 ? ` (${fmtSafe(loan.amount)})` : '';
    const name = loan && loan.name ? `"${loan.name}"` : 'that loan';
    if(wasPaidToZero){
      return { text:`${name}${amtText} is fully paid off now. Nice work chipping away at it.`, mood:'happy' };
    }
    return { text:`One less thing hanging over you — ${name}${amtText} is settled.`, mood:'happy' };
  }

  // Reacts to a handful of specific, first-time or otherwise notable
  // actions with a concrete "here's a sensible next step" — driven by the
  // same app-dispatched event name + detail as the functions above, not by
  // matching substrings of the toast copy. Each returns a `key` so pet.js
  // can show one-time tips only once ever.
  function getPostActionMessage(eventName, detail, ctx){
    detail = detail || {};
    if(eventName==='fin:wallet-added' && ctx.counts.wallets===1){
      return { key:'wallet-first', text:"First wallet's in. Add some income next so the balance actually reflects something.",
        actions:[ { label:'Add Income', kind:'navigate', module:'income', focus:'inc-amount' }, { label:'Later', kind:'dismiss' } ] };
    }
    if(eventName==='fin:income-added' && ctx.counts.income===1){
      return { key:'income-first', text:"Income's logged. Whenever you spend something, log it as an expense to keep the full picture.",
        actions:[ { label:'Add Expense', kind:'navigate', module:'expenses', focus:'exp-desc' }, { label:'Later', kind:'dismiss' } ] };
    }
    if(eventName==='fin:goal-added' && ctx.counts.goals===1){
      return { key:'goal-first', text:"First goal's set. Add to it any time you save something extra — even small amounts count toward it.", mood:'happy' };
    }
    if(eventName==='fin:budget-saved'){
      return { key:'budget-first', text:"Good — if spending gets close to that limit this month, I'll flag it here." };
    }
    if(eventName==='fin:loan-added'){
      const loan = detail.loan;
      if(loan && !loan.due){
        return { key:'loan-due-tip', text:"Tip: a loan with no due date won't get flagged if it runs overdue — worth adding one if you know it." };
      }
    }
    return null;
  }

  const STREAK_LINES = {
    3: "3 days of logging in a row — a habit's forming.",
    7: "A full week of logging expenses. That kind of consistency is what makes a budget actually work.",
    14: "Two weeks straight. You'll have a real picture of your spending soon.",
    30: "A whole month of logging every expense — that's a genuinely strong habit.",
    60: "60 days in a row. At this point you probably know your spending patterns better than most people do.",
    100: "100 days straight. That's not really a streak anymore — that's just how you handle money now."
  };

  function getStreakCelebration(days){
    const line = STREAK_LINES[days];
    if(!line) return null;
    return { text: line, mood:'happy' };
  }

  /* ---------- 8. real-time budget alerts ----------
     Triggered by pet.js the moment an "Expense logged" toast fires, so
     the person hears about it right when it happens instead of only on
     their next dashboard visit. level is 75 or 100. */

  function getBudgetAlertMessage(ctx, level){
    if(level>=100){
      const overBy = ctx.curExp - ctx.budgetLimit;
      return {
        text:`Heads up — that pushed you to ${ctx.budgetPct}% of this month's ${fmtSafe(ctx.budgetLimit)} budget, ${fmtSafe(overBy)} over.`,
        mood:'concerned',
        actions:[ { label:'Check Budget', kind:'navigate', module:'goals' }, { label:'Menu', kind:'menu' } ]
      };
    }
    const leftAmt = ctx.budgetLimit - ctx.curExp;
    return {
      text:`Just logged — that puts you at ${ctx.budgetPct}% of this month's budget, ${fmtSafe(leftAmt)} left.`,
      mood:'idle',
      actions:[ { label:'Check Budget', kind:'navigate', module:'goals' }, { label:'Menu', kind:'menu' } ]
    };
  }

  /* ---------- 9. weekly recap + stale-goal nudges ---------- */

  function getWeeklyRecapMessage(ctx){
    if(!ctx.weekExpenseCount) return null;
    const parts = [`New week — quick recap: ${fmtSafe(ctx.weeklyExpenseTotal)} spent over the last 7 days.`];
    if(ctx.weeklyTopCategory){
      parts.push(`Most of it went to ${ctx.weeklyTopCategory.label} (${fmtSafe(ctx.weeklyTopCategory.amount)}).`);
    }
    if(ctx.streakDays>=2){
      parts.push(`You're on a ${ctx.streakDays}-day logging streak.`);
    }
    return {
      text: parts.join(' '),
      mood:'idle',
      actions:[ { label:'Full check-in', kind:'health' }, { label:'Menu', kind:'menu' } ]
    };
  }

  // goal is the real goal object (from state.goals); daysSince comes from
  // pet.js's own localStorage-backed progress tracking, since the app's
  // goal objects don't carry a "last added to" timestamp.
  function getGoalNudgeMessage(goal, daysSince){
    if(!goal) return null;
    return {
      text:`"${goal.name}" hasn't had anything added in ${daysSince} days — even a small top-up keeps it moving.`,
      actions:[ { label:'Add to Goal', kind:'navigate', module:'goals' }, { label:'Menu', kind:'menu' } ]
    };
  }

  /* ---------- 10. first-run onboarding walkthrough ----------
     Instead of one static "hi, I'm Fin" line, a short per-module intro
     plays the first time the person visits each core module, in
     whatever order they actually navigate. */

  const ONBOARDING_STEPS = [
    { module:'dashboard', text:"Hi, I'm Fin! I'll point things out as you explore FINUITY. Try adding a wallet first — everything else tracks against one." },
    { module:'balances', text:"This is where your wallets live — think of them as accounts. Add one here to get started." },
    { module:'income', text:"Log income here whenever money comes in. Pick a wallet and it'll update that wallet's balance." },
    { module:'expenses', text:"Every purchase goes here. The more consistently you log, the more useful your numbers get." },
    { module:'loans', text:"Track money you owe or money owed to you here — add a due date and I'll flag it as it gets close." },
    { module:'goals', text:"Set a monthly budget and savings goals here. I'll flag it if spending gets close to the limit." }
  ];

  function getOnboardingStepMessage(moduleId){
    const step = ONBOARDING_STEPS.find(s=>s.module===moduleId);
    if(!step) return null;
    return { text: step.text, actions:[{ label:'Got it', kind:'dismiss' }] };
  }
  function getOnboardingModules(){
    return ONBOARDING_STEPS.map(s=>s.module);
  }

  /* ---------- 11. Fin settings menus ----------
     Pure formatting only — pet.js owns reading/writing the actual
     settings object to localStorage and passes it in here each time. */

  function getSettingsMessage(settings){
    return {
      text: "Fin settings",
      actions: [
        { label:'🔔 Notifications', kind:'settings-notifications' },
        { label:'🎨 Personalize', kind:'settings-personalize' },
        { label:'🏅 My Badges', kind:'badges' },
        { label:'🔒 Privacy', kind:'privacy' },
        { label:'Done', kind:'menu' }
      ]
    };
  }

  function getSettingsNotificationsMessage(settings){
    settings = settings || {};
    const freqLabel = settings.frequency==='quiet' ? 'Quiet' : settings.frequency==='chatty' ? 'Chatty' : 'Normal';
    return {
      text: `How often I speak up on my own: ${freqLabel}.`,
      actions: [
        { label:'🔈 Frequency: '+freqLabel, kind:'settings-frequency' },
        { label:(settings.muteTips?'🔕':'🔔')+' Idle tips', kind:'settings-toggle-tips' },
        { label:(settings.muteBudget?'🔕':'🔔')+' Budget alerts', kind:'settings-toggle-budget' },
        { label:(settings.muteInsights?'🔕':'🔔')+' Goal & weekly insights', kind:'settings-toggle-insights' },
        { label:(settings.pushEnabled?'🔔':'🔕')+' Notify me when the app is in the background', kind:'settings-toggle-push' },
        { label:'⬅ Back', kind:'settings' }
      ]
    };
  }

  function getSettingsPersonalizeMessage(settings){
    settings = settings || {};
    const toneLabel = settings.tone==='businesslike' ? 'businesslike' : 'playful';
    return {
      text: `I go by "${settings.name||'Fin'}" right now, ${toneLabel} tone.`,
      actions: [
        { label:'✏️ Rename me', kind:'settings-rename' },
        { label:'🎭 Tone: '+toneLabel, kind:'settings-toggle-tone' },
        { label:'⬅ Back', kind:'settings' }
      ]
    };
  }

  /* ---------- 12. pattern insights ----------
     The one layer that's actually looking at the person's own numbers
     instead of reciting general finance knowledge — a handful of cheap,
     honest pattern checks over real transaction history. Every check only
     fires when the underlying data genuinely supports it (real counts,
     real thresholds) and returns null rather than stretching for a story.
     Only one insight is returned per call, in priority order, so pet.js
     can space these out (roughly weekly) instead of piling them up. */

  const WEEKDAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  function monthTopCategory(monthsBack){
    const now = new Date();
    const md = new Date(now.getFullYear(), now.getMonth()-monthsBack, 1);
    const expenses = (appState().expenses||[]).filter(e=>{
      const d = new Date(e.date);
      return !isNaN(d) && d.getMonth()===md.getMonth() && d.getFullYear()===md.getFullYear();
    });
    if(!expenses.length) return null;
    const totals = {};
    expenses.forEach(e=>{ totals[e.cat] = (totals[e.cat]||0) + e.amount; });
    let cat=null, amt=0;
    Object.keys(totals).forEach(c=>{ if(totals[c]>amt){ amt=totals[c]; cat=c; } });
    return cat ? { cat, label:catLabel(cat), amount:amt } : null;
  }

  // Same calendar month, one year back — used for the "this happened
  // around this time last year" nudge, phrased forward-looking rather
  // than as a retrospective, so it reads as useful rather than nostalgic.
  function categorySpikeLastYear(){
    const now = new Date();
    const lastYear = now.getFullYear()-1;
    const allExpenses = appState().expenses||[];
    const sameMonthLastYear = allExpenses.filter(e=>{
      const d = new Date(e.date);
      return !isNaN(d) && d.getMonth()===now.getMonth() && d.getFullYear()===lastYear;
    });
    if(sameMonthLastYear.length<2) return null;
    const totals = {};
    sameMonthLastYear.forEach(e=>{ totals[e.cat] = (totals[e.cat]||0) + e.amount; });
    let topCat=null, topAmt=0;
    Object.keys(totals).forEach(c=>{ if(totals[c]>topAmt){ topAmt=totals[c]; topCat=c; } });
    if(!topCat) return null;
    // Compare against that same category's average across the *other* 11
    // months of last year — only worth mentioning if it was a real outlier.
    const otherMonthsTotals = {};
    const otherMonthsSeen = new Set();
    allExpenses.forEach(e=>{
      const d = new Date(e.date);
      if(isNaN(d) || d.getFullYear()!==lastYear || d.getMonth()===now.getMonth() || e.cat!==topCat) return;
      otherMonthsTotals[d.getMonth()] = (otherMonthsTotals[d.getMonth()]||0) + e.amount;
      otherMonthsSeen.add(d.getMonth());
    });
    if(otherMonthsSeen.size<3) return null; // not enough of last year on record to call it a pattern
    const otherAvg = Object.values(otherMonthsTotals).reduce((a,b)=>a+b,0) / otherMonthsSeen.size;
    if(otherAvg<=0 || topAmt < otherAvg*1.5) return null;
    return { cat:topCat, label:catLabel(topCat), amount:topAmt, monthName: now.toLocaleString('en-US',{month:'long'}) };
  }

  function weekdayConcentration(){
    const todayStr = safe(()=>global.today(), null);
    if(!todayStr) return null;
    const cutoff = new Date(todayStr+'T00:00:00');
    cutoff.setDate(cutoff.getDate()-60);
    const cutoffStr = toLocalISO(cutoff);
    const recent = (appState().expenses||[]).filter(e=> e.date>cutoffStr && e.date<=todayStr);
    if(recent.length<8) return null;

    // Focus on whichever category has the most transactions in the window,
    // then check whether one weekday dominates *that* category specifically
    // — "more food expenses on Fridays" is a sharper, more useful signal
    // than "you spend more overall on Fridays" (which is often just payday).
    const catCounts = {};
    recent.forEach(e=>{ catCounts[e.cat] = (catCounts[e.cat]||0)+1; });
    let focusCat=null, focusCount=0;
    Object.keys(catCounts).forEach(c=>{ if(catCounts[c]>focusCount){ focusCount=catCounts[c]; focusCat=c; } });
    if(!focusCat || focusCount<4) return null;

    const catExpenses = recent.filter(e=>e.cat===focusCat);
    const byWeekday = [0,0,0,0,0,0,0];
    catExpenses.forEach(e=>{
      const d = new Date(e.date+'T00:00:00');
      if(!isNaN(d)) byWeekday[d.getDay()]++;
    });
    let topDay=0, topCount=0;
    byWeekday.forEach((c,i)=>{ if(c>topCount){ topCount=c; topDay=i; } });
    if(topCount<3 || topCount/catExpenses.length<0.4) return null;
    return { dayName: WEEKDAY_NAMES[topDay], catLabel: catLabel(focusCat), count: topCount, totalInCat: catExpenses.length };
  }

  function getPatternInsight(){
    // 1. Category streak — same top category three months running.
    const m0 = monthTopCategory(0), m1 = monthTopCategory(1), m2 = monthTopCategory(2);
    if(m0 && m1 && m2 && m0.cat===m1.cat && m1.cat===m2.cat){
      return {
        text:`This is the third month in a row ${m0.label} has been your top category. Worth checking your overall budget actually accounts for that.`,
        mood:'idle',
        actions:[ { label:'Check Budget', kind:'navigate', module:'goals' }, { label:'View Expenses', kind:'navigate', module:'expenses' }, { label:'Menu', kind:'menu' } ]
      };
    }
    // 2. Same-time-last-year spike — only worth surfacing in the first
    // third of the month, while there's still time to plan around it.
    const now = new Date();
    if(now.getDate()<=10){
      const spike = categorySpikeLastYear();
      if(spike){
        return {
          text:`Last year in ${spike.monthName}, ${spike.label} ran noticeably higher than usual (${fmtSafe(spike.amount)}). Might be worth budgeting for again if it's a recurring one.`,
          mood:'idle',
          actions:[ { label:'Check Budget', kind:'navigate', module:'goals' }, { label:'Menu', kind:'menu' } ]
        };
      }
    }
    // 3. Weekday concentration within a single category.
    const wd = weekdayConcentration();
    if(wd){
      return {
        text:`You've logged more ${wd.catLabel} expenses on ${wd.dayName}s than any other day over the last couple months (${wd.count} of ${wd.totalInCat}). Worth budgeting for on purpose rather than by surprise.`,
        mood:'idle',
        actions:[ { label:'View Expenses', kind:'navigate', module:'expenses' }, { label:'Menu', kind:'menu' } ]
      };
    }
    return null;
  }

  /* ---------- 13. personal bests (compare-to-self) ----------
     bestSavingsRatePct / longestStreakEver are tracked and persisted by
     pet.js (state.goals etc. carry no history), then passed in on ctx —
     this file only formats them. Comparisons are always against the
     person's own past, never anyone else's. */

  function getPersonalBestLine(ctx){
    if(ctx.savingsRatePct!==null && ctx.bestSavingsRatePct!==undefined && ctx.bestSavingsRatePct!==null
       && ctx.savingsRatePct>=ctx.bestSavingsRatePct && ctx.savingsRatePct>0){
      return `That's your best savings month yet.`;
    }
    if(ctx.streakDays>=2 && ctx.longestStreakEver!==undefined && ctx.streakDays>=ctx.longestStreakEver){
      return `Also your longest logging streak so far.`;
    }
    return null;
  }

  function getNewBestCelebration(kind, value){
    if(kind==='savings'){
      return { text:`New personal best — a ${value}% savings rate this month, your highest yet.`, mood:'happy' };
    }
    if(kind==='streak'){
      return { text:`${value} days — that's your longest logging streak yet.`, mood:'happy' };
    }
    return null;
  }

  /* ---------- 14. Ask Fin (local, pattern-matched, no network) ----------
     A small set of questions Fin can answer instantly from state — not an
     LLM integration, just direct lookups against the same context/state
     this file already builds. Unmatched questions get an honest "don't
     know that one" rather than a guess. */

  function getAskMenuMessage(){
    return {
      text:"Ask me something — or type your own.",
      actions:[
        { label:'Spent on food this month?', kind:'ask', query:'how much did i spend on food this month' },
        { label:'Next loan due?', kind:'ask', query:'next loan due' },
        { label:'Saving more than last month?', kind:'ask', query:'saving more than last month' },
        { label:'Type a question', kind:'ask-custom' },
        { label:'Menu', kind:'menu' }
      ]
    };
  }

  function answerQuestion(qRaw, ctx){
    const q = (qRaw||'').toLowerCase();
    if(!q.trim()){
      return { text:"Didn't catch a question there — try asking about spending, budget, or loans.", actions:[{label:'Menu',kind:'menu'}] };
    }

    // "how much on [category] this/last month"
    const catKeys = Object.keys(ctx.catTotals||{});
    const mentionedCat = catKeys.find(c=> q.indexOf(c.replace('-',' '))!==-1 || q.indexOf(c)!==-1 )
      || (q.indexOf('food')!==-1 ? 'food' : q.indexOf('transport')!==-1 ? 'transport'
      : q.indexOf('shopping')!==-1 ? 'shopping' : q.indexOf('utilit')!==-1 ? 'utilities'
      : q.indexOf('health')!==-1 ? 'health' : q.indexOf('entertain')!==-1 ? 'entertainment' : null);
    if(mentionedCat && (q.indexOf('spend')!==-1 || q.indexOf('spent')!==-1 || q.indexOf('how much')!==-1)){
      const amt = (ctx.catTotals||{})[mentionedCat] || 0;
      return { text: amt>0 ? `${fmtSafe(amt)} on ${catLabel(mentionedCat)} this month.` : `Nothing logged under ${catLabel(mentionedCat)} this month yet.`,
        actions:[{label:'Menu',kind:'menu'}] };
    }

    if(q.indexOf('loan')!==-1 && (q.indexOf('next')!==-1 || q.indexOf('due')!==-1)){
      if(ctx.overdueLoan) return { text:`"${ctx.overdueLoan.name}" is already past due.`, mood:'concerned', actions:[{label:'View Loans',kind:'navigate',module:'loans'},{label:'Menu',kind:'menu'}] };
      if(ctx.dueSoonLoan){
        const l = ctx.dueSoonLoan;
        const when = l.daysUntil<=0 ? 'today' : l.daysUntil===1 ? 'tomorrow' : `in ${l.daysUntil} days`;
        return { text:`"${l.name}" is due ${when}.`, actions:[{label:'View Loans',kind:'navigate',module:'loans'},{label:'Menu',kind:'menu'}] };
      }
      return { text: ctx.payableCount>0 ? "Nothing due in the next few days, though you still have loans outstanding." : "No upcoming loans due.", actions:[{label:'Menu',kind:'menu'}] };
    }

    if(q.indexOf('saving')!==-1 && q.indexOf('last month')!==-1){
      if(ctx.spendingDeltaPct===null) return { text:"Not enough last-month data to compare yet.", actions:[{label:'Menu',kind:'menu'}] };
      return { text: ctx.spendingDeltaPct<0 ? `Yes — spending is down ${Math.abs(ctx.spendingDeltaPct)}% versus last month.` : ctx.spendingDeltaPct>0 ? `Not quite — spending is up ${ctx.spendingDeltaPct}% versus last month.` : "About the same as last month.",
        actions:[{label:'Menu',kind:'menu'}] };
    }

    if(q.indexOf('budget')!==-1 && (q.indexOf('left')!==-1 || q.indexOf('remain')!==-1)){
      if(!ctx.budgetLimit) return { text:"No budget set yet for this month.", actions:[{label:'Set Budget',kind:'navigate',module:'goals'},{label:'Menu',kind:'menu'}] };
      const left = ctx.budgetLimit-ctx.curExp;
      return { text: left>=0 ? `${fmtSafe(left)} left in this month's budget.` : `${fmtSafe(Math.abs(left))} over this month's budget.`, mood: left<0?'concerned':'idle',
        actions:[{label:'Menu',kind:'menu'}] };
    }

    if(q.indexOf('streak')!==-1){
      return { text: ctx.streakDays>0 ? `${ctx.streakDays}-day logging streak right now.` : "No active streak — log an expense today to start one.", actions:[{label:'Menu',kind:'menu'}] };
    }

    // Wallet balances.
    if(q.indexOf('wallet')!==-1 && (q.indexOf('balance')!==-1 || q.indexOf('how much')!==-1 || q.indexOf('have')!==-1)){
      const wallets = appState().wallets||[];
      if(!wallets.length) return { text:"No wallets set up yet.", actions:[{label:'Add Wallet',kind:'navigate',module:'balances'},{label:'Menu',kind:'menu'}] };
      const lines = wallets.map(w=> `${w.label}: ${fmtSafe(w.balance)}`);
      return { text: lines.join(', ')+'.', actions:[{label:'Menu',kind:'menu'}] };
    }

    // Total upcoming recurring bills.
    if(q.indexOf('recurring')!==-1 || q.indexOf('bill')!==-1){
      const expenses = appState().expenses||[];
      const recurringDescs = [...new Set(expenses.filter(e=>e.recurring).map(e=>e.desc))];
      if(!recurringDescs.length) return { text:"No recurring expenses set up yet.", actions:[{label:'Menu',kind:'menu'}] };
      let total = 0;
      recurringDescs.forEach(desc=>{
        const matches = expenses.filter(e=>e.recurring && e.desc===desc);
        if(matches.length) total += matches[matches.length-1].amount;
      });
      return { text: `${recurringDescs.length} recurring expense${recurringDescs.length>1?'s':''} totalling about ${fmtSafe(total)} a month.`, actions:[{label:'Menu',kind:'menu'}] };
    }

    // Income-vs-expense ratio.
    if(q.indexOf('ratio')!==-1 || (q.indexOf('income')!==-1 && q.indexOf('expense')!==-1)){
      if(!ctx.curIncome) return { text:"No income logged yet this month to compare against.", actions:[{label:'Menu',kind:'menu'}] };
      const ratioPct = Math.round((ctx.curExp/ctx.curIncome)*100);
      return { text:`You've spent about ${ratioPct}% of what you've earned this month (${fmtSafe(ctx.curExp)} of ${fmtSafe(ctx.curIncome)}).`, actions:[{label:'Menu',kind:'menu'}] };
    }

    // Projected "how much left this month" — pace-based, not just literal-to-date.
    if(q.indexOf('left')!==-1 && q.indexOf('month')!==-1){
      if(!ctx.curIncome) return { text:"No income logged yet this month to project against.", actions:[{label:'Menu',kind:'menu'}] };
      const projectedLeft = ctx.curIncome - (ctx.projectedSpend!==undefined && ctx.projectedSpend!==null ? ctx.projectedSpend : ctx.curExp);
      return { text: projectedLeft>=0
          ? `At this pace, about ${fmtSafe(projectedLeft)} left by month-end.`
          : `At this pace, you're projected to be ${fmtSafe(Math.abs(projectedLeft))} short by month-end.`,
        mood: projectedLeft<0?'concerned':'idle',
        actions:[{label:'Menu',kind:'menu'}] };
    }

    return { text:"I'm not sure about that one yet — I can answer things like spending by category, upcoming loans, budget left, wallet balances, recurring bills, or how this month compares to last.", actions:[{label:'Menu',kind:'menu'}] };
  }

  /* ---------- 15. on-device / privacy line ---------- */

  function getPrivacyMessage(){
    if(isSyncing()){
      return {
        text:"I don't make any network calls myself — everything I look at (your entries, patterns, everything) comes straight from this app's own data. Since you're signed in, though, FINUITY itself does back that data up to your account so it's there on your other devices too.",
        actions:[ { label:'Menu', kind:'menu' } ]
      };
    }
    return {
      text:"Everything I look at lives on this device — your entries, patterns, everything. You're using FINUITY as a guest right now, so none of it leaves this device.",
      actions:[ { label:'Menu', kind:'menu' } ]
    };
  }

  /* ---------- 16. badges (persistent milestone shelf) ----------
     pet.js owns which badges have been earned (localStorage) and passes
     the list in; this just formats them for the bubble. */

  const BADGE_DEFS = {
    'first-month-budgeted': { icon:'🎯', label:'Set your first monthly budget' },
    'loan-free': { icon:'🏁', label:'Paid off a loan in full' },
    'streak-7': { icon:'🔥', label:'7-day logging streak' },
    'streak-30': { icon:'⭐', label:'30-day logging streak' },
    'goal-hit': { icon:'🏆', label:'Reached a savings goal' },
    'best-saver': { icon:'📈', label:'New personal-best savings month' }
  };

  function getBadgesMessage(badgeIds){
    badgeIds = badgeIds || [];
    if(!badgeIds.length){
      return { text:"No badges yet — these show up as you hit real milestones (streaks, paid-off loans, goals reached).", actions:[{label:'Menu',kind:'menu'}] };
    }
    const lines = badgeIds.map(id=>{
      const def = BADGE_DEFS[id];
      return def ? `${def.icon} ${def.label}` : null;
    }).filter(Boolean);
    return { text: lines.join('\n'), actions:[{label:'Menu',kind:'menu'}] };
  }

  /* ---------- 17. proactive nudges ----------
     Pace-based early warnings, a surplus-to-goal suggestion, data-freshness
     checks, and the lighter "since you were last here" cousin of the
     weekly recap. Any history these need (last budget-set time, last
     visit, per-loan last-touched) is tracked and persisted by pet.js and
     passed in as plain values — this file only formats the message. */

  function getPaceWarningMessage(ctx, timePct){
    return {
      text:`You're ${timePct}% through the month but already at ${ctx.budgetPct}% of budget — worth watching if that pace holds.`,
      mood:'idle',
      actions:[ { label:'Check Budget', kind:'navigate', module:'goals' }, { label:'Menu', kind:'menu' } ]
    };
  }

  function getSurplusSuggestionMessage(goal, surplus){
    const amt = Math.floor(surplus);
    return {
      text:`Income minus this month's budget leaves about ${fmtSafe(amt)} unaccounted for. Want to put some of it toward "${goal.name}"?`,
      actions:[
        { label:'Add '+fmtSafe(amt)+' now', kind:'goal-quick-add', goalId:goal.id, amount:amt },
        { label:'View Goal', kind:'navigate', module:'goals' },
        { label:'Menu', kind:'menu' }
      ]
    };
  }

  function getSinceLastHereMessage(days, ctx){
    const todayStr = safe(()=>global.today(), null);
    if(!todayStr) return null;
    const cutoff = new Date(todayStr+'T00:00:00');
    cutoff.setDate(cutoff.getDate()-days);
    const cutoffStr = toLocalISO(cutoff);
    const expenses = (appState().expenses||[]).filter(e=> e.date>cutoffStr && e.date<=todayStr);
    if(!expenses.length){
      return { text:`Welcome back — it's been ${days} day${days===1?'':'s'}. Nothing logged in that time.`, actions:[{label:'Menu',kind:'menu'}] };
    }
    const total = expenses.reduce((a,b)=>a+b.amount,0);
    return {
      text:`Welcome back — it's been ${days} day${days===1?'':'s'}. ${fmtSafe(total)} logged across ${expenses.length} expense${expenses.length===1?'':'s'} since then.`,
      mood:'idle',
      actions:[ { label:'Full check-in', kind:'health' }, { label:'Menu', kind:'menu' } ]
    };
  }

  function getStreakRiskMessage(ctx){
    return {
      text:`Evening check — your ${ctx.streakDays}-day logging streak is still alive, but nothing's logged today yet.`,
      mood:'idle',
      actions:[ { label:'Add Expense', kind:'navigate', module:'expenses', focus:'exp-desc' }, { label:'Menu', kind:'menu' } ]
    };
  }

  function getIncomeStaleMessage(ctx){
    return {
      text:"No income logged yet this month. If that's not right, it's quietly throwing off your savings rate and budget pace — both are treating this month as ₱0 in.",
      mood:'concerned',
      actions:[ { label:'Add Income', kind:'navigate', module:'income', focus:'inc-amount' }, { label:'Menu', kind:'menu' } ]
    };
  }

  function getBudgetStaleMessage(ctx, diffPct){
    const over = ctx.curExp>ctx.budgetLimit;
    return {
      text:`Your budget's been ${fmtSafe(ctx.budgetLimit)} for a while now, but actual spending has been running about ${Math.round(diffPct*100)}% ${over?'over':'under'} that. Might be worth revisiting.`,
      actions:[ { label:'Update Budget', kind:'navigate', module:'goals' }, { label:'Menu', kind:'menu' } ]
    };
  }

  function getWalletStaleMessage(staleWallet){
    const daysText = staleWallet.days!==null ? staleWallet.days+' days' : 'a long while';
    return {
      text:`"${staleWallet.wallet.label}" hasn't had any income or expenses logged against it in ${daysText}. Worth checking its balance is still accurate.`,
      actions:[ { label:'View Balances', kind:'navigate', module:'balances' }, { label:'Menu', kind:'menu' } ]
    };
  }

  function getLoanIdleMessage(loan, days){
    return {
      text:`"${loan.name}" (${loan.type==='payable'?'you owe':'owed to you'}) hasn't moved in ${days} days and has no due date set — easy to lose track of.`,
      actions:[ { label:'View Loans', kind:'navigate', module:'loans' }, { label:'Menu', kind:'menu' } ]
    };
  }

  function getCarryoverMessage(amount){
    return {
      text:`New month, no budget set yet. Carry over last time's ${fmtSafe(amount)} limit?`,
      actions:[
        { label:'Carry Over '+fmtSafe(amount), kind:'carry-over-budget', amount:amount },
        { label:'Set a New One', kind:'navigate', module:'goals' },
        { label:'No thanks', kind:'dismiss' }
      ]
    };
  }

  /* ---------- 18. reactions to previously-silent real actions ----------
     A bigger-than-usual expense, a partial top-up toward a goal, and a
     partial loan payment all used to produce nothing more than the
     generic good-news bounce (or, for goal top-ups and loan paydowns,
     literally nothing at all). These give each one its own specific,
     number-driven line. */

  function getExpenseSpikeMessage(expense, avgAmount){
    const label = catLabel(expense.cat);
    const pctOver = avgAmount>0 ? Math.round(((expense.amount-avgAmount)/avgAmount)*100) : null;
    const cmp = pctOver!==null ? ` — about ${pctOver}% more than you usually spend there` : '';
    return {
      text:`That's a bigger ${label} expense than usual (${fmtSafe(expense.amount)}${cmp}).`,
      mood:'idle',
      actions:[ { label:'View Expenses', kind:'navigate', module:'expenses' }, { label:'Menu', kind:'menu' } ]
    };
  }

  function getGoalProgressMessage(goal, added, pct){
    return {
      text:`"${goal.name}" just crossed ${pct}% of its ${fmtSafe(goal.target)} target — that last ${fmtSafe(added)} moved it forward.`,
      mood:'idle',
      actions:[ { label:'Add More', kind:'navigate', module:'goals' }, { label:'Menu', kind:'menu' } ]
    };
  }

  function getLoanPaymentMessage(loan, paid){
    return {
      text:`${fmtSafe(paid)} just went toward "${loan.name}" — ${fmtSafe(loan.amount)} left on it.`,
      mood:'idle',
      actions:[ { label:'View Loans', kind:'navigate', module:'loans' }, { label:'Menu', kind:'menu' } ]
    };
  }

  function getRecurringMissingMessage(items){
    if(!items || !items.length) return null;
    const actions = [];
    items.slice(0,2).forEach(it=>{
      actions.push({ label:'Log '+it.desc+' ('+fmtSafe(it.amount)+')', kind:'log-recurring', templateId:it.templateId });
    });
    actions.push({ label:'View Expenses', kind:'navigate', module:'expenses' });
    actions.push({ label:'Menu', kind:'menu' });
    const text = items.length===1
      ? `Looks like "${items[0].desc}" hasn't been logged yet this month.`
      : `${items.length} recurring expenses haven't been logged yet this month.`;
    return { text, actions };
  }

  /* ---------- 17. instant reactions to everything the person does ----------
     Short one-liners (plus a mood) for each real action in the app. pet.js
     calls getReaction(kind, data, ctx, tone) the moment something happens —
     from the app's fin:* events, from toast() text, or from a wrapped
     function — and decides whether there's room to actually speak. Lines
     that need data return null when the data isn't there, and the next
     candidate is tried instead. */
  function rLine(list, d, c){
    if(typeof list==='function') list = safe(function(){ return list(d,c); }, []) || [];
    var arr = list.slice();
    while(arr.length){
      var i = Math.floor(Math.random()*arr.length);
      var it = arr.splice(i,1)[0];
      var out = typeof it==='function' ? safe(function(){ return it(d,c); }, null) : it;
      if(out) return out;
    }
    return null;
  }
  function walletNameById(id){
    var ws = appState().wallets || [];
    for(var i=0;i<ws.length;i++){ if(ws[i] && ws[i].id===id) return ws[i].label; }
    return null;
  }
  function pctOf(n,total){ return total>0 ? Math.round((n/total)*100) : null; }
  function bigExpense(d,c){ return !d.recurring && c.budgetLimit>0 && d.amount>0 && d.amount/c.budgetLimit>=0.2; }
  function lastWord(s){ return String(s||'').trim(); }

  var REACT = {
    /* --- logging money in/out --- */
    'expense': {
      mood:function(d,c){ return bigExpense(d,c) ? 'surprised' : 'happy'; },
      fun:function(d,c){
        if(bigExpense(d,c)) return ['Whoa — '+fmtSafe(d.amount)+' is '+pctOf(d.amount,c.budgetLimit)+"% of your whole monthly budget. Logged — let's keep an eye on the rest of the month."];
        if(d.recurring) return ['Recurring one handled: '+lastWord(d.desc)+' ('+fmtSafe(d.amount)+'). Less to remember!'];
        return [
          'Logged! '+fmtSafe(d.amount)+' on '+catLabel(d.cat)+'.',
          'Got it — "'+lastWord(d.desc)+'" for '+fmtSafe(d.amount)+'.',
          function(){ return c.budgetPct!=null ? 'Noted! You are at '+c.budgetPct+"% of this month's budget." : null; },
          function(){ return c.streakDays>=2 ? c.streakDays+'-day logging streak — nice consistency!' : null; },
          'Every entry keeps the picture honest. Thanks for logging it!'
        ];
      },
      biz:function(d,c){ return ['Expense recorded: '+fmtSafe(d.amount)+' ('+catLabel(d.cat)+').', c.budgetPct!=null ? 'Recorded. Budget used this month: '+c.budgetPct+'%.' : null]; }
    },
    'income': {
      mood:'happy',
      fun:function(d){ var w = walletNameById(d.walletId); return [
        fmtSafe(d.amount)+' in! '+(w ? w+' just got heavier.' : 'Nice one!'),
        'Income logged — '+fmtSafe(d.amount)+(w ? ' into '+w : '')+'. Love to see it!',
        'Money in: '+fmtSafe(d.amount)+'. Remember to set some aside for your goals!' ]; },
      biz:function(d){ return ['Income recorded: '+fmtSafe(d.amount)+'.']; }
    },
    'loan-added': {
      mood:function(d){ return d.loan && d.loan.type==='receivable' ? 'happy' : 'thinking'; },
      fun:function(d){
        var l = d.loan || {};
        return l.type==='receivable'
          ? ['Noted — '+lastWord(l.name)+' owes you '+fmtSafe(l.amount)+". I'll help you keep track."]
          : ['Logged: you owe '+lastWord(l.name)+' '+fmtSafe(l.amount)+". Let's plan to clear it!"];
      },
      biz:function(d){ var l = d.loan || {}; return ['Loan recorded: '+lastWord(l.name)+', '+fmtSafe(l.amount)+'.']; }
    },
    'loan-adjusted': {
      mood:'happy',
      fun:function(d){ var l = d.loan || {}; return [lastWord(l.name)+"'s loan now stands at "+fmtSafe(l.amount)+'.']; },
      biz:function(d){ var l = d.loan || {}; return ['Loan balance updated: '+fmtSafe(l.amount)+' outstanding.']; }
    },
    'loan-settled': {
      mood:'happy',
      fun:['Loan closed out — one less thing on your mind!', 'Settled! That feels good, right?'],
      biz:['Loan marked as settled.']
    },
    'wallet-added': {
      mood:'happy',
      fun:function(d){ return ['New wallet "'+lastWord(d.name)+'" is ready — put some money in it!', '"'+lastWord(d.name)+'" added. More places to track = clearer picture.']; },
      biz:function(d){ return ['Wallet added: '+lastWord(d.name)+'.']; }
    },
    'goal-added': {
      mood:'happy',
      fun:function(d){ var g = d.goal || {}; return ['Goal set: '+lastWord(g.name)+' ('+fmtSafe(g.target)+"). Small top-ups add up!", 'A new goal! '+lastWord(g.name)+" — let's chip away at it."]; },
      biz:function(d){ var g = d.goal || {}; return ['Goal created: '+lastWord(g.name)+', target '+fmtSafe(g.target)+'.']; }
    },
    'goal-progress': {
      mood:'happy',
      fun:function(d){
        var g = d.goal || {};
        var p = pctOf(g.saved, g.target);
        if(d.reached) return ['You did it — '+lastWord(g.name)+' is fully funded! 🎉'];
        return [
          fmtSafe(d.amountAdded)+' closer to '+lastWord(g.name)+(p!=null ? ' — '+p+'% there!' : '!'),
          'Top-up added to '+lastWord(g.name)+(p!=null ? ' ('+p+'%)' : '')+'. Keep going!'
        ];
      },
      biz:function(d){ var g = d.goal || {}; var p = pctOf(g.saved, g.target); return ['Goal updated: '+lastWord(g.name)+(p!=null ? ', '+p+'% funded.' : '.')]; }
    },
    'budget-saved': {
      mood:'happy',
      fun:function(d){
        var out = [];
        if(d.previous>0 && d.amount<d.previous) out.push('Budget lowered to '+fmtSafe(d.amount)+' — tightening the belt. I like the ambition!');
        else if(d.previous>0 && d.amount>d.previous) out.push('Budget raised to '+fmtSafe(d.amount)+' — a bit more breathing room.');
        else out.push('Budget set to '+fmtSafe(d.amount)+'. Now I can watch the pace for you!');
        return out;
      },
      biz:function(d){ return ['Monthly budget set to '+fmtSafe(d.amount)+'.']; }
    },

    /* --- edits, removals and other changes (detected from toasts) --- */
    'income-edited':  { mood:'happy', fun:['Income entry updated — accurate books are happy books.', 'Fixed! Income entry saved.'], biz:['Income entry updated.'] },
    'expense-edited': { mood:'happy', fun:['Expense updated — thanks for keeping it accurate.', 'Edit saved!'], biz:['Expense entry updated.'] },
    'loan-edited':    { mood:'happy', fun:['Loan details updated.', 'Got the new loan details!'], biz:['Loan updated.'] },
    'goal-edited':    { mood:'happy', fun:['Goal updated — new target, new plan!', 'Goal changes saved.'], biz:['Goal updated.'] },
    'goal-removed':   { mood:'concerned', fun:["Goal removed. If plans change, that's okay — you can always set a new one.", 'Goal deleted.'], biz:['Goal removed.'] },
    'removed-income':   { mood:'thinking', fun:['Income entry removed — and the wallet balance was adjusted to match.', 'Deleted. Balances are back in sync.'], biz:['Income entry removed; wallet balance adjusted.'] },
    'removed-expenses': { mood:'thinking', fun:['Expense removed — the money went back to its wallet.', 'Deleted. Balances are back in sync.'], biz:['Expense removed; wallet balance restored.'] },
    'removed-loans':    { mood:'thinking', fun:['Loan removed, and its wallet effects were reversed.', 'Deleted — balances adjusted to match.'], biz:['Loan removed; related balances reversed.'] },
    'removed':          { mood:'thinking', fun:['Entry removed.'], biz:['Entry removed.'] },
    'balance-updated':  { mood:'happy', fun:function(d){ return [lastWord(d.label)+" balance updated — now it matches reality!"]; }, biz:function(d){ return [lastWord(d.label)+' balance updated.']; } },
    'wallet-renamed':   { mood:'happy', fun:function(d){ return ['Renamed to "'+lastWord(d.name)+'". Fresh label!']; }, biz:function(d){ return ['Wallet renamed to '+lastWord(d.name)+'.']; } },
    'wallet-removed':   { mood:'concerned', fun:function(d){ return [lastWord(d.label)+' wallet removed. Hope you moved the money first!']; }, biz:function(d){ return [lastWord(d.label)+' wallet removed.']; } },
    'loan-unsettled':   { mood:'thinking', fun:['Back to outstanding — I will keep it on my radar.'], biz:['Loan marked outstanding.'] },

    /* --- data, account and settings --- */
    'csv':       { mood:'happy', fun:['CSV on its way to your downloads!', 'Exported — spreadsheet time!'], biz:['CSV exported.'] },
    'backup':    { mood:'happy', fun:['Backup saved — smart move. Keep that file somewhere safe!', 'Backed up! Future you says thanks.'], biz:['Backup saved.'] },
    'restore':   { mood:'surprised', fun:['Data restored! Everything is back where it was.', 'Restore complete — welcome back, numbers!'], biz:['Data restored from backup.'] },
    'report':    { mood:'happy', fun:['Monthly report downloaded — nice for a look back!', 'Report ready!'], biz:['Report downloaded.'] },
    'print':     { mood:'thinking', fun:['Opening the print preview…'], biz:['Opening print preview.'] },
    'name-updated':   { mood:'waving', fun:['Nice to (re)meet you!', 'Name updated — I like it!'], biz:['Name updated.'] },
    'pin-updated':    { mood:'happy', fun:['New PIN saved — your data is a little safer.'], biz:['PIN updated.'] },
    'pin-reset':      { mood:'happy', fun:['PIN reset — welcome back!'], biz:['PIN reset.'] },
    'pin-removed':    { mood:'concerned', fun:['PIN removed. Anyone with this device can open the app now — you can add one back in Settings.'], biz:['PIN removed.'] },
    'recovery-saved': { mood:'happy', fun:['Recovery question saved — a safety net for later.'], biz:['Recovery question saved.'] },
    'cloud-updated':  { mood:'surprised', fun:['Pulled in your latest data from another device!'], biz:['Synced latest data.'] },
    'google-linked':  { mood:'happy', fun:['Linked! Your data now lives on a real account.'], biz:['Account linked.'] },
    'installed':      { mood:'waving', fun:['FINUITY is installed — I live on your home screen now!'], biz:['App installed.'] },
    'welcome':        { mood:'waving', fun:function(d){ return ['Welcome, '+lastWord(d.name)+"! I'm so glad you're here."]; }, biz:function(d){ return ['Welcome, '+lastWord(d.name)+'.']; } },
    'cleared':        { mood:'concerned', fun:['All data cleared — a clean slate.'], biz:['All data cleared.'] },
    'account-reset':  { mood:'concerned', fun:["Account reset. Let's set things up again."], biz:['Account reset.'] },
    'theme':          { mood:function(d){ return d.light ? 'surprised' : 'happy'; },
                        fun:function(d){ return d.light ? ['Ooh, bright! ☀️ Light mode on.'] : ['Dark mode — cozy and easy on the eyes 🌙']; },
                        biz:function(d){ return [d.light ? 'Light theme enabled.' : 'Dark theme enabled.']; } },
    'hide-balances':  { mood:'thinking', fun:function(d){ return d.hidden ? ["Balances hidden — I didn't see anything 👀"] : ['Balances are back in view.']; },
                        biz:function(d){ return [d.hidden ? 'Balances hidden.' : 'Balances visible.']; } },

    /* --- opening things (mood only or a light word) --- */
    'edit-open':   { mood:'thinking', fun:function(d){ return ['Editing '+(d.what||'an entry')+' — take your time.']; }, biz:function(d){ return ['Editing '+(d.what||'entry')+'.']; } },
    'settle-open': { mood:'thinking', fun:['Settling a loan — choose the wallet it goes through.'], biz:['Choose a wallet to settle this loan.'] },
    'stats-open':  { mood:'happy', fun:['Numbers time! 📊', 'Let’s see the breakdown.'], biz:['Opening statistics.'] },
    'filter':      { mood:'thinking', fun:null, biz:null },

    /* --- gentle nudges for input mistakes and problems --- */
    'err-amount':      { mood:'concerned', fun:['Hmm, I need an amount above zero to work with.', 'Try a number greater than zero!'], biz:['Enter an amount greater than zero.'] },
    'err-desc':        { mood:'concerned', fun:['What was it for? Add a short description.'], biz:['A description is required.'] },
    'err-name':        { mood:'concerned', fun:['It needs a name first!'], biz:['A name is required.'] },
    'err-balance':     { mood:'concerned', fun:['That balance does not look right — try a number that is zero or more.'], biz:['Enter a valid balance.'] },
    'err-longname':    { mood:'concerned', fun:['A bit long! Keep it to 24 characters.'], biz:['Name must be 24 characters or fewer.'] },
    'err-dupe':        { mood:'concerned', fun:['You already have one with that name — try a different one.'], biz:['That name is already in use.'] },
    'err-lastwallet':  { mood:'concerned', fun:['You need at least one wallet — add another before removing this one.'], biz:['At least one wallet is required.'] },
    'err-nowallet':    { mood:'concerned', fun:['Pick (or add) a wallet first so I know where the money goes.'], biz:['Select a wallet first.'] },
    'err-nooutstanding': { mood:'concerned', fun:['That loan has nothing outstanding left.'], biz:['No outstanding amount on this loan.'] },
    'err-nofile':      { mood:'concerned', fun:['Choose a backup file first.'], biz:['Select a backup file.'] },
    'err-badfile':     { mood:'concerned', fun:["That file doesn't look like a FINUITY backup."], biz:['Invalid backup file.'] },
    'err-readfile':    { mood:'concerned', fun:["I couldn't read that file — try another one."], biz:['File could not be read.'] },
    'err-cloud':       { mood:'concerned', fun:['Cloud is unreachable — no worries, everything is still saved on this device.'], biz:['Cloud unavailable; data is saved locally.'] },
    'err-linking':     { mood:'concerned', fun:["The account link didn't go through — you can try again."], biz:['Account linking failed.'] },
    'err-popup':       { mood:'concerned', fun:['Allow pop-ups so I can open the print view.'], biz:['Allow pop-ups to print.'] },
    'err-already':     { mood:'concerned', fun:["That one's already logged for this month."], biz:['Already logged this month.'] },
    'err-generic':     { mood:'concerned', fun:["Oops, that didn't work. Give it another try."], biz:['That action could not be completed.'] }
  };

  function getReaction(kind, d, ctx, tone){
    var def = REACT[kind];
    if(!def) return null;
    d = d || {}; ctx = ctx || {};
    var biz = tone==='businesslike';
    var list = (biz && def.biz) ? def.biz : def.fun;
    var text = list ? rLine(list, d, ctx) : null;
    var mood = typeof def.mood==='function' ? safe(function(){ return def.mood(d,ctx); }, 'happy') : def.mood;
    return { text: text, mood: mood };
  }

  global.FinPetDialogue = {
    buildContext,
    getModuleMessage,
    getMenuMessage,
    getNextActionMessage,
    getClickLine: getSmallTalkMessage, // kept for backward compatibility
    getSmallTalkMessage,
    getIdleNudge,
    getWakeLine,
    getTipMessage,
    getGlossaryMessage,
    getHealthMessage,
    getGoalReachedMessage,
    getLoanSettledMessage,
    getPostActionMessage,
    getStreakCelebration,
    getBudgetAlertMessage,
    getWeeklyRecapMessage,
    getGoalNudgeMessage,
    getOnboardingStepMessage,
    getOnboardingModules,
    getSettingsMessage,
    getSettingsNotificationsMessage,
    getSettingsPersonalizeMessage,
    getPatternInsight,
    getPersonalBestLine,
    getNewBestCelebration,
    getAskMenuMessage,
    answerQuestion,
    getPrivacyMessage,
    getBadgesMessage,
    BADGE_DEFS,
    getPaceWarningMessage,
    getSurplusSuggestionMessage,
    getSinceLastHereMessage,
    getStreakRiskMessage,
    getIncomeStaleMessage,
    getBudgetStaleMessage,
    getWalletStaleMessage,
    getLoanIdleMessage,
    getCarryoverMessage,
    getRecurringMissingMessage,
    getExpenseSpikeMessage,
    getGoalProgressMessage,
    getLoanPaymentMessage,
    getReaction
  };

})(window);

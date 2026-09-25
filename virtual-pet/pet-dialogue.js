/* ============================================================
   FINUITY Virtual Pet — dialogue & context
   Pure data + pure functions. Nothing here touches the DOM;
   pet.js is the only file that renders anything. This file
   only reads the host app's existing global `state` object and
   helper functions (today(), fmt()) — it never invents data and
   never writes to `state`.
   ============================================================ */
(function(global){

  function safe(fn,fallback){ try{ return fn(); }catch(e){ return fallback; } }

  function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

  /* ---------- context ---------- */
  // Snapshot of "what's actually going on" in the app right now, built
  // fresh each time a message is requested. Every field is derived from
  // the real `state` object the host app already maintains.
  function buildContext(){
    const st = global.state || {};
    const income = st.income || [];
    const expenses = st.expenses || [];
    const loans = st.loans || [];
    const goals = st.goals || [];
    const wallets = st.wallets || [];
    const now = new Date();
    const hour = now.getHours();
    const todayStr = safe(()=>global.today(), null);

    const timeOfDay = hour<5 ? 'night' : hour<12 ? 'morning' : hour<17 ? 'afternoon' : hour<21 ? 'evening' : 'night';

    const todayExpenses = todayStr ? expenses.filter(e=>e.date===todayStr) : [];
    const loggedExpenseToday = todayExpenses.length>0;

    const unsettledLoans = loans.filter(l=>!l.settled);
    const payable = unsettledLoans.filter(l=>l.type==='payable');
    const receivable = unsettledLoans.filter(l=>l.type==='receivable');
    const overdue = unsettledLoans.filter(l=>l.due && l.due < (todayStr||'')); 

    const curMonth = now.getMonth(), curYear = now.getFullYear();
    const curExp = expenses.filter(e=>{
      const d = new Date(e.date);
      return !isNaN(d) && d.getMonth()===curMonth && d.getFullYear()===curYear;
    }).reduce((a,b)=>a+b.amount,0);
    const budgetLimit = st.budgetLimit || 0;
    const budgetPct = budgetLimit>0 ? Math.round((curExp/budgetLimit)*100) : null;

    const negativeWallets = wallets.filter(w=>w.balance<0);

    const nearGoal = goals.find(g=>g.target>0 && g.saved<g.target && (g.saved/g.target)>=0.9);

    return {
      timeOfDay,
      username: st.username || '',
      counts: { income: income.length, expenses: expenses.length, loans: unsettledLoans.length, goals: goals.length, wallets: wallets.length },
      loggedExpenseToday,
      payableCount: payable.length,
      receivableCount: receivable.length,
      overdueCount: overdue.length,
      overdueLoan: overdue[0]||null,
      budgetLimit, budgetPct,
      overBudget: budgetPct!==null && budgetPct>=100,
      budgetWarn: budgetPct!==null && budgetPct>=75 && budgetPct<100,
      hasNegativeWallet: negativeWallets.length>0,
      negativeWallet: negativeWallets[0]||null,
      nearGoal,
      hasWallets: wallets.length>0,
      hasIncome: income.length>0,
      hasExpenses: expenses.length>0,
      hasLoans: loans.length>0,
      hasGoals: goals.length>0
    };
  }

  /* ---------- per-module messages ----------
     Each entry returns either null (nothing worth saying) or
     {text, actionText, actionModule, actionFocus}. actionModule
     is a real module id the pet will pass to the host's own
     show() function; actionFocus is an optional input id to
     focus after navigating there. */

  function dashboardMessage(ctx){
    const greetWord = ctx.timeOfDay==='morning' ? 'Good morning' : ctx.timeOfDay==='afternoon' ? 'Good afternoon' : ctx.timeOfDay==='evening' ? 'Good evening' : 'Still up';
    const name = ctx.username ? `, ${ctx.username}` : '';

    if(ctx.overdueCount>0){
      const l = ctx.overdueLoan;
      return { text:`${greetWord}${name}! Heads up — "${l.name}" looks past its due date.`, actionText:'View Loans', actionModule:'loans' };
    }
    if(ctx.overBudget){
      return { text:`${greetWord}${name}. You're over your budget for this month.`, actionText:'Check Budget', actionModule:'goals' };
    }
    if(!ctx.loggedExpenseToday && ctx.hasExpenses){
      return { text:`${greetWord}${name}! Haven't seen an expense logged today yet.`, actionText:'Add Expense', actionModule:'expenses', actionFocus:'exp-desc' };
    }
    if(ctx.budgetWarn){
      return { text:`${greetWord}${name}. You're at ${ctx.budgetPct}% of this month's budget — worth a glance.`, actionText:'View Budget', actionModule:'goals' };
    }
    if(ctx.nearGoal){
      return { text:`${greetWord}${name}! "${ctx.nearGoal.name}" is almost fully funded.`, actionText:'View Goal', actionModule:'goals' };
    }
    if(ctx.payableCount>0){
      return { text:`${greetWord}${name}. You still owe on ${ctx.payableCount} loan${ctx.payableCount>1?'s':''}.`, actionText:'View Loans', actionModule:'loans' };
    }
    if(!ctx.hasIncome && !ctx.hasExpenses){
      return { text:`${greetWord}${name}! I'm Fin. Let's log your first entry — income or an expense, your call.`, actionText:'Add Income', actionModule:'income', actionFocus:'inc-amount' };
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
      return { text:`"${l.name}" is past its due date. Worth following up.`, mood:'concerned' };
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
      return { text:`"${ctx.nearGoal.name}" is at ${Math.round(ctx.nearGoal.saved/ctx.nearGoal.target*100)}% — so close!`, mood:'happy' };
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

  /* ---------- click / idle small talk ---------- */
  const CLICK_LINES = [
    "Hey! Need something?",
    "I'm here if you need me.",
    "Just keeping an eye on things.",
    "Poke me anytime — I like the attention.",
    "All quiet on my end."
  ];

  function getClickLine(ctx){
    // Occasionally surface a real recommendation instead of small talk.
    if(Math.random()<0.4){
      const rec = dashboardMessage(ctx);
      if(rec && rec.actionText) return rec;
    }
    return { text: pick(CLICK_LINES) };
  }

  const IDLE_LINES = [
    "Psst... still there?",
    "Take your time — I'll be here.",
    "No rush. Just checking in."
  ];
  function getIdleNudge(){
    return { text: pick(IDLE_LINES) };
  }

  function getWakeLine(){
    return { text: pick(["Oh, hey — welcome back!", "You're back! What'd I miss?"]) };
  }

  global.FinPetDialogue = { buildContext, getModuleMessage, getClickLine, getIdleNudge, getWakeLine };

})(window);
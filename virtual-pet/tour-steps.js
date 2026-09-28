/* ============================================================
   FINUITY guided tour — STEP CONFIG  (edit this file to add steps)
   ------------------------------------------------------------
   Each step points at a real element in index.html through a
   data-tour="..." attribute, e.g.  <button data-tour="my-button">

   Step fields
     target       (string)  value of the element's data-tour attribute.
                            If several elements share the name (e.g. the
                            desktop sidebar link and the mobile bottom-nav
                            link), the first one that is currently visible
                            is used. If none is visible the step is
                            skipped automatically.
     selector     (string)  optional CSS selector, used instead of target.
     page         (string)  optional app page to open first: 'dashboard',
                            'income', 'balances', 'expenses', 'loans',
                            'goals', 'settings', 'export'. Give this to any
                            step that lives on a specific page.
     title        (string)  bold heading in Fin's bubble.
     description  (string)  the explanation.
     placement    (string)  'top' | 'bottom' | 'left' | 'right' | 'auto'.
                            A preference only: Fin and the bubble pick another
                            side automatically if there isn't room.
     mobilePlacement (string) optional override used on narrow screens.
     action       (string)  what moves the tour forward:
                              'click'  – the user clicks the highlighted element
                              'input'  – the user types into the highlighted field
                              'next'   – (default) the user presses Next
                            Next/Back always work too, so nobody gets stuck.
     hint         (string)  optional small line under the text; a sensible
                            default is shown for 'click' and 'input' steps.
     interactive  (boolean) let the user click things inside the highlighted
                            area. Default: true for click/input, false for next.
     padding      (number)  extra px of spotlight around the target (default 8).

   Steps whose target is missing from the page are dropped/skipped, so it is
   safe to leave steps in here for features you might remove later.
   ============================================================ */
window.FinTourSteps = [
  {
    target: 'hero-balance',
    page: 'dashboard',
    title: 'Your total balance',
    description: 'This is everything you have across all your wallets, updated whenever you log income or spend money.',
    placement: 'bottom',
    action: 'next'
  },
  {
    target: 'nav-balances',
    title: 'Open Balances',
    description: 'Wallets live here. Click Balances to see them.',
    placement: 'right',
    action: 'click'
  },
  {
    target: 'add-wallet',
    page: 'balances',
    title: 'Add a wallet',
    description: 'Add each place you keep money, like Cash, GCash, Maya or a bank. Give it a name and a starting balance.',
    placement: 'top',
    action: 'next'
  },
  {
    target: 'nav-income',
    title: 'Now, income',
    description: 'Click Income to record money coming in.',
    placement: 'right',
    action: 'click'
  },
  {
    target: 'income-form',
    page: 'income',
    title: 'Log your income',
    description: 'Pick the month, the type (salary, bonus...), the amount and which wallet it goes into. Your dashboard charts are built from these entries.',
    placement: 'bottom',
    action: 'next'
  },
  {
    target: 'nav-expenses',
    title: 'Track spending',
    description: 'Click Expenses to log what you spend.',
    placement: 'right',
    action: 'click'
  },
  {
    target: 'expense-form',
    page: 'expenses',
    title: 'Log an expense',
    description: 'Describe it, add the amount, choose a category and the wallet it came out of. That wallet\u2019s balance updates automatically.',
    placement: 'bottom',
    action: 'next'
  },
  {
    target: 'nav-goals',
    title: 'Budget and goals',
    description: 'Click Goals to set a monthly limit and save toward things you want.',
    placement: 'right',
    action: 'click'
  },
  {
    target: 'budget-card',
    page: 'goals',
    title: 'Set a monthly limit',
    description: 'Enter how much you\u2019re comfortable spending each month. I\u2019ll warn you as you get close to it.',
    placement: 'bottom',
    action: 'next'
  },
  {
    target: 'help-button',
    page: 'dashboard',
    title: 'Need me again?',
    description: 'Tap this ? button any time to replay the tour. You can also tap me for tips. That\u2019s it, you\u2019re ready!',
    placement: 'bottom',
    action: 'next'
  }
];

/* Optional tuning knobs (all have defaults inside tour.js) */
window.FinTourConfig = {
  // padding: 8,          // spotlight padding around targets (px)
  // topSafe: 72,         // px at the top hidden behind the sticky header
  // bottomSafe: 84,      // px at the bottom hidden behind the mobile nav
  // cardWidth: 320,      // max width of Fin's speech bubble
  // laterDays: 1         // "Maybe later" asks again after this many days
};

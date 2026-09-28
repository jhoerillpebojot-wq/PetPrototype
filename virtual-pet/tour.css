/* ============================================================
   FINUITY guided tour — styling
   Uses the host app's CSS variables (--surface, --border2, --text,
   --muted, --accent, --accent-rgb, --font-b, --font-d) so it follows
   light/dark mode like Fin does. Buttons reuse Fin's own
   .fin-bubble-btn styles from pet.css.
   Safe to delete (with tour.js, tour-steps.js and their tags).
   ============================================================ */

.ft-root{
  --ft-ease:cubic-bezier(.2,.8,.2,1);
  position:fixed;inset:0;
  z-index:9000;
  pointer-events:none;
  font-family:var(--font-b);
  opacity:0;
  transition:opacity .3s ease;
}
.ft-root.ft-on{opacity:1;}
.ft-root *{box-sizing:border-box;}

/* Four transparent panels around the spotlight swallow stray clicks, while
   the spotlight "hole" itself stays open so the real target is clickable. */
.ft-block{position:fixed;background:transparent;pointer-events:auto;}
.ft-hole-block{display:none;}
.ft-hole-block.ft-on{display:block;}

/* The spotlight. A giant box-shadow is the dark overlay, so the only bright
   area is the box itself, and it can glide between targets. */
.ft-spot{
  position:fixed;left:0;top:0;width:0;height:0;
  border-radius:12px;
  pointer-events:none;
  box-shadow:
    0 0 0 9999px rgba(4,5,9,.74),
    0 0 0 2px rgba(var(--accent-rgb),.9),
    0 0 22px 2px rgba(var(--accent-rgb),.32);
  transition:
    left .5s var(--ft-ease), top .5s var(--ft-ease),
    width .5s var(--ft-ease), height .5s var(--ft-ease),
    border-radius .5s var(--ft-ease);
}
.ft-spot.ft-pulse::after{
  content:'';position:absolute;inset:-2px;border-radius:inherit;
  border:2px solid rgba(var(--accent-rgb),.75);
  animation:ft-pulse 1.7s ease-out infinite;
}
@keyframes ft-pulse{
  0%{inset:-2px;opacity:.9;}
  100%{inset:-13px;opacity:0;}
}

/* Arrow between Fin and the target */
.ft-pointer{
  position:fixed;left:0;top:0;
  width:24px;height:24px;margin:-12px 0 0 -12px;
  color:var(--accent);
  pointer-events:none;
  z-index:4;
  filter:drop-shadow(0 2px 5px rgba(0,0,0,.55));
  transition:left .6s var(--ft-ease), top .6s var(--ft-ease), opacity .2s ease;
}
.ft-pointer.ft-hidden{opacity:0;}
.ft-pt-in{width:100%;height:100%;animation:ft-bob .9s ease-in-out infinite;}
.ft-pt-in svg{display:block;width:100%;height:100%;transition:transform .5s var(--ft-ease);}
@keyframes ft-bob{
  0%,100%{transform:translate(0,0);}
  50%{transform:translate(var(--ft-dx,6px),var(--ft-dy,0px));}
}

/* Fin's speech bubble for the tour (same look as .fin-bubble) */
.ft-card{
  position:fixed;left:0;top:0;
  width:320px;max-width:calc(100vw - 20px);
  pointer-events:auto;
  z-index:5;
  background:var(--surface);
  border:1px solid var(--border2);
  border-radius:16px;
  box-shadow:0 14px 34px rgba(0,0,0,.28);
  padding:13px 15px 12px;
  font-size:12.5px;
  line-height:1.55;
  color:var(--text);
  transition:left .5s var(--ft-ease), top .5s var(--ft-ease), opacity .22s ease;
}
.ft-card:focus{outline:none;}
.ft-card.ft-swap{opacity:.0;}
.ft-card.ft-nudge{animation:ft-nudge .32s ease;}
@keyframes ft-nudge{
  0%,100%{transform:translateX(0);}
  25%{transform:translateX(-5px);}
  75%{transform:translateX(5px);}
}
.ft-close{
  position:absolute;top:7px;right:9px;
  background:none;border:none;cursor:pointer;
  color:var(--muted2);font-size:13px;line-height:1;padding:3px;
}
.ft-close:hover{color:var(--muted);}
.ft-stepno{
  font-size:10.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;
  color:var(--muted);padding-right:18px;
}
.ft-bar{height:3px;background:var(--surface3);border-radius:3px;margin:7px 0 10px;overflow:hidden;}
.ft-bar-fill{height:100%;width:0;background:var(--accent);border-radius:3px;transition:width .4s ease;}
.ft-title{font-family:var(--font-d);font-size:14px;font-weight:700;line-height:1.35;margin-bottom:4px;}
.ft-desc{white-space:pre-line;}
.ft-hint{
  margin-top:8px;padding:6px 9px;
  font-size:11.5px;color:var(--accent);
  background:var(--accent-bg);
  border:1px solid rgba(var(--accent-rgb),.16);
  border-radius:8px;
}
.ft-hint:empty{display:none;}
.ft-actions{display:flex;align-items:center;gap:6px;margin-top:12px;}
.ft-skip{
  margin-right:auto;padding:4px 2px;
  background:none;border:none;cursor:pointer;
  font-family:var(--font-b);font-size:12px;color:var(--muted);
}
.ft-skip:hover{color:var(--text);}
.ft-actions .fin-bubble-btn[disabled]{opacity:.4;pointer-events:none;}

/* Little tail pointing from the bubble to Fin (borders only on the outer sides) */
.ft-tail{
  position:absolute;width:12px;height:12px;
  background:var(--surface);
  border:1px solid var(--border2);
  transform:rotate(45deg);
  pointer-events:none;
}
.ft-tail[data-side="top"]{top:-7px;border-right-color:transparent;border-bottom-color:transparent;}
.ft-tail[data-side="bottom"]{bottom:-7px;border-left-color:transparent;border-top-color:transparent;}
.ft-tail[data-side="left"]{left:-7px;border-right-color:transparent;border-top-color:transparent;}
.ft-tail[data-side="right"]{right:-7px;border-left-color:transparent;border-bottom-color:transparent;}
.ft-tail[data-side="none"]{display:none;}

/* While the page is scrolling/resizing the spotlight follows instantly, and
   the bubble + Fin then glide to their new spots once it settles. */
html.ft-instant .ft-spot{transition:none !important;}

/* ---------- Fin while touring ---------- */
#fin-pet-root.fin-touring{
  z-index:9002;
  transition:left .65s cubic-bezier(.2,.8,.2,1), top .65s cubic-bezier(.2,.8,.2,1);
}
#fin-pet-root.fin-touring .fin-bubble,
#fin-pet-root.fin-touring .fin-min-btn{display:none !important;}
#fin-pet-root.fin-touring .fin-avatar-wrap{pointer-events:none;transition:width .5s ease,height .5s ease;}
html.ft-snap .ft-card,
html.ft-snap .ft-pointer{transition:none !important;}

/* ---------- small screens ---------- */
@media(max-width:900px){
  .ft-card{font-size:12px;padding:12px 13px 11px;}
  .ft-title{font-size:13.5px;}
}

/* ---------- reduced motion ---------- */
@media(prefers-reduced-motion:reduce){
  .ft-root,.ft-spot,.ft-card,.ft-pointer,.ft-pt-in svg,.ft-bar-fill,
  #fin-pet-root.fin-touring{transition:none !important;}
  .ft-pt-in,.ft-spot.ft-pulse::after,.ft-card.ft-nudge{animation:none !important;}
}

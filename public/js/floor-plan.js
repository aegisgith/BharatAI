/* Bharat AI Innovation 2026 — Interactive Exhibition Floor Plan */
(function(){
  const IMG=window.IMG, BOOTHS=window.BOOTHS||[], PLOTS=window.PLOTS||[], PRICES=window.BOOTH_PRICES||{};
  BOOTHS.forEach(b=>{ if(PRICES[b.type]!=null) b.price=PRICES[b.type]; });

  // NOTE: `type` keys are legacy floor-map identifiers. Display names match the
  // exhibition.html package cards by physical booth size (see comment per line).
  const TYPE_META={
    pod:{name:'Startup Pod',var:'--fp-pod'},                       // 1.5×1.5 m
    explorer:{name:'Explorer Booth',var:'--fp-explorer'},          // 2×2 m
    innovator:{name:'Innovator Booth',var:'--fp-innovator'},       // 3×2 m
    accelerator:{name:'Enterprise Booth',var:'--fp-accelerator'},  // 4×2 m
    standard:{name:'Accelerator Booth',var:'--fp-standard'},       // 3×3 m
    premium:{name:'Premium Booth',var:'--fp-premium'},             // 5×2 m — new in the revised layout
    enterprise:{name:'Flagship Pavilion',var:'--fp-enterprise'},   // 6×2 m
    mega:{name:'Mega Pavilion',var:'--fp-mega'},                   // 7×8 m
  };
  const ORDER=['mega','enterprise','premium','standard','accelerator','innovator','explorer','pod'];
  const colorOf=t=>`var(${TYPE_META[t].var})`;
  const inr=n=>'₹'+Number(n).toLocaleString('en-IN');
  const qs=s=>document.querySelector(s);

  /* ---------- booth status ----------------------------------------------------
     GEOMETRY always comes from the static window.BOOTHS array in floor-plan-data.js
     - it is what renders before any network call and it is the fallback when the
     API is not there. Only *status* is live: loadLive() below merges it in by code.
     Until (and unless) that succeeds, status is derived from the static `booked`
     flag exactly as it was before, so an older deploy renders identically. */
  const STATUSES={available:1,held:1,sold:1,blocked:1};
  const STATE_META={
    available:{label:'Available',     tag:'● Available'},
    held:     {label:'On hold',       tag:'● On hold'},
    sold:     {label:'Sold',          tag:'● Sold'},
    blocked:  {label:'Not available', tag:'● Not available'}
  };
  const ICONS={
    sold:'<svg class="fp-lk" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    held:'<svg class="fp-lk" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/></svg>',
    blocked:'<svg class="fp-lk" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><circle cx="12" cy="12" r="8"/><path d="M8.5 12h7"/></svg>'
  };
  const EVENT_ID=Number(window.FP_EVENT_ID)||1;
  // Keeps b.status, b.company and the legacy b.booked flag in lockstep.
  function setStatus(b,st,company){
    b.status=STATUSES[st]?st:'available';
    b.company=(b.status==='sold'&&company)?String(company):null;
    b.booked=b.status!=='available';
  }
  BOOTHS.forEach(b=>setStatus(b, b.booked?'sold':'available', null));

  const root=qs('#baiFloor');
  if(!root) return;
  const wrap=qs('#fpStageWrap'), stage=qs('#fpStage'), overlay=qs('#fpOverlay'), planImg=qs('#fpPlanImg');
  const IW=IMG.w, IH=IMG.h;
  stage.style.width=IW+'px'; stage.style.height=IH+'px';
  planImg.src=IMG.src; planImg.width=IW; planImg.height=IH;

  /* ---------- hotspots ---------- */
  const allHots=[];
  function addHot(item, isPlot){
    const d=document.createElement('button');
    d.className='fp-hot '+(isPlot?'fp-plot':'fp-av')+' fp-t-'+(item.type||'plot');
    d.style.left=(item.fx*IW)+'px'; d.style.top=(item.fy*IH)+'px';
    d.style.width=(item.fw*IW)+'px'; d.style.height=(item.fh*IH)+'px';
    if(!isPlot) d.style.setProperty('--hc', colorOf(item.type));
    d.dataset.code=item.code; d.dataset.type=item.type||'plot'; d.dataset.plot=isPlot?'1':'';
    d._item=item; d._plot=isPlot;
    if(isPlot) d.setAttribute('aria-label','Open plot '+(item.label||''));
    else paint(d);
    overlay.appendChild(d);
    return d;
  }
  /* Repaints one hotspot for its current status. Toggles classes rather than
     rewriting className so the filter/selection classes render() owns survive.
     Hotspot geometry is untouched - a Startup Pod stays ~6px on a phone, which is
     the documented WCAG 2.5.8 exception noted in exhibition.html. */
  function paint(t){
    if(!t||t._plot) return;
    const it=t._item, st=it.status||'available', free=st==='available';
    t.classList.toggle('fp-av', free);
    t.classList.toggle('fp-booked', !free);
    t.classList.toggle('fp-sold', st==='sold');
    t.classList.toggle('fp-held', st==='held');
    t.classList.toggle('fp-blocked', st==='blocked');
    t.dataset.status=st;
    const ic=ICONS[st]||'';
    if(t.innerHTML!==ic) t.innerHTML=ic;
    const nm=(TYPE_META[it.type]&&TYPE_META[it.type].name)||'Booth';
    t.setAttribute('aria-label', nm+' '+it.code+' — '+STATE_META[st].label);
  }
  BOOTHS.forEach(b=>allHots.push(addHot(b,false)));
  PLOTS.forEach(p=>allHots.push(addHot(p,true)));

  /* ---------- pan / zoom ---------- */
  let s=1,tx=0,ty=0,moved=false; const MIN=0.1,MAX=5;
  function apply(){ stage.style.transform=`translate(${tx}px,${ty}px) scale(${s})`; }
  function fit(){
    const w=wrap.clientWidth,h=wrap.clientHeight,pad=14;
    s=Math.min((w-pad*2)/IW,(h-pad*2)/IH); s=Math.max(MIN,Math.min(MAX,s));
    tx=(w-IW*s)/2; ty=(h-IH*s)/2; apply();
  }
  function zoomAt(px,py,f){ const ns=Math.max(MIN,Math.min(MAX,s*f)); tx=px-(px-tx)*(ns/s); ty=py-(py-ty)*(ns/s); s=ns; apply(); }
  wrap.addEventListener('wheel',e=>{e.preventDefault();const r=wrap.getBoundingClientRect();zoomAt(e.clientX-r.left,e.clientY-r.top,e.deltaY<0?1.12:1/1.12);},{passive:false});
  let drag=null, downHot=null;
  wrap.addEventListener('pointerdown',e=>{ downHot=null; if(e.target.closest('.fp-mapctl'))return; downHot=e.target.closest('.fp-hot'); drag={x:e.clientX,y:e.clientY,tx,ty};moved=false;wrap.classList.add('fp-grabbing');wrap.setPointerCapture(e.pointerId); });
  wrap.addEventListener('pointermove',e=>{ if(!drag){moveTip(e);return;} const dx=e.clientX-drag.x,dy=e.clientY-drag.y; if(Math.abs(dx)+Math.abs(dy)>4)moved=true; tx=drag.tx+dx;ty=drag.ty+dy;apply(); });
  function endDrag(){ if(drag){drag=null;wrap.classList.remove('fp-grabbing');} }
  wrap.addEventListener('pointerup',endDrag); wrap.addEventListener('pointercancel',endDrag);
  wrap.addEventListener('pointerleave',()=>tip.classList.remove('fp-tip-show'));
  qs('#fpZin').onclick=()=>{const r=wrap.getBoundingClientRect();zoomAt(r.width/2,r.height/2,1.3);};
  qs('#fpZout').onclick=()=>{const r=wrap.getBoundingClientRect();zoomAt(r.width/2,r.height/2,1/1.3);};
  qs('#fpZfit').onclick=fit;
  window.addEventListener('resize',fit);

  /* ---------- tooltip ---------- */
  const tip=qs('#fpTip');
  function moveTip(e){
    const t=e.target.closest('.fp-hot'); if(!t){tip.classList.remove('fp-tip-show');return;}
    const it=t._item, r=wrap.getBoundingClientRect();
    tip.style.left=(e.clientX-r.left)+'px'; tip.style.top=(e.clientY-r.top)+'px';
    if(t._plot){ tip.innerHTML=`<div class="fp-tt-c">Plot ${it.label}</div><div class="fp-tt-r">Open plot · enquire</div>`; }
    else {
      const st=it.status||'available';
      // The company name is public only on a sold booth - a held booth is a
      // negotiation in progress and naming the other party is not ours to do.
      const right = st==='available' ? inr(it.price)
                  : (st==='sold' && it.company) ? esc(it.company)
                  : STATE_META[st].label;
      tip.innerHTML=`<div class="fp-tt-c">${TYPE_META[it.type].name} · ${it.code}</div>
      <div class="fp-tt-r"><span>${it.dim.replace('m x ','m × ')}</span><span>·</span><span class="fp-tt-st fp-st-${st}">${right}</span></div>`;
    }
    tip.classList.add('fp-tip-show');
  }

  /* ---------- filters ---------- */
  let activeTypes=new Set(), availOnly=false;
  function counts(){ const c={}; ORDER.forEach(t=>c[t]={tot:0,av:0}); BOOTHS.forEach(b=>{c[b.type].tot++; if(b.status==='available')c[b.type].av++;}); return c; }
  function buildChips(){
    const c=counts(), w=qs('#fpChips');
    w.innerHTML=`<button class="fp-chip fp-chip-active" data-all="1">All</button>`+
      ORDER.map(t=>`<button class="fp-chip" data-type="${t}"><span class="fp-sw" style="background:${colorOf(t)}"></span>${TYPE_META[t].name.replace(' Booth','').replace(' Pavilion','')}</button>`).join('');
    w.querySelectorAll('.fp-chip').forEach(ch=>ch.onclick=()=>{
      if(ch.dataset.all) activeTypes.clear();
      else { const t=ch.dataset.type; activeTypes.has(t)?activeTypes.delete(t):activeTypes.add(t); }
      syncChips(); render();
    });
  }
  function syncChips(){ qs('#fpChips').querySelectorAll('.fp-chip').forEach(ch=>{ if(ch.dataset.all)ch.classList.toggle('fp-chip-active',activeTypes.size===0); else ch.classList.toggle('fp-chip-active',activeTypes.has(ch.dataset.type)); }); }
  const filtering=()=>activeTypes.size>0||availOnly;
  function render(){
    overlay.classList.toggle('fp-filtering', filtering());
    allHots.forEach(t=>{
      const it=t._item; let show=true, dim=false;
      if(t._plot){ if(filtering()) dim=true; }
      else {
        if(activeTypes.size && !activeTypes.has(it.type)){show=false;}
        if(availOnly && it.status!=='available'){show=false;}
      }
      t.classList.toggle('fp-hide', !show);
      t.classList.toggle('fp-faded', dim);
      t.classList.toggle('fp-lit', !t._plot && show && filtering());
    });
  }
  qs('#fpAvailToggle').onclick=function(){ availOnly=!availOnly; this.classList.toggle('fp-toggle-on',availOnly); render(); };

  /* ---------- panel ---------- */
  const panel=qs('#fpPanel'), scrim=qs('#fpScrim'); let current=null;
  function openPanel(t){
    const it=t._item; current={item:it,plot:t._plot};
    root.querySelectorAll('.fp-hot.fp-sel').forEach(e=>e.classList.remove('fp-sel'));
    t.classList.add('fp-sel');
    if(t._plot){
      qs('#fpPnHead').style.background='linear-gradient(135deg,#5b6182,#7e83a0)';
      qs('#fpPnType').textContent='Open Plot';
      qs('#fpPnCode').textContent='Plot '+it.label;
      // Reset the class too: the booth branch below stamps a per-status modifier
      // onto this one shared pill, so a plot opened after a sold booth would
      // otherwise inherit the "sold" styling.
      const ptag=qs('#fpPnTag'); ptag.textContent='● Enquire'; ptag.className='fp-pn-tag';
      qs('#fpSpDim').textContent='—'; qs('#fpSpArea').textContent='—'; qs('#fpSpType').textContent='Open plot';
      qs('#fpSpPrice').textContent='On request';
      qs('#fpPnBlurb').textContent='A flexible open plot — tell us your size and build requirements and our team will scope it for you.';
      qs('#fpPnBookedNote').style.display='none';
      setApply('undecided','Plot '+it.label,'Apply for an open plot');
    } else {
      const col=colorOf(it.type);
      qs('#fpPnHead').style.background=`linear-gradient(135deg,${col},color-mix(in oklab,${col},#ffffff 26%))`;
      qs('#fpPnType').textContent=TYPE_META[it.type].name;
      qs('#fpPnCode').textContent=(it.type==='mega'?'Pavilion ':'Booth ')+it.code;
      const st=it.status||'available';
      const tag=qs('#fpPnTag'); tag.textContent=STATE_META[st].tag; tag.className='fp-pn-tag fp-pn-tag-'+st;
      qs('#fpSpDim').textContent=it.dim.replace('m x ','m × ');
      qs('#fpSpArea').textContent=it.sqm+' m²';
      qs('#fpSpType').textContent=TYPE_META[it.type].name.replace(' Booth','').replace(' Pavilion','');
      qs('#fpSpPrice').innerHTML=(it.type==='pod'?'<s style="font-size:.7em;font-weight:600;opacity:.6;">'+inr(38000)+'</s> ':'')+inr(it.price);
      qs('#fpPnBlurb').textContent=it.blurb;
      const note=qs('#fpPnBookedNote'), noteTxt=qs('#fpPnBookedText');
      if(note) note.style.display=st==='available'?'none':'flex';
      if(noteTxt && st!=='available'){
        // textContent, not innerHTML - it.company is server data, never markup.
        noteTxt.textContent =
          st==='held'    ? 'Booth '+it.code+' is on hold for another exhibitor while their paperwork is finalised. Leave your details and we’ll come back to you if it frees up — or suggest a comparable booth.'
        : st==='blocked' ? 'Booth '+it.code+' is reserved by the organisers and is not on sale. Tell us your needs and we’ll suggest the closest available alternatives.'
        : it.company     ? 'Booth '+it.code+' has been taken by '+it.company+'. Tell us your needs and we’ll suggest the closest available alternatives.'
        :                  'Booth '+it.code+' is already sold. Tell us your needs and we’ll suggest the closest available alternatives.';
      }
      // The size's first word is what /inquiry's ?booth= picks the package by.
      setApply(TYPE_META[it.type].name.split(' ')[0].toLowerCase(),it.code,st==='available'?'Apply for this booth':'Apply for a similar booth');
    }
    qs('#fpPnBody').scrollTop=0;
    panel.classList.add('fp-panel-open'); panel.setAttribute('aria-hidden','false'); scrim.classList.add('fp-scrim-show');
  }
  function closePanel(){ panel.classList.remove('fp-panel-open'); panel.setAttribute('aria-hidden','true'); scrim.classList.remove('fp-scrim-show'); root.querySelectorAll('.fp-hot.fp-sel').forEach(e=>e.classList.remove('fp-sel')); current=null; }
  qs('#fpPnClose').onclick=closePanel; scrim.onclick=closePanel;
  document.addEventListener('keydown',e=>{ if(e.key==='Escape')closePanel(); });
  // The plan holds the pointer while it can be dragged (setPointerCapture above), so a mouse
  // click lands on the plan, not on the stand, and never reached the stand's listener: on a
  // laptop no stand opened. The stand under the press is remembered and used instead.
  wrap.addEventListener('click',e=>{ if(moved)return; const t=e.target.closest('.fp-hot')||downHot; downHot=null; if(!t||t.classList.contains('fp-hide'))return; openPanel(t); });

  /* ---------- apply ----------
     12 Nov 2026: a booth is applied for, not enquired about, and the team replies within
     2 working days. The panel hands the stand and its package to /inquiry's application. */
  function setApply(word,stand,label){
    const a=qs('#fpApply');
    a.href='/inquiry?booth='+encodeURIComponent(word)+'&stand='+encodeURIComponent(stand)+'#inquiry-form-card';
    a.querySelector('span').textContent=label;
    qs('#fpFormTitle').textContent=label;
  }

  /* ---------- live availability ----------
     GET /api/events/:id/booths -> { ready, booths:[{code,status,company}], summary }.
     Every failure mode lands in the same place: keep the statuses derived from the
     static array and never touch the DOM. That covers a 404 on a deploy made before
     the route existed, ready:false before the migration is applied, an HTML error
     page, malformed JSON, a hung request, and being offline entirely. */
  async function loadLive(){
    try{
      if(typeof fetch!=='function') return;
      let res=null, ctl=null, timer=null;
      try{
        if(typeof AbortController==='function'){ ctl=new AbortController(); timer=setTimeout(function(){ try{ctl.abort();}catch(e){} },6000); }
        res=await fetch('/api/events/'+EVENT_ID+'/booths',{headers:{'Accept':'application/json'},signal:ctl?ctl.signal:undefined});
      } finally { if(timer) clearTimeout(timer); }
      if(!res||!res.ok) return;                                      // 404 / 500 -> stay static
      if(!/json/i.test(res.headers.get('content-type')||'')) return; // an HTML fallback page
      const data=await res.json();
      if(!data||data.ready!==true||!Array.isArray(data.booths)||!data.booths.length) return;

      const by=new Map();
      data.booths.forEach(r=>{ if(r&&r.code!=null&&STATUSES[r.status]) by.set(String(r.code),r); });
      if(!by.size) return;
      let hit=0;
      BOOTHS.forEach(b=>{ const r=by.get(String(b.code)); if(r){ hit++; setStatus(b,r.status,r.company); } });
      if(!hit) return;          // codes do not line up with this map - keep the fallback

      allHots.forEach(paint);
      buildChips(); syncChips(); render();
    }catch(e){ /* silent by design: the static map is already on screen */ }
  }

  /* ---------- init ---------- */
  buildChips();
  function start(){ fit(); requestAnimationFrame(fit); }
  if(planImg.complete) start(); else planImg.onload=start;
  setTimeout(fit,300);
  loadLive();
})();

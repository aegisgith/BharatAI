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
    enterprise:{name:'Flagship Pavilion',var:'--fp-enterprise'},   // 6×2 m
    mega:{name:'Mega Pavilion',var:'--fp-mega'},                   // 7×8 m
  };
  const ORDER=['mega','enterprise','standard','accelerator','innovator','explorer','pod'];
  const colorOf=t=>`var(${TYPE_META[t].var})`;
  const inr=n=>'₹'+Number(n).toLocaleString('en-IN');
  const qs=s=>document.querySelector(s);

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
    d.className='fp-hot '+(isPlot?'fp-plot':(item.booked?'fp-booked':'fp-av'))+' fp-t-'+(item.type||'plot');
    d.style.left=(item.fx*IW)+'px'; d.style.top=(item.fy*IH)+'px';
    d.style.width=(item.fw*IW)+'px'; d.style.height=(item.fh*IH)+'px';
    if(!isPlot) d.style.setProperty('--hc', colorOf(item.type));
    d.dataset.code=item.code; d.dataset.type=item.type||'plot'; d.dataset.plot=isPlot?'1':'';
    if(item.booked) d.innerHTML='<svg class="fp-lk" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
    overlay.appendChild(d);
    d._item=item; d._plot=isPlot;
    return d;
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
  let drag=null;
  wrap.addEventListener('pointerdown',e=>{ if(e.target.closest('.fp-mapctl'))return; drag={x:e.clientX,y:e.clientY,tx,ty};moved=false;wrap.classList.add('fp-grabbing');wrap.setPointerCapture(e.pointerId); });
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
    else { tip.innerHTML=`<div class="fp-tt-c">${TYPE_META[it.type].name} · ${it.code}</div>
      <div class="fp-tt-r"><span>${it.dim.replace('m x ','m × ')}</span><span>·</span><span class="fp-tt-st ${it.booked?'fp-bk':'fp-av'}">${it.booked?'Reserved':inr(it.price)}</span></div>`; }
    tip.classList.add('fp-tip-show');
  }

  /* ---------- filters ---------- */
  let activeTypes=new Set(), availOnly=false;
  function counts(){ const c={}; ORDER.forEach(t=>c[t]={tot:0,av:0}); BOOTHS.forEach(b=>{c[b.type].tot++; if(!b.booked)c[b.type].av++;}); return c; }
  function buildChips(){
    const c=counts(), w=qs('#fpChips');
    w.innerHTML=`<button class="fp-chip fp-chip-active" data-all="1">All</button>`+
      ORDER.map(t=>`<button class="fp-chip" data-type="${t}"><span class="fp-sw" style="background:${colorOf(t)}"></span>${TYPE_META[t].name.replace(' Booth','').replace(' Pavilion','')}<span class="fp-ct">${c[t].av}</span></button>`).join('');
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
        if(availOnly && it.booked){show=false;}
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
      qs('#fpPnTag').textContent='● Enquire';
      qs('#fpSpDim').textContent='—'; qs('#fpSpArea').textContent='—'; qs('#fpSpType').textContent='Open plot';
      qs('#fpSpPrice').textContent='On request';
      qs('#fpPnBlurb').textContent='A flexible open plot — tell us your size and build requirements and our team will scope it for you.';
      qs('#fpFBooth').value='Plot '+it.label;
      qs('#fpPnBookedNote').style.display='none';
      qs('#fpFormTitle').textContent='Enquire about this plot';
      qs('#fpFSubmit').querySelector('span').textContent='Send plot enquiry';
    } else {
      const col=colorOf(it.type);
      qs('#fpPnHead').style.background=`linear-gradient(135deg,${col},color-mix(in oklab,${col},#ffffff 26%))`;
      qs('#fpPnType').textContent=TYPE_META[it.type].name;
      qs('#fpPnCode').textContent=(it.type==='mega'?'Pavilion ':'Booth ')+it.code;
      const tag=qs('#fpPnTag'); tag.textContent=it.booked?'● Reserved':'● Available';
      qs('#fpSpDim').textContent=it.dim.replace('m x ','m × ');
      qs('#fpSpArea').textContent=it.sqm+' m²';
      qs('#fpSpType').textContent=TYPE_META[it.type].name.replace(' Booth','').replace(' Pavilion','');
      qs('#fpSpPrice').textContent=inr(it.price);
      qs('#fpPnBlurb').textContent=it.blurb;
      qs('#fpFBooth').value=`${it.code} — ${TYPE_META[it.type].name} (${it.dim.replace('m x ','m × ')})`;
      qs('#fpPnBookedNote').style.display=it.booked?'flex':'none';
      qs('#fpFormTitle').textContent=it.booked?'Request a similar booth':'Enquire about this booth';
      qs('#fpFSubmit').querySelector('span').textContent=it.booked?'Find me a booth':'Send booth enquiry';
    }
    qs('#fpPnForm').style.display='block'; qs('#fpPnSuccess').classList.remove('fp-pn-success-show'); qs('#fpPnBody').scrollTop=0;
    panel.classList.add('fp-panel-open'); panel.setAttribute('aria-hidden','false'); scrim.classList.add('fp-scrim-show');
  }
  function closePanel(){ panel.classList.remove('fp-panel-open'); panel.setAttribute('aria-hidden','true'); scrim.classList.remove('fp-scrim-show'); root.querySelectorAll('.fp-hot.fp-sel').forEach(e=>e.classList.remove('fp-sel')); current=null; }
  qs('#fpPnClose').onclick=closePanel; scrim.onclick=closePanel;
  document.addEventListener('keydown',e=>{ if(e.key==='Escape')closePanel(); });
  overlay.addEventListener('click',e=>{ if(moved)return; const t=e.target.closest('.fp-hot'); if(!t||t.classList.contains('fp-hide'))return; openPanel(t); });

  /* ---------- form ---------- */
  qs('#fpFSubmit').onclick=()=>{
    const n=qs('#fpFName'),c=qs('#fpFCompany'),em=qs('#fpFEmail'); let ok=true;
    [n,c,em].forEach(f=>{ if(!f.value.trim()){f.style.borderColor='#e0483a';ok=false;}else f.style.borderColor=''; });
    if(em.value&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em.value)){em.style.borderColor='#e0483a';ok=false;}
    if(!ok)return;
    const it=current.item, label=current.plot?('Plot '+it.label):(it.code);
    // Send enquiry email via mailto (no server-side handler needed)
    const subject=encodeURIComponent(`Booth Enquiry — ${label} — Bharat AI Innovation 2026`);
    const body=encodeURIComponent(`Name: ${n.value.trim()}\nCompany: ${c.value.trim()}\nEmail: ${em.value.trim()}\nBooth: ${qs('#fpFBooth').value}\nMessage: ${qs('#fpFMsg').value.trim()}`);
    window.open(`mailto:info@bharataiinnovation.com?subject=${subject}&body=${body}`);
    qs('#fpSuccessMsg').innerHTML=it.booked
      ? `Thanks, <b>${n.value.trim().split(' ')[0]}</b>! Our team will suggest booths close to <b>${label}</b> within one business day.`
      : `Thanks, <b>${n.value.trim().split(' ')[0]}</b>! Your enquiry about <b>${label}</b> has been sent. We'll reply within one business day.`;
    qs('#fpPnForm').style.display='none'; qs('#fpPnSuccess').classList.add('fp-pn-success-show');
    [n,c,em,qs('#fpFMsg')].forEach(f=>f.value='');
  };
  qs('#fpSuccessBack').onclick=closePanel;

  /* ---------- counter ---------- */
  (function(){ const tot=BOOTHS.length, av=BOOTHS.filter(b=>!b.booked).length; qs('#fpAvailNum').textContent=av; qs('#fpTotNum').textContent='/'+tot; })();

  /* ---------- init ---------- */
  buildChips();
  function start(){ fit(); requestAnimationFrame(fit); }
  if(planImg.complete) start(); else planImg.onload=start;
  setTimeout(fit,300);
})();

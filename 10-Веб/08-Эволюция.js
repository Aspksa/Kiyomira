'use strict';
// Ascension: the upper form is a VISUAL projection of source-backed SQLite state.
// Not a separate AI, second brain, avatar, or a claim of consciousness.
// Never turns a completed chat or a model claim into a verified new skill.
(() => {
  const canvas=document.getElementById('persona-evolution-canvas');
  const stage=document.getElementById('persona-evolution-stage');
  const caption=document.getElementById('persona-evolution-caption');
  const brainCanvas=document.getElementById('brain-canvas');
  if(!canvas||!stage||!caption||!brainCanvas)return;
  const panel=canvas.parentElement;
  const ctx=canvas.getContext('2d',{alpha:true});
  if(!ctx)return;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  const safeCount=value=>Number.isSafeInteger(value)&&value>0?Math.min(10000000,value):0;
  const PHASES=new Set(['контекст','генерация','сохранение','ответ','ошибка','persona-growth','persona-experiment']);
  const COLORS=['#ddba7b','#dfc38f','#b7a579','#9fbdaf','#d9a65e','#c3a378','#e1bf86','#9bb6ae'];
  const LEVELS=['самость','характер','опыт','рефлексия','исследования','навыки','цели','самостоятельность'];
  let experience=0,experiments=0,improvements=0,completedGoals=0,enabled=true;
  let levels=[.32,.28,0,0,0,0,0,0],phase='idle';
  let width=0,height=0,dpr=1,lastPaint=0,raf=0,until=0,pulse=null;
  let lastSignature='',visible=!document.hidden;
  const now=()=>performance.now();
  function derive(data){
    const e=safeCount(data?.опыта);
    const n=safeCount(data?.экспериментов_всего);
    const better=safeCount(data?.улучшений_на_образцах);
    const finished=Array.isArray(data?.цели)?
      data.цели.filter(goal=>goal?.статус==='завершено').length:0;
    const learned=Array.isArray(data?.навыки)?
      data.навыки.filter(skill=>skill?.подтверждено===true&&safeCount(skill?.испытаний)>0).length:0;
    const x=v=>v?clamp(Math.log2(v+1)/8,.12,.86):0;
    return {e,n,better,finished,learned,enabled:data?.развитие_включено!==false,
      levels:[.32,.28,x(e),x(e)*.56,x(n),x(learned),x(finished),n?x(n)*.64:0]};
  }
  function update(data){
    const next=derive(data);
    const signature=[next.e,next.n,next.better,next.finished,next.learned,next.enabled].join(':');
    if(signature===lastSignature)return;
    const changed=lastSignature!=='';
    lastSignature=signature;
    ({e:experience,n:experiments,better:improvements,finished:completedGoals,enabled}=next);
    levels=next.levels;
    // A stored test is evidence of TESTING, not proof that production search improved.
    caption.textContent=experiments?
      'Проверено ответов: '+experience+' · опыт поиска: '+experiments+' проверок'+
        (improvements?' · '+improvements+' кандидатов лучше только на тестах':''):
      'Ядро личности · '+experience+' сохранённых ответов · проверенных новых навыков нет';
    if(!enabled)caption.textContent+=' · фоновая работа приостановлена';
    if(changed)spark('persona-growth');
    else render(now());
  }
  function metrics(){
    const b=panel.getBoundingClientRect(),s=stage.getBoundingClientRect(),
      r=brainCanvas.getBoundingClientRect();
    const core=window.KiyomiraBrain?.getCorePosition?.();
    const bx=clamp((core?.x??(r.left+r.width*.5))-b.left,7,Math.max(7,b.width-7));
    const by=clamp((core?.y??(r.top+r.height*.5))-b.top,
      r.top-b.top+5,Math.max(r.top-b.top+5,r.bottom-b.top-5));
    // The personality is projected into the SAME brain viewport, above its real core.
    // Keep the graph interactive: this Canvas never receives pointer events.
    const integrated=s.height>0&&s.height>=r.height*.65;
    const rootX=integrated?bx:clamp((s.left+s.width*.5)-b.left,16,Math.max(16,b.width-16));
    const rootY=integrated?clamp(by-Math.min(110,r.height*.22),r.top-b.top+12,by-8):
      s.bottom-b.top-Math.min(16,Math.max(6,s.height*.1));
    return {rootX,rootY,bx,by,stageH:integrated?r.height*.43:s.height,
      stageTop:s.top-b.top,stageBottom:s.bottom-b.top,panelW:b.width};
  }
  function size(){
    const rect=panel.getBoundingClientRect();
    width=Math.max(0,rect.width);
    height=Math.max(0,rect.height);
    if(width<2||height<2)return;
    dpr=clamp(window.devicePixelRatio||1,1,1.7);
    canvas.width=Math.max(1,Math.round(width*dpr));
    canvas.height=Math.max(1,Math.round(height*dpr));
    ctx.setTransform(dpr,0,0,dpr,0,0);
    render(now());
  }
  function bezier(p0,p1,p2,p3,t){
    const s=1-t;
    return {x:s*s*s*p0.x+3*s*s*t*p1.x+3*s*t*t*p2.x+t*t*t*p3.x,
      y:s*s*s*p0.y+3*s*s*t*p1.y+3*s*t*t*p2.y+t*t*t*p3.y};
  }
  function geometry(m,i,level){
    const phi=(i-3.5)*.235;
    const len=m.stageH*(.15+.53*level);
    const x=m.rootX+Math.sin(phi)*len*1.3+
      Math.sin(i*2.38)*Math.min(17,m.panelW*.025)*level;
    const y=m.rootY-Math.cos(phi)*len;
    const a={x:m.rootX,y:m.rootY};
    const b={x:m.rootX+Math.sin(phi)*len*.18,y:m.rootY-len*.42};
    const c={x:x-Math.sin(phi)*len*.12+Math.cos(i*1.4)*5*level,y:y+len*.3};
    const d={x,y};
    return {a,b,c,d,len};
  }
  function drawBranch(m,i,time){
    const level=levels[i];
    if(level<=0)return;
    const g=geometry(m,i,level);
    const attention=phase==='persona-experiment'&&i===4?1:phase==='persona-growth'&&i===2?1:0;
    const alpha=clamp(.16+level*.64+attention*.16,0,.85);
    ctx.save();
    ctx.lineCap='round';
    ctx.lineJoin='round';
    const grad=ctx.createLinearGradient(g.a.x,g.a.y,g.d.x,g.d.y);
    grad.addColorStop(0,'rgba(224,172,91,.34)');
    grad.addColorStop(1,COLORS[i]);
    ctx.strokeStyle=grad;
    ctx.globalAlpha=alpha;
    ctx.lineWidth=i===0||i===1?1.6:.8+level*1.5;
    ctx.beginPath();ctx.moveTo(g.a.x,g.a.y);
    ctx.bezierCurveTo(g.b.x,g.b.y,g.c.x,g.c.y,g.d.x,g.d.y);
    ctx.stroke();
    if(level>.16){
      // A sparse living branch, deterministic: never randomizes on rerender.
      for(let k=0;k<Math.min(3,1+Math.floor(level*3));k++){
        const t=.42+k*.17, p=bezier(g.a,g.b,g.c,g.d,t);
        const dir=(k%2===0?1:-1)*(i%2?1:-1);
        const l=Math.min(23,m.stageH*.12)*level;
        ctx.lineWidth=.65;
        ctx.beginPath();ctx.moveTo(p.x,p.y);
        ctx.quadraticCurveTo(p.x+dir*l*.7,p.y-l*.34,p.x+dir*l,p.y-l*.63);
        ctx.stroke();
      }
      ctx.fillStyle=COLORS[i];
      ctx.globalAlpha=clamp(alpha*.75,0,.65);
      ctx.beginPath();ctx.arc(g.d.x,g.d.y,1.4+level*.95,0,Math.PI*2);ctx.fill();
    }
    ctx.restore();
  }
  function render(timestamp){
    if(!width||!height||!visible||document.hidden)return;
    ctx.clearRect(0,0,width,height);
    const m=metrics();
    if(m.stageH<5)return;
    const root={x:m.rootX,y:m.rootY};
    const brain={x:m.bx,y:m.by};
    // One thin living spinal connection from top personality to actual brain core.
    const p1={x:root.x+Math.sin(timestamp/680)*Math.min(10,width*.025),y:root.y+(brain.y-root.y)*.29};
    const p2={x:brain.x-Math.sin(timestamp/900)*Math.min(12,width*.025),y:root.y+(brain.y-root.y)*.72};
    const link=ctx.createLinearGradient(root.x,root.y,brain.x,brain.y);
    link.addColorStop(0,'rgba(235,187,112,.32)');
    link.addColorStop(.6,'rgba(193,159,108,.12)');
    link.addColorStop(1,'rgba(101,182,167,.24)');
    ctx.beginPath();ctx.moveTo(root.x,root.y);
    ctx.bezierCurveTo(p1.x,p1.y,p2.x,p2.y,brain.x,brain.y);
    ctx.strokeStyle=link;ctx.lineWidth=1.25;ctx.stroke();
    // A second almost invisible connective tissue, not an extra circle.
    ctx.beginPath();ctx.moveTo(root.x-3,root.y);
    ctx.bezierCurveTo(p1.x-12,p1.y,p2.x+13,p2.y,brain.x-3,brain.y);
    ctx.strokeStyle='rgba(159,145,108,.1)';ctx.lineWidth=.75;ctx.stroke();
    // Animate a photon only for actual API events, never fake model thoughts.
    if(pulse){
      const progress=clamp((timestamp-pulse.start)/1100,0,1);
      if(progress>=1)pulse=null;
      else {
        const t=pulse.up?1-progress:progress;
        const at=bezier(root,p1,p2,brain,t);
        const halo=ctx.createRadialGradient(at.x,at.y,0,at.x,at.y,8);
        halo.addColorStop(0,pulse.error?'rgba(242,118,87,.9)':'rgba(255,226,165,.9)');
        halo.addColorStop(1,'rgba(238,190,111,0)');
        ctx.fillStyle=halo;ctx.beginPath();ctx.arc(at.x,at.y,8,0,Math.PI*2);ctx.fill();
      }
    }
    // Eight potential evolution paths; only supported data activates branches.
    for(let i=0;i<8;i++)drawBranch(m,i,timestamp);
    // A recognizable, protected self core that stays even with zero history.
    const coreRadius=clamp(Math.min(m.stageH*.065,11),3,11);
    const halo=ctx.createRadialGradient(root.x,root.y,0,root.x,root.y,coreRadius*4.5);
    halo.addColorStop(0,'rgba(246,214,156,.58)');
    halo.addColorStop(.3,'rgba(212,162,87,.2)');
    halo.addColorStop(1,'rgba(212,162,87,0)');
    ctx.fillStyle=halo;ctx.beginPath();ctx.arc(root.x,root.y,coreRadius*4.5,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#f5d9a8';ctx.beginPath();ctx.arc(root.x,root.y,coreRadius*.4,0,Math.PI*2);ctx.fill();
    // A slight transient response is explicitly not a growth milestone.
    if(phase==='генерация'||phase==='контекст'){
      ctx.strokeStyle='rgba(244,209,146,.18)';ctx.lineWidth=.75;
      ctx.beginPath();ctx.arc(root.x,root.y,coreRadius*1.7,0,Math.PI*2);ctx.stroke();
    }
    lastPaint=timestamp;
  }
  function frame(t){
    raf=0;
    if(!visible||document.hidden)return;
    if(t-lastPaint>=32)render(t);
    if(t<until)raf=requestAnimationFrame(frame);
    else if(phase!=='idle'){phase='idle';render(t);}
  }
  function animate(duration=1250){
    if(!visible||document.hidden)return;
    if(reduced.matches){render(now());return;}
    until=Math.max(until,now()+duration);
    if(!raf)raf=requestAnimationFrame(frame);
  }
  function spark(type){
    phase=PHASES.has(type)?type:'idle';
    pulse={start:now(),up:phase==='контекст'||phase==='persona-experiment',
      error:phase==='ошибка'};
    animate();
  }
  function eventActivity(event){
    if(!event||!PHASES.has(event.type))return;
    spark(event.type);
  }
  document.addEventListener('visibilitychange',()=>{
    visible=!document.hidden;
    if(!visible){if(raf)cancelAnimationFrame(raf);raf=0;pulse=null;}
    else {size();animate(340);}
  });
  reduced.addEventListener?.('change',()=>{
    if(reduced.matches&&raf){cancelAnimationFrame(raf);raf=0;}
    render(now());
  });
  const observer=new ResizeObserver(size);
  observer.observe(panel);observer.observe(stage);
  window.addEventListener('resize',size);
  window.addEventListener('pagehide',()=>{
    observer.disconnect();if(raf)cancelAnimationFrame(raf);clearInterval(idle);
  },{once:true});
  const idle=setInterval(()=>{if(visible&&!reduced.matches&&!raf)render(now());},1050);
  window.KiyomiraEvolution={
    update,eventActivity,
    getState:()=>({experience,experiments,improvements,completedGoals,enabled,
      levels:LEVELS.map((name,i)=>({name,value:levels[i]})),
      canvasWidth:width,canvasHeight:height,activePulse:!!pulse})
  };
  size();
})();

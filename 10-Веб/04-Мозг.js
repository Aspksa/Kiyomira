'use strict';
// Graph nodes are persisted SQLite conversations/messages. Animations represent UI state,
// observed request lifecycle, and selection; never the private internals of an LLM.
(() => {
  const canvas=document.getElementById('brain-canvas');
  if(!canvas)return;
  const ctx=canvas.getContext('2d');
  if(!ctx)return;
  const host=canvas.parentElement;
  const info=document.getElementById('brain-detail');
  const count=document.getElementById('brain-count');
  const live=document.getElementById('brain-live');
  const TAU=Math.PI*2;
  const palette=['#dc8a48','#aa7d57','#7ea19a','#b5a07a','#b76c51','#8d87a4','#d1a468','#659b93'];
  const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
  let mode='circle',nodes=[],edges=[],chatIds=[],selected=null,selectedChat=null;
  let pan={x:0,y:0},zoom=1,width=0,height=0,pointer=null,moved=false;
  let visible=!document.hidden,raf=0,lastTick=0,active=false,phase='idle',phaseAt=0;
  let flashUntil=0;
  let totalMessages=0,conflicts=[],recalled=new Set(),focus=false,phaseChat=null;
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  const now=()=>performance.now();

  function polar(a,r){return{x:Math.cos(a)*r,y:Math.sin(a)*r};}
  function hexPath(x,y,r){
    ctx.beginPath();
    for(let k=0;k<6;k++){const a=(k+.5)*TAU/6;const px=x+r*Math.cos(a),py=y+r*Math.sin(a);if(k===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);}
    ctx.closePath();
  }
  function resize(){
    const rect=canvas.getBoundingClientRect();
    width=Math.max(1,rect.width);height=Math.max(1,rect.height);
    const scale=Math.min(window.devicePixelRatio||1,2);
    canvas.width=Math.ceil(width*scale);canvas.height=Math.ceil(height*scale);
    ctx.setTransform(scale,0,0,scale,0,0);
    draw(now());
  }
  function positionNodes(){
    const total=chatIds.length;
    for(const node of nodes){
      if(node.kind==='core'){node.tx=0;node.ty=0;continue;}
      const i=node.group;
      if(mode==='circle'){
        const a=-Math.PI/2+(i+.5)*TAU/Math.max(total,1);
        const radius=node.kind==='chat'?119:176+(node.index%3)*17;
        const spread=node.kind==='chat'?0:(node.index-(node.groupSize-1)/2)*Math.min(.09,TAU/Math.max(total,1)/Math.max(node.groupSize,1)*.85);
        const p=polar(a+spread,radius);node.tx=p.x;node.ty=p.y;
      }else if(mode==='honeycomb'){
        // One large hexagon per conversation, messages contained inside that cell.
        const col=i%5,row=Math.floor(i/5);
        const x=(col-2)*126+(row%2)*63,y=(row-(Math.ceil(total/5)-1)/2)*111;
        if(node.kind==='chat'){node.tx=x;node.ty=y;}
        else {
          const angle=(node.index/node.groupSize)*TAU-Math.PI/2;
          const p=polar(angle,27+9*(node.index%2));node.tx=x+p.x;node.ty=y+p.y;
        }
      }else{
        const a=i*2.399963229728653-Math.PI/2;
        const center=polar(a,75+40*Math.sqrt(i));
        if(node.kind==='chat'){node.tx=center.x;node.ty=center.y;}
        else {const p=polar((node.index/node.groupSize)*TAU,22+8*(node.index%2));node.tx=center.x+p.x;node.ty=center.y+p.y;}
      }
      if(!Number.isFinite(node.x)){node.x=node.tx;node.y=node.ty;}
    }
    request();
  }
  // Themes are heuristic labels; only actual messages/known dialogue membership are facts.
  function update(data) {
    const chats=Array.isArray(data.chats)?data.chats:[];
    const rows=Array.isArray(data.messages)?data.messages.slice(-1000):[];
    const previous=new Map(nodes.map(n=>[n.id,n]));
    const topics=['проекты','люди','события','документы','решения','общее'];
    const label={проекты:'Проекты',люди:'Люди',события:'События',документы:'Документы',решения:'Решения',общее:'Прочее'};
    const buckets=new Map(topics.map(x=>[x,[]]));
    for(const m of rows){const topic=(m.topics||[]).find(x=>buckets.has(x))||'общее';buckets.get(topic).push(m);}
    const groups=[];
    for(const topic of topics) {
      const batch=buckets.get(topic);
      for(let i=0;i<batch.length;i+=60)groups.push({topic,key:topic+':'+i/60,items:batch.slice(i,i+60),label:label[topic]});
    }
    const fresh=[{id:'core',kind:'core',x:0,y:0,tx:0,ty:0,label:'KIYOMIRA'}],links=[];
    const chatPositions=new Map(),groupPositions=new Map();
    groups.forEach((g,i)=>{
      const idx=fresh.length,old=previous.get('g'+g.key);
      fresh.push({id:'g'+g.key,kind:'cluster',label:g.label,group:i,count:g.items.length,topic:g.topic,x:old?.x,y:old?.y});
      groupPositions.set(g.key,idx);links.push([0,idx]);
    });
    const messagesByChat=new Map();
    for(const m of rows){if(!messagesByChat.has(m.chatId))messagesByChat.set(m.chatId,[]);messagesByChat.get(m.chatId).push(m);}
    for(const chat of chats) {
      const messages=messagesByChat.get(chat.id)||[];if(!messages.length)continue;
      const idx=fresh.length,old=previous.get('c'+chat.id);
      const topic=(messages[0].topics||[])[0]||'общее';
      const g=groups.find(x=>x.topic===topic&&x.items.some(item=>item.chatId===chat.id))||groups.find(x=>x.topic===topic);
      fresh.push({id:'c'+chat.id,kind:'chat',chatId:chat.id,label:String(chat.title||''),group:groups.indexOf(g),count:messages.length,x:old?.x,y:old?.y});
      chatPositions.set(chat.id,idx);if(g)links.push([groupPositions.get(g.key),idx]);
    }
    for(const m of rows){
      const chatIndex=chatPositions.get(m.chatId);if(chatIndex===undefined)continue;
      const idx=fresh.length,old=previous.get('m'+m.id);
      fresh.push({id:'m'+m.id,messageId:m.id,chatId:m.chatId,kind:'message',label:String(m.preview||''),role:m.role,group:fresh[chatIndex].group,x:old?.x,y:old?.y});
      links.push([chatIndex,idx]);
    }
    nodes=fresh.slice(0,1251);edges=links.filter(([a,b])=>a<nodes.length&&b<nodes.length);
    chatIds=chats.map(c=>c.id);
    totalMessages=Number(data.totalMessages||rows.length);
    conflicts=(data.candidates||[]).filter(c=>nodes.some(n=>n.messageId===c.a)&&nodes.some(n=>n.messageId===c.b));
    selected=selected?nodes.find(n=>n.id===selected.id)||null:null;
    count.textContent=totalMessages+' сообщений · '+groups.length+' кластеров · '+conflicts.length+' возможных конфликтов';
    if(!selected)info.textContent=rows.length?'Темы определены автоматически. Нажмите на узел для источника.':'Память пуста. Начните разговор.';
    layout();
    if(previous.size>1)flashUntil=now()+650;
    request();
  }
  function layout() {
    const groups=nodes.filter(n=>n.kind==='cluster'),chats=nodes.filter(n=>n.kind==='chat');
    const byGroup=new Map(groups.map(n=>[n.group,[]]));
    chats.forEach(chat=>byGroup.get(chat.group)?.push(chat));
    for(let i=0;i<groups.length;i++){
      const g=groups[i],a=i*2.399963229728653-Math.PI/2;
      if(mode==='circle'){const r=110+(i%4)*39;g.tx=Math.cos(a)*r;g.ty=Math.sin(a)*r;}
      else if(mode==='honeycomb'){
        const col=i%6,row=Math.floor(i/6),rows=Math.ceil(groups.length/6);
        g.tx=(col-2.5)*146+(row%2)*73;g.ty=(row-(rows-1)/2)*128;
      }else{const r=78+39*Math.sqrt(i);g.tx=Math.cos(a)*r;g.ty=Math.sin(a)*r;}
      if(!Number.isFinite(g.x)){g.x=g.tx;g.y=g.ty;}
      const peers=byGroup.get(g.group)||[];
      peers.forEach((chat,j)=>{
        const angle=j*2.399963229728653;
        const radius=17+11*Math.sqrt(j);
        chat.tx=g.tx+Math.cos(angle)*radius;chat.ty=g.ty+Math.sin(angle)*radius;
        if(!Number.isFinite(chat.x)){chat.x=chat.tx;chat.y=chat.ty;}
      });
    }
    const byChat=new Map(chats.map(n=>[n.chatId,[]]));
    nodes.filter(n=>n.kind==='message').forEach(n=>byChat.get(n.chatId)?.push(n));
    for(const chat of chats){
      const peers=byChat.get(chat.chatId)||[];
      peers.forEach((n,i)=>{
        const a=i*2.399963229728653,r=12+6*Math.sqrt(i);
        n.tx=chat.tx+Math.cos(a)*r;n.ty=chat.ty+Math.sin(a)*r;
        if(!Number.isFinite(n.x)){n.x=n.tx;n.y=n.ty;}
      });
    }
    // Stable de-overlap for semantic cluster anchors.
    for(let repeat=0;repeat<5;repeat++)for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++){
      const a=groups[i],b=groups[j],dx=a.tx-b.tx,dy=a.ty-b.ty,dist=Math.hypot(dx,dy)||.01;
      const limit=mode==='honeycomb'?145:62;
      if(dist<limit){const amount=(limit-dist)*.18;a.tx+=dx/dist*amount;a.ty+=dy/dist*amount;b.tx-=dx/dist*amount;b.ty-=dy/dist*amount;}
    }
    request();
  }
  function setMode(next) {
    if(!['circle','honeycomb','links'].includes(next))return;
    mode=next;
    document.querySelectorAll('[data-brain-mode]').forEach(button=>{
      const on=button.dataset.brainMode===mode;
      button.classList.toggle('selected',on);button.setAttribute('aria-pressed',String(on));
    });
    layout();save();
  }
  function save(){
    try{localStorage.setItem('kiyomira.brain.camera',JSON.stringify({mode,zoom,x:pan.x,y:pan.y}));}catch{}
  }
  function draw(time){
    if(!width||!height)return;
    ctx.clearRect(0,0,width,height);
    ctx.fillStyle='#030201';ctx.fillRect(0,0,width,height);
    const glowX=width/2+clamp(pan.x*.05,-32,32),glowY=height/2+clamp(pan.y*.05,-32,32);
    const ambience=ctx.createRadialGradient(glowX,glowY,0,width/2,height/2,Math.max(width,height)*.7);
    ambience.addColorStop(0,'rgba(238,138,60,.06)');ambience.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=ambience;ctx.fillRect(0,0,width,height);
    ctx.save();
    ctx.translate(width/2+pan.x,height/2+pan.y);ctx.scale(zoom,zoom);
    const glow=ctx.createRadialGradient(0,0,5,0,0,300);
    glow.addColorStop(0,'rgba(238,138,60,.12)');glow.addColorStop(.55,'rgba(238,138,60,.035)');glow.addColorStop(1,'rgba(238,138,60,0)');
    ctx.fillStyle=glow;circle(0,0,300);ctx.fill();
    if(mode==='circle'){
      for(const r of [40,64,88,111,134,158,183,213,244,272,303]){
        ctx.strokeStyle=r===111||r===244?'rgba(238,138,60,.24)':'rgba(238,138,60,.09)';
        ctx.lineWidth=r===111?1:.6;circle(0,0,r);ctx.stroke();
      }
      const sectors=Math.max(8,Math.min(24,chatIds.length));
      for(let i=0;i<sectors;i++){
        const a=-Math.PI/2+i*TAU/sectors;
        ctx.strokeStyle='rgba(238,138,60,.095)';ctx.lineWidth=.6;
        ctx.beginPath();ctx.moveTo(Math.cos(a)*76,Math.sin(a)*76);
        ctx.lineTo(Math.cos(a)*257,Math.sin(a)*257);ctx.stroke();
      }
      // Small data-driven arc ticks: number of ticks derives from saved messages.
      nodes.filter(n=>n.kind==='message').forEach((node,i)=>{
        const a=Math.atan2(node.y,node.x),rr=248+(i%3)*6;
        ctx.strokeStyle=palette[Math.abs(node.group||0)%palette.length];ctx.globalAlpha=.52;
        ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(Math.cos(a)*rr,Math.sin(a)*rr);
        ctx.lineTo(Math.cos(a)*(rr+4),Math.sin(a)*(rr+4));ctx.stroke();
      });
      ctx.globalAlpha=1;
    }
    if(mode==='honeycomb'){
      nodes.filter(n=>n.kind==='cluster').forEach(n=>{
        hexPath(n.x,n.y,71);ctx.lineWidth=1;ctx.strokeStyle='rgba(238,138,60,.29)';ctx.stroke();
        hexPath(n.x,n.y,68);ctx.lineWidth=.5;ctx.strokeStyle='rgba(238,138,60,.11)';ctx.stroke();
        ctx.fillStyle='rgba(238,138,60,.025)';ctx.fill();
      });
    }
    // Suspected contradictions are shown as review candidates, not verified facts.
    for(const pair of conflicts){
      const a=nodes.find(n=>n.messageId===pair.a),b=nodes.find(n=>n.messageId===pair.b);
      if(!a||!b)continue;
      ctx.strokeStyle='rgba(224,92,75,.65)';ctx.setLineDash([4,5]);ctx.lineWidth=1.2;
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);
    }
    // Clear provenance of highlighted edges: core -> thematic group -> dialogue -> message.
    for(const [a,b] of edges){
      const from=nodes[a],to=nodes[b];if(!from||!to)continue;
      const hot=recalled.has(from.id)||recalled.has(to.id)||selected&&(selected.id===from.id||selected.id===to.id||selected.chatId&&selected.chatId===to.chatId);
      ctx.lineWidth=hot?1.35:.7;
      ctx.strokeStyle=hot?'rgba(255,207,154,.75)':mode==='links'?'rgba(238,138,60,.29)':'rgba(238,138,60,.13)';
      ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.stroke();
    }
    // During a real request, light pulses travel along the existing graph only.
    if(active&&!motion.matches&&edges.length){
      const progress=(time-phaseAt)/1950;
      for(let i=0;i<Math.min(edges.length,96);i++){
        const [a,b]=edges[i],from=nodes[a],to=nodes[b];
        if(!from||!to)continue;
        const t=((progress+i*.067)%1+1)%1;
        const x=from.x+(to.x-from.x)*t,y=from.y+(to.y-from.y)*t;
        ctx.fillStyle=i%5===0?'#ffcf9a':'#c17e48';
        ctx.globalAlpha=.45+.4*(1-Math.abs(t-.5)*2);
        circle(x,y,i%5===0?2:1.2);ctx.fill();
      }
      ctx.globalAlpha=1;
    }
    for(const n of nodes){
      const core=n.kind==='core',chat=n.kind==='chat',cluster=n.kind==='cluster',isSelected=selected?.id===n.id;
      if(n.kind==='message'&&nodes.length>160&&zoom<.8&&!recalled.has(n.id)&&!isSelected)continue;
      if(chat&&nodes.length>600&&zoom<.55&&!isSelected)continue;
      const size=core?22:cluster?12:chat?6.8:2.7;
      const color=core?'#ee8a3c':palette[Math.abs(n.group||0)%palette.length];
      ctx.shadowBlur=core?25:recalled.has(n.id)?22:isSelected?20:chat?9:3;
      ctx.shadowColor=color;
      ctx.fillStyle=core?'#251306':recalled.has(n.id)?'#ffe3ae':isSelected?'#ffcf9a':color;
      ctx.strokeStyle=core?'#ffcf9a':color;
      ctx.lineWidth=core?1.5:1;
      circle(n.x,n.y,size);ctx.fill();ctx.stroke();ctx.shadowBlur=0;
      if(chat||cluster){ctx.globalAlpha=.35;ctx.strokeStyle=color;circle(n.x,n.y,12);ctx.stroke();ctx.globalAlpha=1;}
      if(isSelected){ctx.strokeStyle='#ffcf9a';ctx.lineWidth=1;circle(n.x,n.y,size+7);ctx.stroke();}
      if(core){
        ctx.strokeStyle='rgba(238,138,60,.35)';ctx.setLineDash([2,5]);circle(0,0,33);ctx.stroke();ctx.setLineDash([]);
        if(active&&!motion.matches){
          const pulse=37+9*(.5+.5*Math.sin(time/230));
          ctx.strokeStyle='rgba(255,207,154,.55)';ctx.lineWidth=1.6;circle(0,0,pulse);ctx.stroke();
        }
        if(time<flashUntil){
          const p=clamp((flashUntil-time)/1450,0,1);
          ctx.strokeStyle=phase==='error'?'rgba(224,92,75,'+(p*.8)+')':'rgba(255,207,154,'+(p*.5)+')';
          ctx.lineWidth=2;circle(0,0,37+(1-p)*20);ctx.stroke();
        }
      }
      if(core||isSelected||cluster&&zoom>.55||(chat&&zoom>1.15&&nodes.length<280)){
        ctx.fillStyle=core?'#ffcf9a':'#bda893';
        ctx.textAlign='center';ctx.font=(core?'bold 10px':'9px')+' ui-monospace,Consolas,monospace';
        ctx.fillText(core?'KIYOMIRA':n.label.slice(0,16),n.x,n.y+size+15);
      }
    }
    ctx.restore();
  }
  function interpolate(){
    if(motion.matches){for(const n of nodes){n.x=n.tx;n.y=n.ty;}return false;}
    let moving=false;
    for(const n of nodes){
      if(Math.abs(n.tx-n.x)+Math.abs(n.ty-n.y)>.2){
        n.x+=(n.tx-n.x)*.16;n.y+=(n.ty-n.y)*.16;moving=true;
      }else{n.x=n.tx;n.y=n.ty;}
    }
    return moving;
  }
  function request(){if(!raf&&visible)raf=requestAnimationFrame(loop);}
  function loop(t){
    raf=0;if(!visible)return;
    const moving=interpolate();
    if(t-lastTick>=25){draw(t);lastTick=t;}
    if(active||moving||t<flashUntil||phase==='response'&&t-phaseAt<1500||phase==='error'&&t-phaseAt<1200)request();
    else if(phase!=='idle')setPhase('idle');
  }
  function coord(ev){const b=canvas.getBoundingClientRect();return{x:ev.clientX-b.left,y:ev.clientY-b.top};}
  function nearest(p){
    const x=(p.x-width/2-pan.x)/zoom,y=(p.y-height/2-pan.y)/zoom;
    let best=null,dist=Infinity;
    for(const n of nodes){const d=(x-n.x)**2+(y-n.y)**2;const radius=n.kind==='core'?30:n.kind==='chat'?18:12;if(d<radius**2&&d<dist){dist=d;best=n;}}
    return best;
  }
  canvas.addEventListener('pointerdown',e=>{pointer=coord(e);moved=false;canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener('pointermove',e=>{
    if(!pointer)return;
    const p=coord(e),dx=p.x-pointer.x,dy=p.y-pointer.y;
    if(Math.abs(dx)+Math.abs(dy)>2)moved=true;
    if(moved){pan.x+=dx;pan.y+=dy;request();}
    pointer=p;
  });
  canvas.addEventListener('pointerup',e=>{
    if(!moved){
      const n=nearest(coord(e));selected=n;
      info.textContent=n?n.kind==='core'?'Ядро Kiyomira — этапы реальных запросов':n.label||'Сообщение':'Выберите узел, чтобы открыть диалог.';
      if(n?.chatId)window.dispatchEvent(new CustomEvent('kiyomira-brain-select',{detail:{chatId:n.chatId}}));
      request();
    }
    pointer=null;save();
  });
  canvas.addEventListener('pointercancel',()=>{pointer=null;});
  canvas.addEventListener('wheel',e=>{e.preventDefault();zoom=clamp(zoom*Math.exp(-e.deltaY*.001),.4,3.5);request();save();},{passive:false});
  for(const button of document.querySelectorAll('[data-brain-mode]'))button.addEventListener('click',()=>setMode(button.dataset.brainMode));
  document.getElementById('brain-reset')?.addEventListener('click',()=>{pan={x:0,y:0};zoom=1;request();save();});
  document.getElementById('brain-focus')?.addEventListener('click',()=>{
    focus=!focus;document.body.classList.toggle('brain-focus',focus);
    const button=document.getElementById('brain-focus');button.textContent=focus?'Выход':'Фокус';
    button.setAttribute('aria-pressed',String(focus));resize();
  });
  try {
    const saved=JSON.parse(localStorage.getItem('kiyomira.brain.camera')||'{}');
    if(['circle','honeycomb','links'].includes(saved.mode))mode=saved.mode;
    if(Number.isFinite(saved.zoom))zoom=clamp(saved.zoom,.4,3.5);
    if(Number.isFinite(saved.x))pan.x=clamp(saved.x,-1200,1200);
    if(Number.isFinite(saved.y))pan.y=clamp(saved.y,-1200,1200);
  }catch{}
  function eventActivity(event){
    if(event.type==='контекст'){
      recalled=new Set((event.sources||[]).map(x=>'m'+x));phaseChat=event.chatId;
      live.textContent='ЧТЕНИЕ КОНТЕКСТА';request();
    }else if(event.type==='генерация')setPhase('request');
    else if(event.type==='сохранение'){setPhase('response');live.textContent='ЗАПИСЬ SQLITE';}
    else if(event.type==='ответ')setPhase('response');
    else if(event.type==='ошибка')setPhase('error');
    if(event.chatId&&event.type==='контекст'){
      const n=nodes.find(n=>n.kind==='chat'&&n.chatId===event.chatId);
      if(n&&zoom>=.95&&!pointer){pan={x:-n.x*zoom,y:-n.y*zoom};request();}
    }
  }
  document.addEventListener('visibilitychange',()=>{visible=!document.hidden;if(visible)request();});
  motion.addEventListener?.('change',request);
  new ResizeObserver(resize).observe(host);
  window.KiyomiraBrain={
    update,setPhase,eventActivity,
    setBusy(value){setPhase(value?'request':'idle');}
  };
  setMode(mode);resize();
})();
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
  const palette=['#e1a05c','#5fc9bb','#76a8da','#b59bea','#d8aa75','#60b8a2','#c8c6ab','#8cb8c9'];
  const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
  let mode='circle',nodes=[],edges=[],chatIds=[],selected=null,selectedChat=null;
  let pan={x:0,y:0},zoom=1,width=0,height=0,pointer=null,moved=false;
  let visible=!document.hidden,raf=0,lastTick=0,active=false,phase='idle',phaseAt=0;
  let flashUntil=0;
  let totalMessages=0,conflicts=[],factConflicts=[],recalled=new Set(),focus=false,phaseChat=null;
  let cameraTarget=null,hovered=null,sectorAngles=[];
  let memoryWaveAt=0,memoryWaveIds=new Set();
  let sourceRouteEdges=new Set(),routeUntil=0;
  let renderStep=25,measuredFrames=0,lastDrawCost=0,avgDrawCost=0,frameRate=0,lastRenderedAt=0;
  let zoomTarget=null,modeTransitionAt=0;
  let staticRingLayer=null,staticRingBuilds=0,semanticEdgeCount=0;
  let lastGraphFingerprint='';
  let activeChat=null,activityLabel='ОЖИДАНИЕ';
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  const now=()=>performance.now();
  // Fit the 303-unit outer ring inside both narrow and short graph viewports.
  const fitScale=()=>Math.min(1,Math.max(.18,(Math.min(width,height)-28)/626));

  function polar(a,r){return{x:Math.cos(a)*r,y:Math.sin(a)*r};}
  function circle(x,y,r){ctx.beginPath();ctx.arc(x,y,r,0,TAU);}
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
    window.KiyomiraUnity?.relayout();
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
    const indexedDocs=Array.isArray(data.documents)?data.documents.slice(0,150):[];
    const projectNames=[...new Set(indexedDocs.map(x=>String(x.проект||'').trim()).filter(Boolean))];
    const rows=Array.isArray(data.messages)?data.messages.slice(-1000):[];
    // The graph is immutable between actual SQLite revisions. Avoid rebuilding
    // every sector and all Canvas nodes for unchanged polling snapshots.
    const fingerprint=JSON.stringify([
      data.totalMessages||0,data.topicTotals||{},
      chats.map(c=>[c.id,c.title,c.count]),
      indexedDocs.map(d=>[d.ид,d.название,d.проект]),
      rows.map(m=>[m.id,m.chatId,m.role,m.preview,m.topics]),
      (data.facts||[]).map(f=>[f.ид,f.ключ,f.значение,f.статус]),
      data.factLinks||[],data.semanticLinks||[],data.factConflicts||[],
      data.candidates||[]
    ]);
    if(fingerprint===lastGraphFingerprint)return;
    lastGraphFingerprint=fingerprint;

    const previous=new Map(nodes.map(n=>[n.id,n]));
    const topics=['проекты','люди','события','документы','решения','общее'];
    const label={проекты:'Проекты',люди:'Люди',события:'События',документы:'Документы',решения:'Решения',общее:'Прочее'};
    const buckets=new Map(topics.map(x=>[x,[]]));
    for(const m of rows){const topic=(m.topics||[]).find(x=>buckets.has(x))||'общее';buckets.get(topic).push(m);}
    const groups=[];
    for(const topic of topics) {
      const batch=buckets.get(topic);
      const actual=Math.max(batch.length,Number(data.topicTotals?.[topic])||0);
      const realIndexed=topic==='документы'?indexedDocs.length:topic==='проекты'?projectNames.length:0;
      const range=Math.max(batch.length,actual>0||realIndexed>0?1:0);
      for(let i=0;i<range;i+=60){
        const items=batch.slice(i,i+60);
        const amount=batch.length?Math.max(items.length,Math.round(actual*items.length/batch.length)):actual;
        groups.push({topic,key:topic+':'+i/60,items,label:label[topic],total:amount+((i===0)?realIndexed:0)});
      }
    }
    const fresh=[{id:'core',kind:'core',x:0,y:0,tx:0,ty:0,label:'KIYOMIRA'}],links=[];
    const chatPositions=new Map(),groupPositions=new Map();
    groups.forEach((g,i)=>{
      const idx=fresh.length,old=previous.get('g'+g.key);
      fresh.push({id:'g'+g.key,kind:'cluster',label:g.label,group:i,count:g.total,topic:g.topic,x:old?.x,y:old?.y});
      groupPositions.set(g.key,idx);links.push([0,idx]);
    });
    // Genuine documents and project labels appear only after explicit indexing.
    const projectPositions=new Map();
    const projectGroup=groups.findIndex(g=>g.topic==='проекты');
    const documentGroup=groups.findIndex(g=>g.topic==='документы');
    for(const name of projectNames){
      const index=fresh.length,old=previous.get('p'+name);
      fresh.push({id:'p'+name,kind:'project',label:name,group:projectGroup,count:indexedDocs.filter(d=>d.проект===name).length,
        x:old?.x,y:old?.y});
      projectPositions.set(name,index);
      if(projectGroup>=0)links.push([groupPositions.get(groups[projectGroup].key),index]);
    }
    for(const doc of indexedDocs){
      const index=fresh.length,old=previous.get('d'+doc.ид);
      fresh.push({id:'d'+doc.ид,kind:'document',documentId:doc.ид,label:String(doc.название),
        group:documentGroup,project:doc.проект,x:old?.x,y:old?.y});
      if(documentGroup>=0)links.push([groupPositions.get(groups[documentGroup].key),index]);
      if(doc.проект&&projectPositions.has(doc.проект))links.push([projectPositions.get(doc.проект),index]);
    }
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
      fresh.push({id:'m'+m.id,messageId:m.id,chatId:m.chatId,kind:'message',label:String(m.preview||''),role:m.role,at:m.at,group:fresh[chatIndex].group,x:old?.x,y:old?.y});
      links.push([chatIndex,idx]);
    }
    // Candidate facts are backed by explicit user statements and provenance.
    const factPositions=new Map();
    for(const fact of (Array.isArray(data.facts)?data.facts:[]).slice(0,200)){
      const src=fresh.findIndex(n=>n.kind==='message'&&n.messageId===fact.источник_ид);
      if(src<0)continue;
      const idx=fresh.length,old=previous.get('f'+fact.ид);
      fresh.push({
        id:'f'+fact.ид,kind:'fact',factId:fact.ид,sourceId:fact.источник_ид,
        chatId:fact.диалог_ид,label:String(fact.ключ)+': '+String(fact.значение),
        status:fact.статус,group:fresh[src].group,x:old?.x,y:old?.y
      });
      factPositions.set(fact.ид,idx);links.push([src,idx]);
    }
    for(const edge of (Array.isArray(data.factLinks)?data.factLinks:[]).slice(0,200)){
      const a=factPositions.get(edge.a),b=factPositions.get(edge.b);
      if(a!==undefined&&b!==undefined)links.push([a,b]);
    }
    for(const edge of (Array.isArray(data.semanticLinks)?data.semanticLinks:[]).slice(0,150)){
      const a=factPositions.get(edge.a),b=factPositions.get(edge.b);
      if(a!==undefined&&b!==undefined)links.push([a,b,'lexical']);
    }
    factConflicts=(Array.isArray(data.factConflicts)?data.factConflicts:[])
      .filter(c=>factPositions.has(c.a)&&factPositions.has(c.b))
      .map(c=>({a:factPositions.get(c.a),b:factPositions.get(c.b)}));
    nodes=fresh.slice(0,1251);edges=links.filter(([a,b])=>a<nodes.length&&b<nodes.length);
    semanticEdgeCount=edges.filter(edge=>edge[2]==='lexical').length;
    // Indices may change after SQLite updates; never retain stale path highlights.
    sourceRouteEdges.clear();routeUntil=0;
    chatIds=chats.map(c=>c.id);
    totalMessages=Number(data.totalMessages||rows.length);
    conflicts=(data.candidates||[]).filter(c=>nodes.some(n=>n.messageId===c.a)&&nodes.some(n=>n.messageId===c.b));
    selected=selected?nodes.find(n=>n.id===selected.id)||null:null;
    count.textContent=totalMessages+' сообщений · '+groups.length+' кластеров · показано '+rows.length+' · '+conflicts.length+' возможных конфликтов';
    if(!selected)info.textContent=rows.length?'Нажмите на сообщение, чтобы открыть его в чате.':indexedDocs.length?'Откройте документ или проект на карте.':'Память пуста. Начните разговор.';
    layout();
    if(previous.size>1)flashUntil=now()+650;
    request();
  }

  // Weighted stable radial sectors backed by actual saved messages.
  function layout() {
    const groups=nodes.filter(n=>n.kind==='cluster');
    const chats=nodes.filter(n=>n.kind==='chat');
    const messages=nodes.filter(n=>n.kind==='message');
    const animateNew=nodes.length<=600&&!motion.matches;
    const byGroup=new Map(groups.map(n=>[n.group,[]]));
    for(const chat of chats)byGroup.get(chat.group)?.push(chat);
    const byChat=new Map(chats.map(n=>[n.chatId,[]]));
    for(const msg of messages)byChat.get(msg.chatId)?.push(msg);
    const weights=groups.map(g=>Math.sqrt(Math.max(1,g.count||1))+.65);
    const sum=weights.reduce((a,b)=>a+b,0)||1;
    let angle=-Math.PI/2;
    sectorAngles=[];
    for(let i=0;i<groups.length;i++){
      const group=groups[i],width=TAU*weights[i]/sum;
      const start=angle,end=angle+width,middle=(start+end)/2;
      sectorAngles.push({group,start,end,middle});
      angle=end;
      if(mode==='circle'){
        group.tx=Math.cos(middle)*99;group.ty=Math.sin(middle)*99;
      }else if(mode==='honeycomb'){
        const col=i%6,row=Math.floor(i/6),rows=Math.ceil(groups.length/6);
        group.tx=(col-2.5)*146+(row%2)*73;group.ty=(row-(rows-1)/2)*128;
      }else{
        const a=i*2.399963229728653-Math.PI/2,r=78+39*Math.sqrt(i);
        group.tx=Math.cos(a)*r;group.ty=Math.sin(a)*r;
      }
      if(!Number.isFinite(group.x)){group.x=group.tx;group.y=group.ty;}
      const peers=byGroup.get(group.group)||[];
      peers.forEach((chat,j)=>{
        if(mode==='circle'){
          const margin=Math.min(.06,width*.09);
          const a=start+margin+(j+.5)/Math.max(1,peers.length)*(width-2*margin);
          const r=135+(j%3)*9;
          chat.tx=Math.cos(a)*r;chat.ty=Math.sin(a)*r;
        }else{
          const a=j*2.399963229728653,r=17+11*Math.sqrt(j);
          chat.tx=group.tx+Math.cos(a)*r;chat.ty=group.ty+Math.sin(a)*r;
        }
        if(!Number.isFinite(chat.x)){chat.x=chat.tx;chat.y=chat.ty;}
      });
    }
    for(const sector of sectorAngles){
      const peers=messages.filter(n=>n.group===sector.group.group);
      if(mode==='circle'){
        const width=sector.end-sector.start,margin=Math.min(.05,width*.1);
        const cols=Math.max(1,Math.min(28,Math.floor(width*170/5)));
        const rows=Math.max(1,Math.ceil(peers.length/cols));
        peers.forEach((msg,i)=>{
          const row=i%rows,col=Math.floor(i/rows);
          const used=Math.max(1,Math.ceil(peers.length/rows));
          const a=sector.start+margin+(col+.5)/used*(width-2*margin);
          const r=169+(row+.5)/rows*67;
          msg.tx=Math.cos(a)*r;msg.ty=Math.sin(a)*r;
          if(!Number.isFinite(msg.x)){
            const parent=chats.find(c=>c.chatId===msg.chatId);
            msg.x=animateNew?(parent?.tx??msg.tx*.85):msg.tx;
            msg.y=animateNew?(parent?.ty??msg.ty*.85):msg.ty;
          }
        });
      }else{
        for(const chat of byGroup.get(sector.group.group)||[]){
          (byChat.get(chat.chatId)||[]).forEach((msg,i)=>{
            const a=i*2.399963229728653,r=12+6*Math.sqrt(i);
            msg.tx=chat.tx+Math.cos(a)*r;msg.ty=chat.ty+Math.sin(a)*r;
            if(!Number.isFinite(msg.x)){
              msg.x=animateNew?chat.tx:msg.tx;
              msg.y=animateNew?chat.ty:msg.ty;
            }
          });
        }
      }
    }
    const projectNodes=nodes.filter(n=>n.kind==='project');
    const documentNodes=nodes.filter(n=>n.kind==='document');
    projectNodes.forEach((project,i)=>{
      const sector=sectorAngles.find(x=>x.group.group===project.group);
      const origin=groups.find(g=>g.group===project.group);
      if(mode==='circle'&&sector){
        const a=sector.start+(i+.5)/Math.max(1,projectNodes.length)*(sector.end-sector.start);
        project.tx=Math.cos(a)*142;project.ty=Math.sin(a)*142;
      }else{
        const a=i*2.3999632297;
        project.tx=(origin?.tx||0)+Math.cos(a)*36;project.ty=(origin?.ty||0)+Math.sin(a)*36;
      }
      if(!Number.isFinite(project.x)){project.x=project.tx;project.y=project.ty;}
    });
    documentNodes.forEach((doc,i)=>{
      const sector=sectorAngles.find(x=>x.group.group===doc.group);
      const project=projectNodes.find(p=>p.label===doc.project);
      if(mode==='circle'&&sector){
        const peers=documentNodes.filter(n=>n.group===doc.group);
        const index=peers.indexOf(doc),a=sector.start+(index+.5)/Math.max(1,peers.length)*(sector.end-sector.start);
        doc.tx=Math.cos(a)*203;doc.ty=Math.sin(a)*203;
      }else{
        const a=i*2.3999632297;
        doc.tx=(project?.tx||0)+Math.cos(a)*(24+6*Math.sqrt(i));
        doc.ty=(project?.ty||0)+Math.sin(a)*(24+6*Math.sqrt(i));
      }
      if(!Number.isFinite(doc.x)){doc.x=doc.tx;doc.y=doc.ty;}
    });
    const msgIndex=new Map(messages.map(n=>[n.messageId,n]));
    for(const fact of nodes.filter(n=>n.kind==='fact')){
      const source=msgIndex.get(fact.sourceId);
      if(!source)continue;
      const a=fact.factId*2.399963229728653;
      fact.tx=source.tx+Math.cos(a)*7;fact.ty=source.ty+Math.sin(a)*7;
      if(!Number.isFinite(fact.x)){fact.x=fact.tx;fact.y=fact.ty;}
    }
    if(mode==='honeycomb'||mode==='links'){
      for(let k=0;k<5;k++)for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++){
        const left=groups[i],right=groups[j],dx=left.tx-right.tx,dy=left.ty-right.ty;
        const d=Math.hypot(dx,dy)||.01,limit=mode==='honeycomb'?156:68;
        if(d<limit){const amount=(limit-d)*.18;left.tx+=dx/d*amount;left.ty+=dy/d*amount;
          right.tx-=dx/d*amount;right.ty-=dy/d*amount;}
      }
    }
    if(mode==='timeline'){
      // ID order is the actual SQLite insertion chronology, independent of locale parsing.
      const chronological=messages.slice().sort((a,b)=>a.messageId-b.messageId);
      const topicCount=Math.max(1,groups.length);
      groups.forEach((group,i)=>{group.tx=-268;group.ty=(i-(topicCount-1)/2)*40;});
      chats.forEach((chat,i)=>{const parent=groups[chat.group];
        chat.tx=-222;chat.ty=(parent?.ty||0)+(i%3-1)*7;});
      chronological.forEach((msg,i)=>{
        msg.tx=-185+(i+.5)/Math.max(1,chronological.length)*430;
        msg.ty=groups[msg.group]?.ty||0;
      });
      projectNodes.forEach((project,i)=>{project.tx=257;project.ty=(i-projectNodes.length/2)*19;});
      documentNodes.forEach((doc,i)=>{doc.tx=285;doc.ty=(i-documentNodes.length/2)*11;});
      for(const fact of nodes.filter(n=>n.kind==='fact')){
        const origin=msgIndex.get(fact.sourceId);
        if(origin){fact.tx=origin.tx;fact.ty=origin.ty-9;}
      }
    }
    request();
  }
  function setMode(next) {
    if(!['circle','honeycomb','links','timeline'].includes(next))return;
    if(mode!==next)modeTransitionAt=now();
    mode=next;
    document.querySelectorAll('[data-brain-mode]').forEach(button=>{
      const on=button.dataset.brainMode===mode;
      button.classList.toggle('selected',on);button.setAttribute('aria-pressed',String(on));
    });
    layout();save();
  }
  const zoomLevel=()=>zoom<.78?'Обзор':zoom<1.35?'Кластеры':zoom<2.3?'Записи':'Детали';
  function syncZoom(){
    const output=document.getElementById('brain-zoom-level');
    if(output)output.textContent=zoomLevel();
  }
  function changeZoom(factor){
    const next=clamp((zoomTarget??zoom)*factor,.4,3.5);
    if(next===(zoomTarget??zoom))return;
    zoomTarget=next;request();
    if(motion.matches){zoom=next;zoomTarget=null;syncZoom();save();}
    window.KiyomiraUnity?.relayout();
  }
  function save(){
    try{localStorage.setItem('kiyomira.brain.camera',JSON.stringify({mode,zoom,x:pan.x,y:pan.y}));}catch{}
  }
  function setPhase(next){
    if(!['idle','request','response','error'].includes(next))return;
    phase=next;phaseAt=now();active=next==='request';
    if(next==='response')flashUntil=phaseAt+1450;
    if(next==='error')flashUntil=phaseAt+1200;
    live.textContent=next==='request'?'ГЕНЕРАЦИЯ ОТВЕТА':next==='response'?'ОТВЕТ ПОЛУЧЕН':next==='error'?'ОШИБКА':'ОЖИДАНИЕ';
    live.classList.toggle('running',active);
    live.classList.toggle('error',next==='error');
    request();
  }
  // Expensive concentric geometry is rasterized once into an offscreen static
  // layer. Panning/zoom only transform the cached image; comet Canvas is separate.
  function drawStaticRings(){
    if(!staticRingLayer&&typeof document.createElement==='function'&&
       typeof ctx.drawImage==='function'){
      try{
        const layer=document.createElement('canvas');
        layer.width=640;layer.height=640;
        const ringCtx=layer.getContext('2d');
        if(ringCtx){
          ringCtx.translate(320,320);
          for(const r of [40,64,88,111,134,158,183,213,244,272,303]){
            ringCtx.beginPath();ringCtx.arc(0,0,r,0,TAU);
            ringCtx.strokeStyle=r===111||r===244?'rgba(238,138,60,.24)':'rgba(238,138,60,.09)';
            ringCtx.lineWidth=r===111?1:.6;ringCtx.stroke();
          }
          for(const r of [154,195,232,261,290]){
            ringCtx.beginPath();ringCtx.arc(0,0,r,0,TAU);
            ringCtx.strokeStyle='rgba(91,172,170,.09)';
            ringCtx.lineWidth=.45;ringCtx.stroke();
          }
          staticRingLayer=layer;staticRingBuilds++;
        }
      }catch{staticRingLayer=null;}
    }
    if(staticRingLayer&&typeof ctx.drawImage==='function'){
      ctx.drawImage(staticRingLayer,-320,-320);return;
    }
    for(const r of [40,64,88,111,134,154,158,183,195,213,232,244,261,272,290,303]){
      ctx.strokeStyle=r===111||r===244?'rgba(238,138,60,.24)':'rgba(91,172,170,.09)';
      ctx.lineWidth=r===111?1:.65;circle(0,0,r);ctx.stroke();
    }
  }
  function draw(time){
    if(!width||!height)return;
    ctx.clearRect(0,0,width,height);
    ctx.fillStyle='#02070b';ctx.fillRect(0,0,width,height);
    const glowX=width/2+clamp(pan.x*.05,-32,32),glowY=height/2+clamp(pan.y*.05,-32,32);
    const ambience=ctx.createRadialGradient(glowX,glowY,0,width/2,height/2,Math.max(width,height)*.7);
    ambience.addColorStop(0,'rgba(62,166,166,.047)');ambience.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=ambience;ctx.fillRect(0,0,width,height);
    // 2.5D parallax uses existing camera offset, not invented knowledge.
    // Far / mid / foreground layers move at different fractions of the same pan.
    const depth=ctx.createRadialGradient(
      width*.5+pan.x*.12,height*.5+pan.y*.12,14,
      width*.5+pan.x*.12,height*.5+pan.y*.12,Math.max(width,height)*.54);
    depth.addColorStop(0,'rgba(63,153,176,.065)');
    depth.addColorStop(.58,'rgba(40,89,117,.027)');
    depth.addColorStop(1,'rgba(2,7,11,0)');
    ctx.fillStyle=depth;ctx.fillRect(0,0,width,height);
    ctx.save();
    ctx.translate(width/2+pan.x,height/2+pan.y);ctx.scale(zoom*fitScale(),zoom*fitScale());
    const glow=ctx.createRadialGradient(0,0,5,0,0,300);
    glow.addColorStop(0,'rgba(111,202,188,.10)');glow.addColorStop(.55,'rgba(238,160,91,.029)');glow.addColorStop(1,'rgba(238,138,60,0)');
    ctx.fillStyle=glow;circle(0,0,300);ctx.fill();
    if(mode==='circle'){
      drawStaticRings();

      // Outer TRACKTOR categorical rim, tied to actual thematic sectors.
      ctx.lineWidth=.8;ctx.strokeStyle='rgba(99,165,176,.25)';
      circle(0,0,299);ctx.stroke();
      for(const sector of sectorAngles){
        const width=sector.end-sector.start;
        // Rim density is derived from persisted counts; no decorative fake data.
        const count=Math.max(1,Math.min(44,Math.round(Math.sqrt(Math.max(0,sector.group.count||0))*2.4)));
        for(let j=0;j<count;j++){
          const angle=sector.start+(j+.5)*width/count;
          const radius=294+(j%3)*3;
          const x=Math.cos(angle)*radius,y=Math.sin(angle)*radius;
          ctx.globalAlpha=.20+(sector.group.count>0?.33:.05);
          ctx.strokeStyle=palette[Math.abs(sector.group.group||0)%palette.length];
          ctx.lineWidth=.7;circle(x,y,3.7);ctx.stroke();
        }
      }
      ctx.globalAlpha=1;
      for(const sector of sectorAngles){
        const a=sector.start;
        ctx.strokeStyle='rgba(238,138,60,.12)';ctx.lineWidth=.65;
        ctx.beginPath();ctx.moveTo(Math.cos(a)*82,Math.sin(a)*82);
        ctx.lineTo(Math.cos(a)*245,Math.sin(a)*245);ctx.stroke();
      }
      const icons={проекты:'◇',люди:'○',события:'◷',документы:'▤',решения:'✓',общее:'•'};
      let previousLabel=null;
      sectorAngles.forEach((sector,i)=>{
        const group=sector.group,a=sector.middle;
        let radius=252;
        if(previousLabel&&Math.abs(Math.sin(a)*radius-previousLabel.y)<14&&Math.sign(Math.cos(a))===previousLabel.side)radius=270;
        const x=Math.cos(a)*radius,y=Math.sin(a)*radius;
        previousLabel={y,side:Math.sign(Math.cos(a))};
        ctx.font='9px ui-monospace,Consolas,monospace';
        ctx.textAlign=Math.cos(a)>.28?'left':Math.cos(a)<-.28?'right':'center';
        ctx.fillStyle=palette[i%palette.length];
        ctx.fillText(group.label.slice(0,14)+' · '+group.count,x,y);
        const ox=Math.cos(a)*287,oy=Math.sin(a)*287;
        ctx.strokeStyle=palette[i%palette.length];ctx.lineWidth=1;
        circle(ox,oy,10);ctx.stroke();
        ctx.textAlign='center';ctx.fillText(icons[group.topic]||'•',ox,oy+3);
      });
      // Core rings rotate only during a real API lifecycle; idle breathing stays subtle.
      const rotating=active&&!motion.matches;
      const theta=rotating?((time-phaseAt)/4500)%TAU:0;
      for(let ring=0;ring<3;ring++){
        const r=29+ring*7;
        ctx.strokeStyle=ring===0?'rgba(239,188,119,.64)':ring===1?'rgba(98,201,184,.49)':'rgba(123,169,215,.37)';
        ctx.lineWidth=ring===0?1.4:.9;ctx.beginPath();
        ctx.arc(0,0,r,theta*(ring%2? -1:1)+ring*1.4,theta*(ring%2? -1:1)+ring*1.4+Math.PI*(rotating?1.15:1.65));
        ctx.stroke();
      }
      if(active||time<flashUntil){
        ctx.strokeStyle=phase==='error'?'rgba(224,92,75,.6)':'rgba(105,202,187,.48)';
        ctx.lineWidth=1.8;circle(0,0,65);ctx.stroke();
      }
      ctx.globalAlpha=1;

    }
    if(mode==='timeline'){
      // Time axis reflects actual SQLite message insertion order, not model guesses.
      ctx.strokeStyle='rgba(97,191,178,.24)';ctx.lineWidth=.9;
      ctx.beginPath();ctx.moveTo(-196,0);ctx.lineTo(264,0);ctx.stroke();
      ctx.textAlign='left';ctx.font='10px ui-monospace,Consolas,monospace';
      ctx.fillStyle='#7bbab1';ctx.fillText('РАНЬШЕ',-198,-149);
      ctx.textAlign='right';ctx.fillText('ПОЗЖЕ',258,-149);
      const tracks=nodes.filter(n=>n.kind==='cluster');
      for(const group of tracks){
        ctx.strokeStyle='rgba(88,140,156,.16)';ctx.lineWidth=.5;
        ctx.beginPath();ctx.moveTo(-193,group.y);ctx.lineTo(260,group.y);ctx.stroke();
        ctx.fillStyle=palette[Math.abs(group.group||0)%palette.length];
        ctx.textAlign='right';ctx.fillText(group.label.slice(0,13),-205,group.y+3);
      }
    }
    if(mode==='honeycomb'){
      nodes.filter(n=>n.kind==='cluster').forEach(n=>{
        const radius=48+Math.min(30,Math.sqrt(Math.max(1,n.count||1))*3.3);
        hexPath(n.x,n.y,radius);ctx.lineWidth=1;ctx.strokeStyle='rgba(238,138,60,.29)';ctx.stroke();
        hexPath(n.x,n.y,radius-3);ctx.lineWidth=.5;ctx.strokeStyle='rgba(238,138,60,.11)';ctx.stroke();
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
    // The circle keeps labels and dense grids inside the surrounding category ring.
    // Relations are still backed by SQLite source IDs.
    // Clear provenance of highlighted edges: core -> thematic group -> dialogue -> message.
    for(const relation of factConflicts){
      const left=nodes[relation.a],right=nodes[relation.b];if(!left||!right)continue;
      ctx.strokeStyle='rgba(224,92,75,.52)';ctx.lineWidth=1;ctx.setLineDash([3,5]);
      ctx.beginPath();ctx.moveTo(left.x,left.y);ctx.lineTo(right.x,right.y);ctx.stroke();ctx.setLineDash([]);
    }
    const detailZoom=zoom*fitScale();
    // Viewport culling before expensive shadows, strokes and text labels.
    const viewMargin=40/Math.max(detailZoom,.01);
    const viewLeft=(-width/2-pan.x)/Math.max(detailZoom,.01)-viewMargin;
    const viewRight=(width/2-pan.x)/Math.max(detailZoom,.01)+viewMargin;
    const viewTop=(-height/2-pan.y)/Math.max(detailZoom,.01)-viewMargin;
    const viewBottom=(height/2-pan.y)/Math.max(detailZoom,.01)+viewMargin;
    const inView=n=>n.x>=viewLeft&&n.x<=viewRight&&n.y>=viewTop&&n.y<=viewBottom;
    const waveAge=time-memoryWaveAt;
    const waveActive=memoryWaveIds.size>0&&waveAge>=0&&waveAge<1500&&!motion.matches;
    for(const [a,b,relationType] of edges){
      const from=nodes[a],to=nodes[b];if(!from||!to)continue;
      if(!inView(from)&&!inView(to))continue;
      if(detailZoom<.75&&to.kind==='message'&&!recalled.has(to.id)&&selected?.id!==to.id)continue;
      const route=sourceRouteEdges.has(a+':'+b);
      const hot=route||recalled.has(from.id)||recalled.has(to.id)||hovered&&(hovered.id===from.id||hovered.id===to.id||hovered.group===to.group)||selected&&(selected.id===from.id||selected.id===to.id||selected.chatId&&selected.chatId===to.chatId);
      ctx.lineWidth=route?2:hot?1.35:.7;
      ctx.strokeStyle=route?'rgba(127,230,203,.93)':hot?'rgba(255,207,154,.75)':relationType==='lexical'?'rgba(126,161,154,.30)':mode==='links'?'rgba(238,138,60,.29)':'rgba(238,138,60,.13)';
      ctx.beginPath();ctx.moveTo(from.x,from.y);
      if(relationType==='lexical'&&typeof ctx.quadraticCurveTo==='function'){
        const midX=(from.x+to.x)*.5,midY=(from.y+to.y)*.5;
        ctx.quadraticCurveTo(midX*.78,midY*.78,to.x,to.y);
      }else ctx.lineTo(to.x,to.y);
      ctx.stroke();
      // A bounded illumination travels ONLY along links to source IDs reported by SQLite.
      if((waveActive&&(memoryWaveIds.has(to.id)||memoryWaveIds.has(from.id)))||
        (route&&time<routeUntil&&!motion.matches)){
        const routeAge=clamp(1-(routeUntil-time)/2400,0,1);
        const t=route?routeAge:clamp((waveAge/1500)*1.3-.12,0,1);
        const x=from.x+(to.x-from.x)*t,y=from.y+(to.y-from.y)*t;
        ctx.globalAlpha=route?.92:.83*(1-waveAge/1500);
        ctx.fillStyle='#92e6d2';circle(x,y,2.5);ctx.fill();ctx.globalAlpha=1;
      }
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
      if(!inView(n))continue;
      const core=n.kind==='core',chat=n.kind==='chat',cluster=n.kind==='cluster',isSelected=selected?.id===n.id;
      const faded=(hovered&&n.kind!=='core'&&n.group!==hovered.group)||
        (!hovered&&activeChat&&n.kind!=='core'&&n.chatId&&n.chatId!==activeChat);
      const densityThreshold=nodes.length>900?1.3:nodes.length>500?1.05:nodes.length>160?.8:.28;
      if((n.kind==='message'||n.kind==='fact')&&detailZoom<densityThreshold&&
        !recalled.has(n.id)&&!isSelected)continue;
      if(chat&&nodes.length>600&&detailZoom<.55&&!isSelected)continue;
      if(faded)ctx.globalAlpha=.23;
      const size=core?22:cluster?12:chat?6.8:n.kind==='project'?9:n.kind==='document'?5:n.kind==='fact'?4:2.7;
      const color=core?'#ee8a3c':n.kind==='document'?'#7fb6a2':n.kind==='project'?'#ceb489':n.kind==='fact'?(n.status==='подтверждено'?'#80b6a1':n.status==='отклонено'?'#66544a':'#d7b17c'):palette[Math.abs(n.group||0)%palette.length];
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
      if(faded)ctx.globalAlpha=1;
    }
    ctx.restore();
  }
  function interpolate(){
    if(motion.matches){for(const n of nodes){n.x=n.tx;n.y=n.ty;}if(cameraTarget){pan=cameraTarget;cameraTarget=null;}if(zoomTarget!==null){zoom=zoomTarget;zoomTarget=null;syncZoom();}return false;}
    let moving=false;
    if(zoomTarget!==null){
      const diff=zoomTarget-zoom;
      if(Math.abs(diff)>.003){zoom+=diff*.2;moving=true;}
      else{zoom=zoomTarget;zoomTarget=null;save();}
      syncZoom();
    }
    if(cameraTarget){
      window.KiyomiraUnity?.relayout();
      const dx=cameraTarget.x-pan.x,dy=cameraTarget.y-pan.y;
      if(Math.abs(dx)+Math.abs(dy)>.7){pan.x+=dx*.16;pan.y+=dy*.16;moving=true;}
      else{pan=cameraTarget;cameraTarget=null;save();}
    }
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
    if(t-lastTick>=renderStep){
      const began=performance.now();draw(t);lastTick=t;
      lastDrawCost=performance.now()-began;measuredFrames++;
      avgDrawCost=avgDrawCost?avgDrawCost*.9+lastDrawCost*.1:lastDrawCost;
      if(lastRenderedAt>0){const instant=1000/Math.max(1,t-lastRenderedAt);frameRate=frameRate?frameRate*.9+instant*.1:instant;}
      lastRenderedAt=t;
      if(measuredFrames%12===0){
        // Dynamic throttle: only lower FPS after consistently costly frames.
        renderStep=lastDrawCost>25?50:lastDrawCost>13||nodes.length>850?33:25;
      }
    }
    if(active||moving||t<flashUntil||phase==='response'&&t-phaseAt<1500||phase==='error'&&t-phaseAt<1200)request();
    else if(phase!=='idle')setPhase('idle');
  }
  function coord(ev){const b=canvas.getBoundingClientRect();return{x:ev.clientX-b.left,y:ev.clientY-b.top};}
  function nearest(p){
    const scale=zoom*fitScale();
    const x=(p.x-width/2-pan.x)/scale,y=(p.y-height/2-pan.y)/scale;
    let best=null,dist=Infinity;
    for(const n of nodes){const d=(x-n.x)**2+(y-n.y)**2;const radius=n.kind==='core'?30:n.kind==='chat'?18:12;if(d<radius**2&&d<dist){dist=d;best=n;}}
    return best;
  }
  canvas.addEventListener('pointerdown',e=>{pointer=coord(e);moved=false;canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener('pointermove',e=>{
    if(!pointer){const candidate=nearest(coord(e));if(candidate?.id!==hovered?.id){hovered=candidate;request();}return;}
    const p=coord(e),dx=p.x-pointer.x,dy=p.y-pointer.y;
    if(Math.abs(dx)+Math.abs(dy)>2)moved=true;
    if(moved){cameraTarget=null;pan.x+=dx;pan.y+=dy;request();window.KiyomiraUnity?.relayout();}
    pointer=p;
  });
  canvas.addEventListener('pointerup',e=>{
    if(!moved){
      window.dispatchEvent(new CustomEvent('kiyomira-brain-interaction'));
      const n=nearest(coord(e));selected=n;
      info.textContent=n?n.kind==='core'?'Ядро Kiyomira — этапы реальных запросов':n.kind==='fact'?'Кандидат факта · источник #'+n.sourceId+' · требует проверки: '+n.label:n.label||'Сообщение':'Выберите узел, чтобы открыть диалог.';
      if(n?.documentId)window.dispatchEvent(new CustomEvent('kiyomira-brain-document',{detail:{documentId:n.documentId}}));
      else if(n?.chatId)window.dispatchEvent(new CustomEvent('kiyomira-brain-select',{detail:{chatId:n.chatId,messageId:n.messageId||n.sourceId||null}}));
      request();
    }
    pointer=null;save();
  });
  canvas.addEventListener('pointercancel',()=>{pointer=null;});
  canvas.addEventListener('pointerleave',()=>{hovered=null;request();});
  canvas.addEventListener('wheel',e=>{e.preventDefault();changeZoom(Math.exp(-e.deltaY*.001));},{passive:false});
  document.getElementById('brain-zoom-in')?.addEventListener('click',()=>changeZoom(1.3));
  document.getElementById('brain-zoom-out')?.addEventListener('click',()=>changeZoom(1/1.3));
  for(const button of document.querySelectorAll('[data-brain-mode]'))button.addEventListener('click',()=>setMode(button.dataset.brainMode));
  document.getElementById('brain-reset')?.addEventListener('click',()=>{cameraTarget={x:0,y:0};zoom=1;syncZoom();request();save();});
  document.getElementById('brain-focus')?.addEventListener('click',()=>{
    focus=!focus;document.body.classList.toggle('brain-focus',focus);
    const button=document.getElementById('brain-focus');button.textContent=focus?'Выход':'Фокус';
    button.setAttribute('aria-pressed',String(focus));resize();
  });
  try {
    const saved=JSON.parse(localStorage.getItem('kiyomira.brain.camera')||'{}');
    if(['circle','honeycomb','links','timeline'].includes(saved.mode))mode=saved.mode;
    if(Number.isFinite(saved.zoom))zoom=clamp(saved.zoom,.4,3.5);
    if(Number.isFinite(saved.x))pan.x=clamp(saved.x,-1200,1200);
    if(Number.isFinite(saved.y))pan.y=clamp(saved.y,-1200,1200);
  }catch{}
  function eventActivity(event){
    if(event.type==='контекст'){
      recalled=new Set((event.sources||[]).map(x=>'m'+x));phaseChat=event.chatId;
      memoryWaveAt=now();memoryWaveIds=new Set(recalled);flashUntil=memoryWaveAt+1550;
      live.textContent='ЧТЕНИЕ КОНТЕКСТА';request();
    }else if(event.type==='генерация')setPhase('request');
    else if(event.type==='сохранение'){setPhase('response');live.textContent='ЗАПИСЬ SQLITE';}
    else if(event.type==='ответ')setPhase('response');
    else if(event.type==='ошибка')setPhase('error');
    if(event.chatId&&event.type==='контекст'){
      const n=nodes.find(n=>n.kind==='chat'&&n.chatId===event.chatId);
      if(n&&zoom>=.95&&!pointer){cameraTarget={x:-n.x*zoom*fitScale(),y:-n.y*zoom*fitScale()};request();}
    }
  }
  document.addEventListener('visibilitychange',()=>{visible=!document.hidden;if(visible)request();});
  motion.addEventListener?.('change',request);
  new ResizeObserver(resize).observe(host);
  function showAnswerRoute(ids,chatId){
    // The route is reconstructed solely from links between real SQLite nodes.
    // Core -> topic group -> conversation -> each retrieved message.
    recalled=new Set((Array.isArray(ids)?ids:[]).filter(Number.isSafeInteger).map(id=>'m'+id));
    activeChat=chatId||null;
    sourceRouteEdges=new Set();
    const byId=new Map(nodes.map((n,i)=>[n.id,i]));
    const incoming=new Map();
    for(const [a,b] of edges){
      if(!incoming.has(b))incoming.set(b,[]);
      incoming.get(b).push(a);
    }
    for(const id of recalled){
      const target=byId.get(id);
      if(target===undefined)continue;
      const queue=[target],visited=new Set([target]);
      while(queue.length){
        const child=queue.shift();
        for(const parent of incoming.get(child)||[]){
          const node=nodes[parent];
          if(!node||!['core','cluster','chat'].includes(node.kind))continue;
          sourceRouteEdges.add(parent+':'+child);
          if(!visited.has(parent)){visited.add(parent);queue.push(parent);}
        }
      }
    }
    const first=nodes.find(n=>recalled.has(n.id));
    if(first&&!pointer&&zoom>=.8)cameraTarget={
      x:-first.x*zoom*fitScale(),y:-first.y*zoom*fitScale()
    };
    routeUntil=now()+2400;flashUntil=routeUntil;
    info.textContent=recalled.size?'Маршрут ответа · источники SQLite: '+recalled.size+
      ' · на карте: '+[...recalled].filter(id=>byId.has(id)).length:'Источники ответа не записаны';
    request();
  }
  window.KiyomiraBrain={
    update,setPhase,eventActivity,
    setMode,
    focusSources:showAnswerRoute,
    showAnswerRoute,
    setSelectedChat(chatId){
      activeChat=chatId||null;
      request();
    },
    getCorePosition(){const box=canvas.getBoundingClientRect();return {x:box.left+box.width/2+pan.x,y:box.top+box.height/2+pan.y};},
    getSourceScreenPoints(ids){
      const chosen=new Set((Array.isArray(ids)?ids:[]).filter(Number.isSafeInteger).slice(0,12));
      const box=canvas.getBoundingClientRect(),scale=zoom*fitScale();
      return nodes.filter(node=>node.kind==='message'&&chosen.has(node.messageId))
        .slice(0,8).map(node=>({
          id:node.messageId,
          x:box.left+box.width/2+pan.x+node.x*scale,
          y:box.top+box.height/2+pan.y+node.y*scale
        }));
    },
    getViewportStats(){return {fit:fitScale(),zoom:zoom*fitScale(),nodes:nodes.length,mode,detail:zoomLevel(),renderStep,routeEdges:sourceRouteEdges.size,lastDrawCost,avgDrawCost,frameRate,renderedFrames:measuredFrames,modeTransitionAge:Math.max(0,now()-modeTransitionAt),staticRingBuilds,semanticEdgeCount};},
    setBusy(value){setPhase(value?'request':'idle');}
  };
  syncZoom();setMode(mode);resize();
})();
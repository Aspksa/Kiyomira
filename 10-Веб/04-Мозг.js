'use strict';
// Kiyomira brain: real dialogue/message map. No simulated model internals.
(() => {
  const canvas = document.getElementById('brain-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const host = canvas.parentElement;
  const info = document.getElementById('brain-detail');
  const count = document.getElementById('brain-count');
  const live = document.getElementById('brain-live');
  let mode = 'circle', nodes = [], edges = [], pan = {x:0,y:0}, zoom = 1, picked = null;
  let pointer = null, moved = false, busy = false, visible = true, raf = 0, lastTick = 0, width = 0, height = 0;
  const TWO_PI = Math.PI * 2;
  const name = item => String(item || '').slice(0,90);
  function resize() {
    const bounds = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.max(bounds.width,1);height = Math.max(bounds.height,1);
    canvas.width = Math.ceil(width*dpr);canvas.height = Math.ceil(height*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    draw(performance.now());
  }
  function update(data) {
    const chats = Array.isArray(data.chats) ? data.chats : [];
    const fresh = []; const links = [];
    const maxChats = Math.min(24,chats.length);
    chats.slice(0,maxChats).forEach((chat,i) => {
      const a = (i / Math.max(maxChats,1)) * TWO_PI - Math.PI/2;
      const radius = 90 + (i%3)*42;
      const group = {id:'c'+chat.id,chatId:chat.id,label:name(chat.title),kind:'chat',x:Math.cos(a)*radius,y:Math.sin(a)*radius};
      fresh.push(group);links.push([0,fresh.length]);
      (chat.messages || []).slice(-6).forEach((message,j) => {
        const theta = a + (j-2.5)*.15;
        const r = radius+28+(j%3)*15;
        fresh.push({id:'m'+chat.id+'-'+j,chatId:chat.id,label:name(message.preview),kind:'message',x:Math.cos(theta)*r,y:Math.sin(theta)*r});
        links.push([fresh.indexOf(group)+1,fresh.length]);
      });
    });
    nodes = [{id:'core',label:'KIYOMIRA',kind:'core',x:0,y:0},...fresh];
    edges = links;
    if (!nodes.some(n=>n.id===picked?.id)) picked=null;
    count.textContent = chats.length+' диалогов · '+(nodes.length-1)+' узлов';
    if (!picked) info.textContent = chats.length ? 'Выберите узел, чтобы открыть диалог.' : 'Память пуста. Начните разговор — узлы появятся здесь.';
    layout();
    request();
  }
  function layout() {
    if (mode==='circle') return;
    nodes.slice(1).forEach((node,i)=>{
      if (mode==='honeycomb') {
        const col = i%11, row=Math.floor(i/11);
        node.x=(col-5)*49+(row%2)*24;
        node.y=(row-3)*43;
      } else {
        const angle=i*2.399963229728653;
        const r=42+18*Math.sqrt(i);
        node.x=Math.cos(angle)*r;node.y=Math.sin(angle)*r;
      }
    });
  }
  function setMode(next) {
    if(!['circle','honeycomb','links'].includes(next))return;
    mode=next;pan={x:0,y:0};zoom=1;
    document.querySelectorAll('[data-brain-mode]').forEach(button=>{
      const on=button.dataset.brainMode===mode;
      button.classList.toggle('selected',on);button.setAttribute('aria-pressed',String(on));
    });
    // Restore circular position using the current real-data order.
    if(mode==='circle') {
      const chats=[...new Set(nodes.slice(1).map(n=>n.chatId))];
      chats.forEach((id,i)=>{
        const a=(i/Math.max(chats.length,1))*TWO_PI-Math.PI/2, r=90+(i%3)*42;
        nodes.filter(n=>n.chatId===id).forEach((n,j)=>{
          const angle=j===0?a:a+(j-3.5)*.15;
          const radius=j===0?r:r+28+((j-1)%3)*15;
          n.x=Math.cos(angle)*radius;n.y=Math.sin(angle)*radius;
        });
      });
    } else layout();
    request();
  }
  function draw(time) {
    if(!width||!height)return;
    ctx.clearRect(0,0,width,height);
    ctx.fillStyle='#030201';ctx.fillRect(0,0,width,height);
    const cx=width/2+pan.x,cy=height/2+pan.y;
    ctx.save();ctx.translate(cx,cy);ctx.scale(zoom,zoom);
    const glow=ctx.createRadialGradient(0,0,3,0,0,Math.min(width,height)*.65);
    glow.addColorStop(0,'rgba(238,138,60,.10)');glow.addColorStop(1,'rgba(238,138,60,0)');
    ctx.fillStyle=glow;ctx.beginPath();ctx.arc(0,0,Math.min(width,height)*.65,0,TWO_PI);ctx.fill();
    if(mode==='circle') {
      ctx.strokeStyle='rgba(238,138,60,.12)';ctx.lineWidth=.8;
      [55,110,165,220,275].forEach(r=>{ctx.beginPath();ctx.arc(0,0,r,0,TWO_PI);ctx.stroke();});
      for(let i=0;i<8;i++){const a=i*TWO_PI/8;ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(Math.cos(a)*280,Math.sin(a)*280);ctx.stroke();}
    }
    if(mode==='honeycomb'){
      ctx.strokeStyle='rgba(238,138,60,.08)';ctx.lineWidth=.8;
      nodes.slice(1).forEach(n=>{ctx.beginPath();for(let k=0;k<=6;k++){const a=k*TWO_PI/6;const x=n.x+24*Math.cos(a),y=n.y+24*Math.sin(a);if(k===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.stroke();});
    }
    edges.forEach(([a,b])=>{
      const from=nodes[a],to=nodes[b];if(!from||!to)return;
      const active=picked&&(picked.id===from.id||picked.id===to.id);
      ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);
      ctx.strokeStyle=active?'rgba(255,207,154,.66)':mode==='links'?'rgba(238,138,60,.26)':'rgba(238,138,60,.15)';
      ctx.lineWidth=active?1.5:.8;ctx.stroke();
    });
    nodes.forEach((n,i)=>{
      const selected=n.id===picked?.id;
      const core=i===0, size=core?22:n.kind==='chat'?8:3.5;
      if(core&&busy) {
        const pulse=28+7*Math.sin(time/330);
        ctx.strokeStyle='rgba(238,138,60,.55)';ctx.lineWidth=2;
        ctx.beginPath();ctx.arc(0,0,pulse,0,TWO_PI);ctx.stroke();
      }
      ctx.shadowBlur=core?25:selected?20:8;
      ctx.shadowColor='#ee8a3c';
      ctx.fillStyle=core?'#2d1709':selected?'#ffcf9a':n.kind==='chat'?'#d58643':'#905c35';
      ctx.strokeStyle=core?'#ffcf9a':'#b97541';
      ctx.lineWidth=core?2:1;
      ctx.beginPath();ctx.arc(n.x,n.y,size,0,TWO_PI);ctx.fill();ctx.stroke();ctx.shadowBlur=0;
      if(core||selected||n.kind==='chat'&&zoom>.78) {
        ctx.fillStyle=core?'#ffcf9a':'#bca18a';
        ctx.font=(core?'bold 10px':'10px')+' ui-monospace,Consolas,monospace';
        ctx.textAlign='center';
        ctx.fillText(core?'KIYOMIRA':n.label.slice(0,14),n.x,n.y+size+15);
      }
    });
    ctx.restore();
  }
  function request(){if(!raf&&visible)raf=requestAnimationFrame(loop);}
  function loop(t){raf=0;if(!visible)return;if(t-lastTick>25){draw(t);lastTick=t;}if(busy)request();}
  function point(ev){const b=canvas.getBoundingClientRect();return{x:ev.clientX-b.left,y:ev.clientY-b.top};}
  function nearest(p){let best=null,dist=Infinity;for(const n of nodes){const dx=(p.x-width/2-pan.x)/zoom-n.x,dy=(p.y-height/2-pan.y)/zoom-n.y;const d=dx*dx+dy*dy;if(d<Math.pow(n.kind==='core'?28:n.kind==='chat'?15:11,2)&&d<dist){best=n;dist=d;}}return best;}
  canvas.addEventListener('pointerdown',e=>{pointer=point(e);moved=false;canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener('pointermove',e=>{if(!pointer)return;const p=point(e),dx=p.x-pointer.x,dy=p.y-pointer.y;if(Math.abs(dx)+Math.abs(dy)>2)moved=true;if(moved){pan.x+=dx;pan.y+=dy;request();}pointer=p;});
  canvas.addEventListener('pointerup',e=>{if(!moved){const n=nearest(point(e));picked=n;info.textContent=n?(n.kind==='core'?'Ядро Kiyomira · события запросов Cloud.ru':n.label||'Сообщение'):'Выберите узел, чтобы открыть диалог.';if(n?.chatId)window.dispatchEvent(new CustomEvent('kiyomira-brain-select',{detail:{chatId:n.chatId}}));request();}pointer=null;});
  canvas.addEventListener('pointercancel',()=>{pointer=null;});
  canvas.addEventListener('wheel',e=>{e.preventDefault();zoom=Math.max(.4,Math.min(3.4,zoom*Math.exp(-e.deltaY*.001)));request();},{passive:false});
  document.querySelectorAll('[data-brain-mode]').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.brainMode)));
  document.getElementById('brain-reset')?.addEventListener('click',()=>{zoom=1;pan={x:0,y:0};request();});
  window.addEventListener('kiyomira-brain-select',()=>{});
  document.addEventListener('visibilitychange',()=>{visible=!document.hidden;if(visible)request();});
  new ResizeObserver(resize).observe(host);
  window.KiyomiraBrain={update,setBusy(value){busy=!!value;live.textContent=busy?'ГЕНЕРАЦИЯ ОТВЕТА':'ОЖИДАНИЕ';live.classList.toggle('running',busy);request();}};
  resize();
})();

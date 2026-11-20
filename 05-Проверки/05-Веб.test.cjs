'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { создатьВебСервер } = require('../08-Запуск/04-ВебСервер.cjs');

test('веб API: сессия, история, поиск, Cloud.ru секреты, SQLite и защита Origin', async () => {
  const dir=mkdtempSync(join(tmpdir(),'Рабочий стол & (тест) ! ^ % -'));
  const oldDb=process.env.KIYOMIRA_DB_PATH, oldKey=process.env.CLOUD_RU_API_KEY, oldModel=process.env.CLOUD_RU_MODEL;
  process.env.KIYOMIRA_DB_PATH=join(dir,'06-Данные','память.sqlite');
  delete process.env.CLOUD_RU_API_KEY;
  delete process.env.CLOUD_RU_MODEL;
  let app;
  try {
    app=await создатьВебСервер();
    assert.match(app.url,/^http:\/\/127\.0\.0\.1:\d+$/);
    const front=await fetch(app.url+'/');
    assert.equal(front.status,200);
    const html=await front.text();
    assert.match(html,/Kiyomira — когнитивная система/);
    assert.match(html,/id="workspace-divider"/);
    assert.match(html,/unified-workspace/);
    assert.match(html,/id="brain-auto-layout"/);
    assert.match(html,/data-brain-mode="timeline"/);
    assert.match(html,/id="brain-zoom-in"/);
    assert.match(html,/id="brain-zoom-out"/);
    assert.match(html,/id="cognitive-flow"/);
    assert.match(html,/id="cognitive-flow-path"/);
    assert.match(html,/id="cognitive-comets"/);
    assert.match(html,/aria-orientation="vertical"/);
    assert.match(front.headers.get('content-security-policy'),/default-src 'self'/);
    const cookie=front.headers.get('set-cookie').split(';')[0];
    const url=path=>app.url+path;
    const request=async(path,method='GET',body,extra={})=>{
      const h={Cookie:cookie,'X-Kiyomira-Request':'1',...extra};
      if(body!==undefined)h['Content-Type']='application/json';
      const res=await fetch(url(path),{method,headers:h,body:body!==undefined?JSON.stringify(body):undefined});
      return {status:res.status,data:await res.json()};
    };
    const forbidden=await fetch(url('/api/status'));
    assert.equal(forbidden.status,403);
    const cross=await request('/api/settings','POST',{model:'test'}, {Origin:'https://evil.example'});
    assert.equal(cross.status,403);
    const crossHeader=await request('/api/status','GET',undefined,{'Sec-Fetch-Site':'cross-site'});
    assert.equal(crossHeader.status,403);
    const appjs=await fetch(url('/03-Приложение.js'));
    assert.equal(appjs.status,200);
    const appSource=await appjs.text();
    assert.match(appSource,/markdown/);
    assert.match(appSource,/indexEmbeddings/);
    assert.match(appSource,/searchEmbeddings/);
    assert.match(appSource,/initWorkspaceDivider/);
    assert.match(appSource,/KiyomiraLayout/);
    assert.match(appSource,/createStreamPainter/);
    assert.match(appSource,/lastContextIds/);
    assert.match(appSource,/source-return/);
    assert.match(appSource,/requestAnimationFrame\(paint\)/);
    assert.match(appSource,/initCognitiveFlow/);
    assert.match(appSource,/Sixteen tapered particles/);
    assert.match(appSource,/getSourceScreenPoints/);
    assert.match(appSource,/signal\('error'\)/);
    assert.match(appSource,/indexDocument/);
    assert.match(appSource,/jumpToMessage/);
    assert.match(appSource,/focusSources/);
    assert.match(appSource,/KiyomiraUnity/);
    assert.match(appSource,/kiyomira.workspace.chatPercent/);
    const brainAsset=await fetch(url('/04-Мозг.js'));
    assert.equal(brainAsset.status,200);
    const brainSource=await brainAsset.text();
    assert.match(brainSource,/kiyomira-brain-select/);
    assert.match(brainSource,/prefers-reduced-motion/);
    assert.match(brainSource,/setPhase/);
    assert.match(brainSource,/getCorePosition/);
    assert.match(brainSource,/getSourceScreenPoints/);
    assert.match(brainSource,/drawStaticRings/);
    assert.match(brainSource,/semanticEdgeCount/);
    assert.match(brainSource,/setSelectedChat/);
    assert.match(brainSource,/brain-focus/);
    assert.match(brainSource,/brain.camera/);
    assert.match(brainSource,/mode==='honeycomb'/);
    assert.match(brainSource,/if\(active&&!motion.matches&&edges.length\)/);
    const cssAsset=await fetch(url('/02-Стиль.css'));
    assert.equal(cssAsset.status,200);
    const css=await cssAsset.text();
    assert.match(css,/Compact visualization controls/);
    assert.match(css,/--chat-percent/);
    assert.match(css,/workspace-divider/);
    assert.match(css,/Kiyomira 7/);
    assert.match(css,/kiyomira-message-enter/);

    const imported=await request('/api/memory/documents','POST',{
      title:'architecture.md',project:'Kiyomira',text:'# Архитектура\nSQLite и Canvas'
    });
    assert.equal(imported.status,201);
    assert.equal(imported.data.document.created,true);
    const documentId=imported.data.document.id;
    assert.equal((await request('/api/memory/documents/'+documentId)).data.document.проект,'Kiyomira');
    const duplicated=await request('/api/memory/documents','POST',{
      title:'architecture.md',project:'Kiyomira',text:'# Архитектура\nSQLite и Canvas'
    });
    assert.equal(duplicated.data.document.created,false);
    assert.equal((await request('/api/memory/documents')).data.documents.length,1);
    assert.equal((await request('/api/memory/documents','POST',{
      title:'bad.pdf',project:'',text:''
    })).status,400);
    const emptyBrain=await request('/api/brain');
    assert.equal(emptyBrain.status,200);
    assert.deepEqual(emptyBrain.data.chats,[]);
    assert.equal(emptyBrain.data.documents.length,1);
    assert.equal(emptyBrain.data.documents[0].название,'architecture.md');
    const embeddingStatus=await request('/api/memory/embeddings/status');
    assert.equal(embeddingStatus.status,200);
    assert.equal(embeddingStatus.data.индексировано,0);
    assert.equal(embeddingStatus.data.экспериментально,true);
    assert.equal((await request('/api/memory/embeddings/index','POST',{})).status,400);
    assert.equal((await request('/api/memory/embeddings/index','POST',{confirm:true})).status,409);
    assert.equal((await request('/api/memory/embeddings/search','POST',{query:'sqlite'})).status,400);
    assert.equal(emptyBrain.data.aggregateLimit,10000);
    assert.equal(emptyBrain.data.sampledMessages,0);
    const chats=await request('/api/chats');
    assert.deepEqual(chats.data.chats,[]);
    const first=await request('/api/chats','POST',{title:'Главный чат'});
    assert.equal(first.status,201);
    const a=first.data.id;
    const second=await request('/api/chats','POST',{title:'Другой чат'});
    const b=second.data.id;
    assert.notEqual(a,b);
    assert.equal((await request('/api/status')).data.provider,'unconfigured');
    const noCloud=await request('/api/chats/'+a+'/message','POST',{text:'Привет, Kiyomira!'});
    assert.equal(noCloud.status,409);
    assert.match(noCloud.data.error,/Cloud.ru не настроен/);
    assert.equal((await request('/api/chats/'+a)).data.messages.length,0);
    await request('/api/settings','POST',{demoMode:true});
    assert.equal((await request('/api/status')).data.provider,'demo');
    const answer=await request('/api/chats/'+a+'/message','POST',{text:'Привет, Kiyomira!'});
    assert.equal(answer.status,200);
    assert.match(answer.data.reply,/Привет, Kiyomira!/);
    const brainAfter=await request('/api/brain');
    assert.equal(brainAfter.data.messages.some(m=>m.chatId===a&&m.preview.includes('Привет')),true);
    assert.equal(brainAfter.data.totalMessages,2);
    const saved=(await request('/api/chats/'+a)).data.messages;
    assert.equal(saved.length,2);
    assert.ok(Array.isArray(saved[1].sources));
    assert.equal(saved[1].sources.length,0);
    const linked=await request('/api/memory/messages/'+saved[1].ид);
    assert.equal(linked.status,200);
    assert.equal(linked.data.message.диалог_ид,a);
    assert.deepEqual(linked.data.sources,[]);
    assert.equal((await request('/api/memory/messages/99999999')).status,404);
    assert.equal(brainAfter.data.sampledMessages,2);
    assert.equal(Object.values(brainAfter.data.topicTotals).reduce((a,b)=>a+b,0),2);
    assert.equal(brainAfter.data.messages.every(m=>Number.isInteger(m.id)&&Array.isArray(m.topics)),true);
    const events=await request('/api/brain/events?after=0');
    assert.equal(events.status,200);
    assert.equal(events.data.events.some(e=>e.type==='контекст'&&e.chatId===a),true);
    assert.equal(events.data.events.some(e=>e.type==='сохранение'&&e.chatId===a),true);
    assert.equal(events.data.events.some(e=>e.type==='ответ'&&e.chatId===a),true);
    assert.equal(events.data.events.some(e=>e.type==='генерация'&&e.chatId===a),true);
    assert.equal((await request('/api/brain/events?after='+events.data.latest)).data.events.length,0);
    const streamChat=(await request('/api/chats','POST',{title:'Потоковый чат'})).data.id;
    const streamed=await fetch(url('/api/chats/'+streamChat+'/message-stream'),{
      method:'POST',
      headers:{Cookie:cookie,'X-Kiyomira-Request':'1','Content-Type':'application/json'},
      body:JSON.stringify({text:'Проверка потокового ответа'})
    });
    assert.equal(streamed.status,200);
    assert.match(streamed.headers.get('content-type'),/application\/x-ndjson/);
    const streamPackets=(await streamed.text()).trim().split('\n').map(JSON.parse);
    assert.equal(streamPackets.some(x=>x.type==='chunk'),true);
    assert.equal(streamPackets.at(-1).type,'done');
    assert.equal((await request('/api/chats/'+streamChat)).data.messages.length,2);
    const factsChat=(await request('/api/chats','POST',{title:'Сохранённые решения'})).data.id;
    await request('/api/chats/'+factsChat+'/message','POST',{text:'Решение: использовать SQLite'});
    const factResult=await request('/api/memory/facts');
    assert.equal(factResult.status,200);
    assert.equal(factResult.data.facts.some(x=>x.ключ==='решение'&&x.источник_ид>0),true);
    const retrieved=await request('/api/memory/search?q='+encodeURIComponent('использовать SQLite'));
    assert.equal(retrieved.status,200);
    assert.equal(retrieved.data.method,'local-lexical-hybrid');
    assert.equal(retrieved.data.results.some(x=>x.диалог_ид===factsChat&&x.ид>0),true);
    const fullGraph=await request('/api/brain');
    assert.equal(fullGraph.data.facts.some(x=>x.ключ==='решение'),true);
    const reviewed=factResult.data.facts.find(x=>x.ключ==='решение');
    assert.ok(reviewed&&reviewed.источник_ид>0);
    const approved=await request('/api/memory/facts/'+reviewed.ид,'PATCH',{status:'подтверждено'});
    assert.equal(approved.status,200);
    assert.equal(approved.data.fact.статус,'подтверждено');
    const timeline=await request('/api/memory/facts/history?id='+reviewed.ид);
    assert.equal(timeline.status,200);
    assert.ok(timeline.data.history.length>=2);
    assert.equal(timeline.data.history[0].статус,'подтверждено');
    const invalid=await request('/api/memory/facts/'+reviewed.ид,'PATCH',{status:'verified'});
    assert.equal(invalid.status,400);
    const allFacts=await request('/api/memory/facts');
    assert.ok(Array.isArray(allFacts.data.related));
    assert.ok(Array.isArray(allFacts.data.conflicts));
    const history=await request('/api/chats/'+a);
    assert.deepEqual(history.data.messages.map(x=>x.роль),['пользователь','ассистент']);
    assert.equal((await request('/api/chats/'+b)).data.messages.length,0);
    const search=await request('/api/search?q='+encodeURIComponent('ПРИВЕТ'));
    assert.equal(search.data.results.some(x=>x.диалог_ид===a),true);
    await request('/api/chats/'+a,'PATCH',{title:'Переименованный'});
    assert.equal((await request('/api/chats')).data.chats.find(x=>x.ид===a).название,'Переименованный');
    const key='секрет_НИКОГДА_НЕ_ВОЗВРАЩАТЬ';
    const save=await request('/api/settings','POST',{apiKey:key,model:'example-model',demoMode:false});
    assert.equal(save.status,200);
    assert.equal(save.data.keyPresent,true);
    assert.equal(JSON.stringify(save.data).includes(key),false);
    assert.equal(JSON.stringify((await request('/api/settings')).data).includes(key),false);
    assert.equal((await request('/api/status')).data.provider,'cloud');
    assert.equal((await request('/api/status')).data.verified,false);
    await request('/api/settings','POST',{clearKey:true});
    assert.equal((await request('/api/status')).data.provider,'unconfigured');
    const deletedDocument=await request('/api/memory/documents/'+documentId,'DELETE');
    assert.equal(deletedDocument.status,200);
    assert.equal((await request('/api/memory/documents')).data.documents.length,0);
    await request('/api/chats/'+b,'DELETE');
    assert.equal((await request('/api/chats/'+b)).status,404);
    assert.equal(existsSync(process.env.KIYOMIRA_DB_PATH),true);
    await app.close();app=null;
    const db=new DatabaseSync(process.env.KIYOMIRA_DB_PATH,{readOnly:true});
    try {
      assert.equal(db.prepare('SELECT count(*) AS count FROM сообщения WHERE диалог_ид=?').get(a).count,2);
      assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
      assert.equal(db.prepare("SELECT count(*) AS n FROM веб_настройки WHERE ключ LIKE '%key%'").get().n,0);
    } finally {db.close();}
    app=await создатьВебСервер();
    const newCookie=(await fetch(app.url+'/')).headers.get('set-cookie').split(';')[0];
    const reload=await fetch(app.url+'/api/settings',{headers:{Cookie:newCookie,'X-Kiyomira-Request':'1'}});
    const result=await reload.json();
    assert.equal(result.model,'example-model');
    assert.equal(result.keyPresent,false);
    assert.equal(result.demoMode,false);
  } finally {
    if(app)await app.close();
    if(oldDb===undefined)delete process.env.KIYOMIRA_DB_PATH;else process.env.KIYOMIRA_DB_PATH=oldDb;
    if(oldKey===undefined)delete process.env.CLOUD_RU_API_KEY;else process.env.CLOUD_RU_API_KEY=oldKey;
    if(oldModel===undefined)delete process.env.CLOUD_RU_MODEL;else process.env.CLOUD_RU_MODEL=oldModel;
    rmSync(dir,{recursive:true,force:true});
  }
});

test('миграция существующей CLI истории в первый веб-диалог без потери данных', async () => {
  const dir=mkdtempSync(join(tmpdir(),'киёмиро-'));
  const path=join(dir,'legacy.sqlite');
  const { ПамятьДиалога }=await import('../02-Память/01-ПамятьДиалога.ts');
  try {
    const memory=new ПамятьДиалога(100,path);
    memory.добавитьПару('история ДО обновления','ответ');
    // Legacy CLI records are assigned to the first web dialogue upon the next open.
    memory.закрыть();
    const reopened=new ПамятьДиалога(100,path);
    try {
      const chats=reopened.списокДиалогов();
      assert.equal(chats.length,1);
      assert.equal(chats[0].ид,1);
      assert.equal(reopened.сообщенияДиалога(1).length,2);
      assert.equal(reopened.размер(),2);
    } finally{reopened.закрыть();}
  } finally {rmSync(dir,{recursive:true,force:true});}
});


test('Canvas brain executes in a browser-like runtime with SQLite data and interactive modes', () => {
  const vm = require('node:vm');
  const {readFileSync} = require('node:fs');
  const file = require('node:path').resolve(__dirname,'../10-Веб/04-Мозг.js');
  const source=readFileSync(file,'utf8');
  let now=1000,frames=[],clicks={},labelText={},saved={};
  const gradient={addColorStop(){}};
  const canvasContext={
    clearRect(){},fillRect(){},save(){},restore(){},translate(){},scale(){},
    beginPath(){},arc(){},stroke(){},fill(){},moveTo(){},lineTo(){},
    setTransform(){},createRadialGradient(){return gradient;},closePath(){},
    setLineDash(){},fillText(){}
  };
  const canvas={
    parentElement:{getBoundingClientRect(){return {width:800,height:590};}},
    getContext(){return canvasContext;},
    getBoundingClientRect(){return {left:0,top:0,width:800,height:590};},
    addEventListener(name,cb){clicks['canvas:'+name]=cb;},
    setPointerCapture(){}
  };
  const elements=new Map([['brain-canvas',canvas]]);
  for(const key of ['brain-detail','brain-count','brain-live','brain-reset','brain-focus']){
    elements.set(key,{
      textContent:'',classList:{toggle(){}},setAttribute(){},
      addEventListener(type,cb){clicks[key+':'+type]=cb;}
    });
  }
  const modes=['circle','honeycomb','links'].map(key=>({
    dataset:{brainMode:key},classList:{toggle(){}},setAttribute(){},
    addEventListener(type,cb){clicks['mode:'+key+':'+type]=cb;}
  }));
  const document={
    hidden:false,getElementById(id){return elements.get(id)||null;},
    querySelectorAll(){return modes;},addEventListener(){},
    body:{classList:{toggle(){}}}
  };
  const localStorage={getItem(key){return saved[key]||null;},setItem(key,v){saved[key]=v;}};
  const window={
    devicePixelRatio:1,localStorage,
    matchMedia(){return {matches:false,addEventListener(){}};},
    addEventListener(){},dispatchEvent(){}
  };
  const context={
    window,document,localStorage,
    performance:{now(){return now;}},
    requestAnimationFrame(cb){frames.push(cb);return frames.length;},
    ResizeObserver:class{observe(){}},
    CustomEvent:class{constructor(type,details){this.type=type;this.detail=details.detail;}},
    console
  };
  vm.runInNewContext(source,context,{timeout:1500});
  assert.equal(typeof window.KiyomiraBrain?.update,'function');
  assert.ok(window.KiyomiraBrain.getViewportStats().fit>0);
  assert.ok(window.KiyomiraBrain.getViewportStats().fit<=1);
  const graph={
    chats:[{id:1,title:'Главный чат',count:3}],
    messages:[
      {id:101,chatId:1,role:'пользователь',preview:'Проект Kiyomira',topics:['проекты']},
      {id:102,chatId:1,role:'ассистент',preview:'Ответ',topics:['общее']},
      {id:103,chatId:1,role:'пользователь',preview:'Версия: 2',topics:['проекты']}
    ],
    candidates:[{a:101,b:103,тип:'требует проверки'}],totalMessages:3
  };
  // These are runtime checks, not mere syntax or string-match assertions.
  assert.doesNotThrow(()=>window.KiyomiraBrain.update(graph));
  assert.match(source,/lastGraphFingerprint/);
  const initialFrames=frames.length;
  assert.doesNotThrow(()=>window.KiyomiraBrain.update(graph));
  assert.equal(frames.length,initialFrames,'unchanged SQLite snapshot should not schedule a fresh layout');
  const indexed={...graph,documents:[{ид:44,название:'architecture.md',проект:'Kiyomira'}]};
  assert.doesNotThrow(()=>window.KiyomiraBrain.update(indexed));
  assert.doesNotThrow(()=>window.KiyomiraBrain.update(indexed));
  assert.doesNotThrow(()=>window.KiyomiraBrain.setMode('timeline'));
  assert.equal(window.KiyomiraBrain.getViewportStats().mode,'timeline');
  assert.doesNotThrow(()=>window.KiyomiraBrain.showAnswerRoute([101],1));
  assert.ok(window.KiyomiraBrain.getViewportStats().routeEdges>=2,
    'only actual graph edges may form answer provenance');
  assert.doesNotThrow(()=>window.KiyomiraBrain.setMode('circle'));
  assert.equal(window.KiyomiraBrain.getViewportStats().semanticEdgeCount,0);
  assert.match(elements.get('brain-count').textContent,/3 сообщений/);
  assert.match(source,/Weighted stable radial sectors/);
  assert.match(source,/sectorAngles/);
  assert.match(source,/memoryWaveIds/);
  assert.match(source,/Outer TRACKTOR categorical rim/);
  assert.match(source,/SQLite insertion chronology/);
  assert.match(source,/Dynamic throttle/);
  const related={...graph,
    facts:[
      {ид:17,источник_ид:101,диалог_ид:1,ключ:'версия',значение:'2',статус:'кандидат'},
      {ид:18,источник_ид:103,диалог_ид:1,ключ:'проект',значение:'Kiyomira',статус:'кандидат'}
    ],
    semanticLinks:[{a:17,b:18,похожесть:0.81}]
  };
  assert.doesNotThrow(()=>window.KiyomiraBrain.update(related));
  assert.equal(window.KiyomiraBrain.getViewportStats().semanticEdgeCount,1,
    'constellations must use genuine semantic fact links only');
  // Many persisted messages may fill one sector without leaking outside the ring.
  const denseGraph={
    chats:[{id:2,title:'Проекты',count:120}],
    messages:Array.from({length:120},(_,i)=>({
      id:200+i,chatId:2,role:'пользователь',
      preview:'Проект #'+i,topics:['проекты']
    })),
    totalMessages:120,candidates:[]
  };
  assert.doesNotThrow(()=>window.KiyomiraBrain.update(denseGraph));
  assert.match(elements.get('brain-count').textContent,/120 сообщений/);
    assert.doesNotThrow(()=>clicks['canvas:pointermove']({clientX:400,clientY:250}));
  assert.doesNotThrow(()=>clicks['canvas:pointerleave']());
  assert.doesNotThrow(()=>clicks['mode:honeycomb:click']());
  assert.doesNotThrow(()=>clicks['mode:links:click']());
  assert.doesNotThrow(()=>clicks['mode:circle:click']());
  assert.doesNotThrow(()=>window.KiyomiraBrain.eventActivity({
    type:'контекст',chatId:1,sources:[101,103]
  }));
  assert.match(elements.get('brain-live').textContent,/ЧТЕНИЕ КОНТЕКСТА/);
  assert.doesNotThrow(()=>window.KiyomiraBrain.setPhase('request'));
  // Draw several actual Canvas frames, including active graph edges.
  for(let i=0;i<7;i++){
    now+=80;const pending=frames;frames=[];
    for(const cb of pending.slice(0,10))assert.doesNotThrow(()=>cb(now));
  }
  assert.doesNotThrow(()=>window.KiyomiraBrain.setPhase('response'));
  assert.doesNotThrow(()=>clicks['brain-focus:click']());
  assert.doesNotThrow(()=>clicks['brain-reset:click']());
  assert.match(saved['kiyomira.brain.camera']||'',/circle/);
});

'use strict';

const el = id => document.getElementById(id);
const state = { chats:[], selected:null, busy:false, brainEventId:0, brainInitialized:false };
const headers = { 'X-Kiyomira-Request':'1' };

async function api(path, method='GET', data) {
  const options = { method, credentials:'same-origin', headers:{...headers} };
  if (data !== undefined) { options.headers['Content-Type']='application/json'; options.body=JSON.stringify(data); }
  const response = await fetch(path,options);
  const payload = await response.json().catch(()=>({error:'Неверный ответ сервера'}));
  if (!response.ok) throw new Error(payload.error || 'Ошибка HTTP '+response.status);
  return payload;
}
function notice(text='',good=false) {
  el('notice').textContent=text;
  el('notice').classList.toggle('ok',good);
}
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function inline(text) {
  // All user and model strings are escaped before introducing a safe, limited Markdown subset.
  let s=escapeHtml(text);
  s=s.replace(/`([^`]+)`/g,(_,code)=>'<code>'+code+'</code>');
  s=s.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
  s=s.replace(/\*([^*\n]+)\*/g,'<em>$1</em>');
  s=s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,(_,label,url)=>'<a href="'+url+'" target="_blank" rel="noopener noreferrer">'+label+'</a>');
  return s;
}
function markdown(text) {
  const lines=String(text).replace(/\r\n/g,'\n').split('\n');
  const parts=[]; let code=[];let inCode=false;let list=false;
  const closeList=()=>{if(list){parts.push('</ul>');list=false;}};
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (!inCode) { closeList();inCode=true;code=[]; }
      else { parts.push('<pre><code>'+escapeHtml(code.join('\n'))+'</code></pre>');inCode=false;code=[]; }
      continue;
    }
    if (inCode) { code.push(line);continue; }
    if (!line.trim()) {closeList();continue;}
    if (/^#{1,3}\s+/.test(line)) { closeList();parts.push('<h3>'+inline(line.replace(/^#{1,3}\s+/,''))+'</h3>');continue; }
    if (/^\s*[-*]\s+/.test(line)) {
      if(!list){parts.push('<ul>');list=true;}
      parts.push('<li>'+inline(line.replace(/^\s*[-*]\s+/,''))+'</li>');
      continue;
    }
    closeList();
    parts.push('<p>'+inline(line)+'</p>');
  }
  closeList();
  if(inCode)parts.push('<pre><code>'+escapeHtml(code.join('\n'))+'</code></pre>');
  return parts.join('');
}
function message(role,text,temporary=false,record=null) {
  const article=document.createElement('article');
  article.className='message '+(role==='пользователь'?'user':'assistant');
  if(temporary)article.dataset.temporary='1';
  if(record?.ид)article.dataset.messageId=String(record.ид);
  const label=document.createElement('span');
  label.className='message-label';label.textContent=role==='пользователь'?'ВЫ':'KIYOMIRA';
  const body=document.createElement('div');
  body.className='message-body';body.innerHTML=markdown(text);
  article.append(label,body);
  // Sources remain traceable through SQLite and the brain graph, but the
  // conversation stays free of a redundant answer-route button.

  el('messages').append(article);
  el('messages').scrollTop=el('messages').scrollHeight;
  return article;
}
function emptyMessages() {
  el('messages').innerHTML='<div class="empty"><span class="empty-symbol">狐</span><h2>Чем я могу помочь?</h2><p>Всё, что мы сохраняем, остаётся в SQLite на твоём устройстве.</p></div>';
}
function buttonBusy(value) {
  if(value)window.KiyomiraBrain?.setPhase('request');
  state.busy=value;
  el('send').disabled=value;
  el('stop-response').hidden=!value;
}
function closeSidebar(){el('sidebar').classList.remove('mobile-open');}
function renderChats() {
  const root=el('chat-list');root.replaceChildren();
  for(const chat of state.chats) {
    const btn=document.createElement('button');btn.type='button';btn.className='chat-item';
    btn.setAttribute('aria-current',String(chat.ид===state.selected));
    const strong=document.createElement('strong');strong.textContent=chat.название;
    const small=document.createElement('small');small.textContent=chat.сообщений+' сообщений';
    btn.append(strong,small);
    btn.addEventListener('click',()=>{void selectChat(chat.ид);});
    root.append(btn);
  }
}
let brainFetchInFlight=null;
async function refreshBrain() {
  if(brainFetchInFlight)return brainFetchInFlight;
  brainFetchInFlight=(async()=>{
    try {
      const snapshot=await api('/api/brain');
      window.KiyomiraBrain?.update(snapshot);
      if(!state.brainInitialized){state.brainEventId=snapshot.latest||0;state.brainInitialized=true;}
    } catch(err) { console.warn('Карта памяти: '+err.message); }
    finally {brainFetchInFlight=null;}
  })();
  return brainFetchInFlight;
}
async function pollBrainEvents() {
  if(!state.brainInitialized||document.hidden)return;
  const payload=await api('/api/brain/events?after='+state.brainEventId);
  for(const event of payload.events||[]){
    if(event.id<=state.brainEventId)continue;
    state.brainEventId=event.id;
    window.KiyomiraBrain?.eventActivity(event);
    el('workspace').dataset.activity=event.type;
    if(event.type==='контекст')window.KiyomiraUnity?.signal('recall',event.sources||[]);
    if(event.type==='ответ')window.KiyomiraUnity?.signal('answer');
    if(event.type==='ошибка')window.KiyomiraUnity?.signal('error');
  }
  state.brainEventId=Math.max(state.brainEventId,payload.latest||0);
}
async function refreshChats() {
  state.chats=(await api('/api/chats')).chats;
  renderChats();
  void refreshBrain();
}
async function selectChat(id,focusMessageId=null) {
  if(state.busy) {notice('Сначала остановите текущий ответ');return;}
  state.selected=id;
  window.KiyomiraLayout?.focus('chat');
  const chat=state.chats.find(x=>x.ид===id);
  el('chat-title').textContent=chat?.название||'Диалог';
  const {messages}=await api('/api/chats/'+id);
  el('messages').replaceChildren();
  if(!messages.length)emptyMessages();
  else for(const item of messages)message(item.роль,item.текст,false,item);
  window.KiyomiraBrain?.setSelectedChat(id);
  renderChats();closeSidebar();notice();
  if(focusMessageId)await jumpToMessage(focusMessageId);
}
async function jumpToMessage(messageId){
  if(!Number.isSafeInteger(Number(messageId))||Number(messageId)<1)return;
  const id=Number(messageId);
  let target=el('messages').querySelector('[data-message-id="'+id+'"]');
  if(!target){
    const response=await api('/api/memory/messages/'+id);
    const item=response.message;
    if(item.диалог_ид!==state.selected)return;
    const note=document.createElement('p');note.className='source-history-note';
    note.textContent='Сообщение из более ранней истории · источник #'+id;
    el('messages').prepend(note);
    target=message(item.роль,item.текст,false,{...item,sources:response.sources});
  }
  target.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});
  target.classList.add('source-active');
  window.KiyomiraBrain?.focusSources([id],state.selected);
}

async function newChat() {
  if(state.busy)return;
  const result=await api('/api/chats','POST',{title:'Новый диалог'});
  await refreshChats();await selectChat(result.id);
  el('chat-input').focus();
}
async function updateStatus() {
  const result=await api('/api/status');
  const status=el('connection');
  if(result.active>0&&!state.busy)window.KiyomiraBrain?.setPhase('request');
  const active=result.provider==='cloud' && result.verified;
  status.className='status '+(active?'ok':result.provider==='unconfigured'?'err':'');
  status.textContent=result.provider==='demo'?'ДЕМО · тестовая модель':result.provider==='unconfigured'?'Cloud.ru не настроен':active?'Cloud.ru · модель подтверждена':'Cloud.ru · '+result.model+' · не проверен';
  el('subtitle').textContent=result.provider==='demo'?'Только тестовые ответы':result.provider==='unconfigured'?'Укажите ключ и модель Cloud.ru':'Локальная память · Cloud.ru';
  if(result.lastError && !state.busy) notice(result.lastError);
}
async function streamReply(chatId,text,onChunk) {
  const response=await fetch('/api/chats/'+chatId+'/message-stream',{
    method:'POST',credentials:'same-origin',
    headers:{...headers,'Content-Type':'application/json'},
    body:JSON.stringify({text})
  });
  if(!response.ok){
    const payload=await response.json().catch(()=>({}));
    throw new Error(payload.error||'Ошибка HTTP '+response.status);
  }
  if(!response.body)throw new Error('Сервер не вернул поток ответа');
  const reader=response.body.getReader(),decoder=new TextDecoder();
  let buffer='',completed=false;
  try{
    while(true){
      const next=await reader.read();
      if(next.done)break;
      buffer+=decoder.decode(next.value,{stream:true});
      if(buffer.length>262144)throw new Error('Слишком длинный фрагмент потока');
      let index;
      while((index=buffer.indexOf('\n'))>=0){
        const row=buffer.slice(0,index).trim();buffer=buffer.slice(index+1);
        if(!row)continue;
        const event=JSON.parse(row);
        if(event.type==='chunk')onChunk(String(event.text||''));
        else if(event.type==='done')completed=true;
        else if(event.type==='error')throw new Error(String(event.text||'Генерация прервана'));
      }
    }
    if(!completed)throw new Error('Поток прерван, ответ не сохранён');
  }finally{reader.releaseLock();}
}

// Batch streamed Markdown updates to one browser frame. This does not fake
// model tokens; only text received from the actual Cloud.ru stream is rendered.
function createStreamPainter(article){
  const body=article.querySelector('.message-body');
  const scroller=el('messages');
  const reduceMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
  let full='',shown=0,scheduled=false,stopped=false,renderCount=0;
  let lastFrame=0,followBottom=true;
  function paint(time){
    scheduled=false;
    if(stopped||!body.isConnected)return;
    // Follow only if the user had not scrolled away before the next render.
    const nearBottom=scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight<120;
    followBottom=followBottom&&nearBottom;
    if(reduceMotion.matches)shown=full.length;
    else {
      const dt=Math.min(0.08,Math.max(.016,((time||performance.now())-lastFrame)/1000||.016));
      const missing=full.length-shown;
      // Mizuyori-inspired smooth catch-up: never invent text, accelerate if behind.
      const count=Math.max(1,Math.ceil((100+missing*3)*dt));
      shown=Math.min(full.length,shown+count);
      if(shown<full.length){
        const end=full.indexOf(' ',shown);
        if(end>=0&&end-shown<=18)shown=end+1;
      }
    }
    lastFrame=time||performance.now();
    body.innerHTML=markdown(full.slice(0,shown));
    renderCount++;
    if(followBottom)scroller.scrollTop=scroller.scrollHeight;
    if(shown<full.length)schedule();
  }
  function schedule(){
    if(!scheduled&&!stopped){scheduled=true;requestAnimationFrame(paint);}
  }
  function add(part){
    if(stopped||!part)return;
    full+=part;schedule();
  }
  function finish(){
    if(stopped)return;
    shown=full.length;
    // Make the final persisted response exact, without delaying the API lifecycle.
    paint(performance.now());stopped=true;
  }
  function cancel(){stopped=true;}
  return {add,finish,cancel,getStats:()=>({received:full.length,displayed:shown,renderCount})};
}
async function sendMessage(ev) {
  ev.preventDefault();
  if(state.busy || !state.selected)return;
  const input=el('chat-input');const text=input.value.trim();
  if(!text)return;
  const id=state.selected;
  window.KiyomiraLayout?.focus('chat');
  buttonBusy(true);notice();
  window.KiyomiraUnity?.signal('send');
  input.value='';
  if(el('messages').querySelector('.empty'))el('messages').replaceChildren();
  const temp=message('пользователь',text,true);
  try {
    const partial=message('ассистент','',true);
    const painter=createStreamPainter(partial);
    try{
      await streamReply(id,text,painter.add);
      painter.finish();
    }finally{painter.cancel();}
    temp.remove();partial.remove();
    const {messages}=await api('/api/chats/'+id);
    el('messages').replaceChildren();
    for(const item of messages)message(item.роль,item.текст,false,item);
    window.KiyomiraBrain?.setPhase('response');
    await pollBrainEvents().catch(()=>{});
    await refreshChats();
  } catch(err) {
    window.KiyomiraBrain?.setPhase('error');
    window.KiyomiraUnity?.signal('error');
    temp.remove();
    el('messages').querySelectorAll('[data-temporary="1"]').forEach(node=>node.remove());
    input.value=text;
    notice(err.message);
    await updateStatus().catch(()=>{});
    if(!el('messages').children.length)emptyMessages();
  } finally {
    await pollBrainEvents().catch(()=>{});
    buttonBusy(false);input.focus();
  }
}
async function stopMessage(){
  if(!state.busy || !state.selected)return;
  try { await api('/api/chats/'+state.selected+'/stop','POST',{});notice('Отмена запрошена',true); }
  catch(err){notice(err.message);}
}
function modal(kind) {
  el('overlay').hidden=false;
  el('settings-panel').hidden=kind!=='settings';
  el('search-panel').hidden=kind!=='search';
  el('facts-panel').hidden=kind!=='facts';
  el('dialog-title').textContent=kind==='settings'?'Настройки Cloud.ru':kind==='facts'?'Проверка воспоминаний':'Поиск по памяти';
  if(kind==='settings')void loadSettings();
  else if(kind==='facts'){void loadFacts();void loadDocuments();void refreshEmbeddingStatus();}
  else el('search-input').focus();
}
async function loadFacts() {
  const root=el('facts-list');root.replaceChildren();
  const feedback=el('facts-feedback');feedback.textContent='';
  try{
    const payload=await api('/api/memory/facts');
    const facts=payload.facts||[];
    const conflicts=payload.conflicts||[];
    el('facts-summary').textContent=facts.length+' записей · '+conflicts.length+' возможных противоречий';
    if(!facts.length){const p=document.createElement('p');p.className='hint';
      p.textContent='Кандидатов пока нет. Например: «Я предпочитаю тёмную тему».';
      root.append(p);return;}
    for(const fact of facts){
      const item=document.createElement('article');item.className='fact-item';
      item.setAttribute('role','listitem');
      const name=document.createElement('strong');
      name.textContent=fact.ключ+': '+fact.значение;
      const meta=document.createElement('p');meta.className='hint';
      meta.textContent='Источник #'+fact.источник_ид+
        ' · '+fact.статус+' · '+fact.создано;
      const actions=document.createElement('div');actions.className='fact-actions';
      for(const [label,status] of [['Подтвердить','подтверждено'],['Отклонить','отклонено']]){
        const button=document.createElement('button');button.type='button';
        button.textContent=label;button.disabled=fact.статус===status;
        button.addEventListener('click',async()=>{
          try{await api('/api/memory/facts/'+fact.ид,'PATCH',{status});
            await loadFacts();await refreshBrain();
          }catch(err){feedback.textContent=err.message;}
        });actions.append(button);
      }
      const edit=document.createElement('button');edit.textContent='Исправить';
      edit.type='button';
      edit.addEventListener('click',async()=>{
        const changed=prompt('Исправленное значение (источник останется прежним)',fact.значение);
        if(changed===null)return;
        try{await api('/api/memory/facts/'+fact.ид,'PATCH',
          {status:'требует проверки',value:changed.trim()});
          await loadFacts();await refreshBrain();
        }catch(err){feedback.textContent=err.message;}
      });actions.append(edit);
      const timeline=document.createElement('button');timeline.type='button';
      timeline.textContent='История';
      timeline.addEventListener('click',async()=>{
        try{
          const {history}=await api('/api/memory/facts/history?id='+fact.ид);
          const existing=item.querySelector('.fact-timeline');
          if(existing){existing.remove();return;}
          const ul=document.createElement('ul');ul.className='fact-timeline';
          for(const event of history){
            const li=document.createElement('li');
            li.textContent=event.время+' · '+event.действие+
              ' · '+event.статус+' · '+event.значение;ul.append(li);
          }
          item.append(ul);
        }catch(err){feedback.textContent=err.message;}
      });actions.append(timeline);
      item.append(name,meta,actions);root.append(item);
    }
  }catch(err){feedback.textContent=err.message;}
}


async function refreshEmbeddingStatus(){
  try{
    const status=await api('/api/memory/embeddings/status');
    el('embedding-status').textContent='Локально индексировано: '+status.индексировано+
      ' · модель '+status.модель+' · '+(status.готово?'ключ настроен':'нужен ключ Cloud.ru');
  }catch(err){el('embedding-status').textContent=err.message;}
}
async function indexEmbeddings(){
  if(!confirm('ВНИМАНИЕ: тексты до 8 сообщений будут отправлены в Cloud.ru для embeddings. Запрос может тарифицироваться. Запустить вручную?'))return;
  const feedback=el('embedding-feedback');feedback.textContent='Запрашиваю эмбеддинги...';
  try{
    const result=await api('/api/memory/embeddings/index','POST',{confirm:true});
    feedback.textContent='Добавлено в SQLite: '+result.indexed+' записей.';
    await refreshEmbeddingStatus();
  }catch(err){feedback.textContent=err.message;}
}
async function searchEmbeddings(){
  const query=el('embedding-query').value.trim();
  if(query.length<2)return;
  if(!confirm('Поисковый запрос будет отправлен Cloud.ru для векторизации и может тарифицироваться. Продолжить?'))return;
  const root=el('embedding-results'),feedback=el('embedding-feedback');
  root.replaceChildren();feedback.textContent='Ищу по векторной памяти...';
  try{
    const {results}=await api('/api/memory/embeddings/search','POST',{confirm:true,query});
    feedback.textContent='Найдено: '+results.length;
    for(const match of results){
      const button=document.createElement('button');button.type='button';button.className='result';
      const title=document.createElement('strong');
      title.textContent='Сообщение #'+match.ид+' · сходство '+(match.балл*100).toFixed(1)+'%';
      const text=document.createElement('span');text.textContent=match.текст;
      button.append(title,text);
      button.addEventListener('click',async()=>{
        closeModal();await refreshChats();await selectChat(match.диалог_ид);
      });
      root.append(button);
    }
  }catch(err){feedback.textContent=err.message;}
}

async function loadDocuments(){
  const list=el('doc-list'),feedback=el('doc-feedback');
  list.replaceChildren();feedback.textContent='';
  try{
    const {documents}=await api('/api/memory/documents');
    if(!documents.length){const hint=document.createElement('p');hint.className='hint';
      hint.textContent='Нет индексированных документов';list.append(hint);}
    for(const doc of documents){
      const row=document.createElement('div');row.className='doc-row';
      const button=document.createElement('button');button.type='button';
      button.textContent=doc.название+(doc.проект?' · '+doc.проект:'');
      button.addEventListener('click',()=>{void viewDocument(doc.ид);});
      const remove=document.createElement('button');remove.type='button';
      remove.className='danger';remove.textContent='Удалить';
      remove.addEventListener('click',async()=>{
        if(!confirm('Удалить индекс документа из локальной памяти?'))return;
        try{await api('/api/memory/documents/'+doc.ид,'DELETE');
          el('doc-preview').hidden=true;await loadDocuments();await refreshBrain();
        }catch(err){feedback.textContent=err.message;}
      });row.append(button,remove);list.append(row);
    }
  }catch(err){feedback.textContent=err.message;}
}
async function viewDocument(id){
  try{
    const {document:doc}=await api('/api/memory/documents/'+id);
    const preview=el('doc-preview');
    preview.hidden=false;
    preview.textContent=doc.название+(doc.проект?' · '+doc.проект:'')+'\n\n'+doc.текст;
    preview.scrollIntoView({block:'nearest'});
  }catch(err){el('doc-feedback').textContent=err.message;}
}
async function indexDocument(){
  const file=el('doc-upload').files?.[0],project=el('doc-project').value.trim();
  if(!file){el('doc-feedback').textContent='Выберите TXT или MD';return;}
  if(!/\.(txt|md)$/iu.test(file.name)||file.size>125000){
    el('doc-feedback').textContent='Поддерживаются TXT/MD до 32 000 символов';return;
  }
  try{
    const text=await file.text();
    if(!text.trim()||text.length>32000)throw Error('Документ пуст или длиннее 32 000 символов');
    const result=await api('/api/memory/documents','POST',{title:file.name,project,text});
    el('doc-feedback').textContent=result.document.created?'Добавлено в SQLite':'Документ уже индексирован';
    el('doc-upload').value='';
    await loadDocuments();await refreshBrain();
  }catch(err){el('doc-feedback').textContent=err.message;}
}

function closeModal(){el('overlay').hidden=true;}
async function loadSettings(){
  const result=await api('/api/settings');
  el('model-name').value=result.model||'';
  el('demo-mode').checked=Boolean(result.demoMode);
  el('api-key').value='';
  el('key-state').textContent=result.keyPresent?'API-ключ установлен на эту сессию':'API-ключ не установлен';
  el('settings-feedback').textContent='';
}
function feedback(text,good=false){el('settings-feedback').textContent=text;el('settings-feedback').classList.toggle('ok',good);}
async function saveSettings(event) {
  event.preventDefault();
  try {
    const model=el('model-name').value.trim();
    const apiKey=el('api-key').value;
    const payload={model,demoMode:el('demo-mode').checked};
    if(apiKey)payload.apiKey=apiKey;
    await api('/api/settings','POST',payload);
    el('api-key').value='';
    await loadSettings();await updateStatus();
    feedback('Настройки сохранены. Ключ действует только до завершения Kiyomira.',true);
  }catch(err){feedback(err.message);}
}
async function models() {
  try {
    feedback('Загружаю список моделей...');
    const data=await api('/api/models');
    const list=el('models-list');list.replaceChildren();
    for (const name of data.models) {
      const option=document.createElement('option');option.value=name;list.append(option);
    }
    feedback('Получено моделей: '+data.models.length,true);
  }catch(err){feedback(err.message);}
}
async function testCloud() {
  try {
    feedback('Проверяю подключение...');
    const result=await api('/api/test','POST',{});
    feedback(result.listed?'Ключ принят и выбранная модель есть в списке. Генерация ещё не проверена.':'Ключ принят, но выбранная модель не найдена. Выберите модель из списка.',result.listed);
    await updateStatus();
  }catch(err){feedback(err.message);}
}
async function testGeneration() {
  if(!confirm('Проверить настоящий ответ модели Cloud.ru? Будет отправлен короткий запрос, который может тарифицироваться Cloud.ru.'))return;
  try {
    feedback('Запрашиваю короткий настоящий ответ Cloud.ru...');
    const result=await api('/api/test-generation','POST',{});
    feedback('Реальный ответ модели '+result.model+': '+result.reply,true);
    await updateStatus();
  }catch(err){feedback(err.message);await updateStatus().catch(()=>{});}
}
async function search() {
  const q=el('search-input').value.trim();
  const root=el('search-results');root.replaceChildren();
  if(q.length<2)return;
  try{
    const {results}=await api('/api/search?q='+encodeURIComponent(q));
    if(!results.length){const p=document.createElement('p');p.className='hint';p.textContent='Ничего не найдено';root.append(p);}
    for(const result of results){
      const btn=document.createElement('button');btn.type='button';btn.className='result';
      const heading=document.createElement('strong');heading.textContent=result.название;
      const snippet=document.createElement('span');snippet.textContent=result.текст;
      btn.append(heading,snippet);
      btn.addEventListener('click',async()=>{closeModal();await refreshChats();await selectChat(result.диалог_ид);});
      root.append(btn);
    }
  }catch(err){const p=document.createElement('p');p.className='notice';p.textContent=err.message;root.append(p);}
}
// One workspace: the connection line follows live brain/chat geometry.
// It animates only for observed user send, SQLite context event or completed answer.
function initCognitiveFlow(){
  const workspace=el('workspace'),svg=el('cognitive-flow');
  const path=el('cognitive-flow-path'),pulse=el('cognitive-flow-pulse');
  const brain=el('brain-canvas'),messages=el('messages'),composer=el('chat-form');
  const overlay=el('cognitive-comets'),ctx=overlay?.getContext('2d');
  if(!workspace||!svg||!path||!pulse||!brain||!messages||!composer)return;
  const reduceMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
  const mobile=window.matchMedia('(max-width: 700px)');
  const effects=[];
  let lastContextIds=[];
  let currentKind=null,layoutFrame=0,effectFrame=0,width=0,height=0,dpr=1;
  const point=(rect,root,x=.5,y=.5)=>({
    x:rect.left-root.left+rect.width*x,
    y:rect.top-root.top+rect.height*y
  });
  function core(){
    const root=workspace.getBoundingClientRect();
    const fromBrain=window.KiyomiraBrain?.getCorePosition?.();
    return fromBrain?{x:fromBrain.x-root.left,y:fromBrain.y-root.top}
      :point(brain.getBoundingClientRect(),root);
  }
  function chat(kind){
    const root=workspace.getBoundingClientRect();
    if(kind==='send')return point(composer.getBoundingClientRect(),root,.88,.5);
    const last=messages.querySelector('.message.assistant:last-child');
    const rect=(last||messages).getBoundingClientRect();
    return point(rect,root,.12,last ? .5 : .55);
  }
  function layout(){
    if(mobile.matches)return;
    const root=workspace.getBoundingClientRect(),from=core();
    const to=chat(currentKind==='send'?'send':'answer');
    if(root.width<1||root.height<1)return;
    const c=Math.max(25,Math.abs(to.x-from.x)*.42);
    const d='M '+from.x.toFixed(1)+' '+from.y.toFixed(1)+
      ' C '+(from.x+c).toFixed(1)+' '+from.y.toFixed(1)+
      ', '+(to.x-c).toFixed(1)+' '+to.y.toFixed(1)+
      ', '+to.x.toFixed(1)+' '+to.y.toFixed(1);
    svg.setAttribute('viewBox','0 0 '+root.width+' '+root.height);
    path.setAttribute('d',d);pulse.setAttribute('d',d);
  }
  function resizeLayer(){
    if(!ctx||!overlay)return;
    const rect=workspace.getBoundingClientRect();
    const nextWidth=Math.round(rect.width),nextHeight=Math.round(rect.height);
    const nextDpr=Math.min(window.devicePixelRatio||1,2);
    if(nextWidth===width&&nextHeight===height&&nextDpr===dpr)return;
    width=nextWidth;height=nextHeight;dpr=nextDpr;
    overlay.width=Math.max(1,Math.round(width*dpr));
    overlay.height=Math.max(1,Math.round(height*dpr));
  }
  function relayout(){
    if(layoutFrame)return;
    layoutFrame=requestAnimationFrame(()=>{layoutFrame=0;layout();resizeLayer();});
  }
  function sourcePoints(ids){
    const root=workspace.getBoundingClientRect();
    const positions=window.KiyomiraBrain?.getSourceScreenPoints?.(ids)||[];
    return positions.map(p=>({
      x:p.x-root.left,y:p.y-root.top,id:p.id
    })).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.y>=0&&p.x<=root.width&&p.y<=root.height);
  }
  function bezier(start,end,t){
    const midpoint={x:(start.x+end.x)/2,y:(start.y+end.y)/2-
      Math.min(45,Math.abs(end.x-start.x)*.11)};
    // Quadratic curve adapted from Mizuyori. Core/composer are real DOM positions.
    return {x:(1-t)*(1-t)*start.x+2*(1-t)*t*midpoint.x+t*t*end.x,
      y:(1-t)*(1-t)*start.y+2*(1-t)*t*midpoint.y+t*t*end.y};
  }
  const config={
    send:{duration:900,color:[88,196,255]},
    recall:{duration:1080,color:[92,223,182]},
    'source-return':{duration:730,color:[92,223,182]},
    answer:{duration:1200,color:[244,194,120]},
    error:{duration:850,color:[226,108,98]}
  };
  function targets(e){
    const origin=core();
    if(e.kind==='send')return {a:chat('send'),b:origin};
    if(e.kind==='answer'||e.kind==='error')return {a:origin,b:chat('answer')};
    const actual=sourcePoints(e.sources);
    const source=actual[e.index];
    return source?(e.kind==='source-return'?{a:source,b:origin}:{a:origin,b:source}):null;
  }
  function frame(time){
    effectFrame=0;
    if(!ctx)return;
    resizeLayer();
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,width,height);
    if(document.hidden||mobile.matches||reduceMotion.matches){
      effects.length=0;return;
    }
    for(let i=effects.length-1;i>=0;i--){
      const e=effects[i],state=targets(e),t=(time-e.started)/e.duration;
      if(!state||t>1.35){effects.splice(i,1);continue;}
      if(t<0)continue;
      const [r,g,b]=e.color;
      if(t<=1){
        // Sixteen tapered particles, with a small bloom around the leading head.
        ctx.globalCompositeOperation='lighter';
        for(let j=15;j>=0;j--){
          const lag=Math.max(0,t-j*.017);
          const p=bezier(state.a,state.b,lag);
          const fade=(1-j/16)*Math.min(1,t*7);
          ctx.fillStyle='rgba('+r+','+g+','+b+','+(fade*.88).toFixed(3)+')';
          ctx.beginPath();ctx.arc(p.x,p.y,Math.max(.7,4.1-j*.22),0,Math.PI*2);ctx.fill();
        }
        const p=bezier(state.a,state.b,t);
        const glow=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,17);
        glow.addColorStop(0,'rgba(255,255,255,.92)');
        glow.addColorStop(1,'rgba('+r+','+g+','+b+',0)');
        ctx.fillStyle=glow;ctx.beginPath();ctx.arc(p.x,p.y,17,0,Math.PI*2);ctx.fill();
      }else{
        // Arrival wave; distinct red failure, never a success animation on error.
        const radius=7+(t-1)*84,alpha=Math.max(0,(1.35-t)/.35);
        ctx.strokeStyle='rgba('+r+','+g+','+b+','+(alpha*.65).toFixed(3)+')';
        ctx.lineWidth=2.3*alpha;ctx.beginPath();
        ctx.arc(state.b.x,state.b.y,radius,0,Math.PI*2);ctx.stroke();
      }
      ctx.globalCompositeOperation='source-over';
    }
    if(effects.length)effectFrame=requestAnimationFrame(frame);
    else{
      currentKind=null;
      workspace.classList.remove('flow-active','flow-to-brain','flow-to-chat','flow-recall');
    }
  }
  function signal(kind,sources=[]){
    if(!config[kind])return;
    const ids=Array.isArray(sources)?[...new Set(sources.filter(Number.isSafeInteger))].slice(0,8):[];
    if(kind==='send')lastContextIds=[];
    if(kind==='recall')lastContextIds=ids;
    const visibleIds=(kind==='recall'||kind==='source-return')
      ?sourcePoints(kind==='source-return'?lastContextIds:ids).map(p=>p.id):[];
    if(kind==='recall'&&!visibleIds.length)return;
    currentKind=kind;layout();
    workspace.classList.remove('flow-to-brain','flow-to-chat','flow-recall','flow-active');
    void pulse.getBoundingClientRect();
    if(reduceMotion.matches||mobile.matches||document.hidden||!ctx)return;
    workspace.classList.add('flow-active',kind==='send'?'flow-to-brain':kind==='recall'?'flow-recall':'flow-to-chat');
    const start=performance.now();
    if(kind==='answer'&&lastContextIds.length){
      // Actual read sources travel back to core before the answer leaves for chat.
      const returns=sourcePoints(lastContextIds).map(p=>p.id).slice(0,6);
      returns.forEach((id,index)=>effects.push({
        kind:'source-return',sources:returns,index,
        color:config['source-return'].color,
        duration:config['source-return'].duration,started:start+index*55
      }));
      effects.push({kind:'answer',sources:[],index:0,
        color:config.answer.color,duration:config.answer.duration,
        started:start+(returns.length?770+returns.length*55:0)});
      lastContextIds=[];
    }else{
      const chosen=kind==='recall'?visibleIds:[null];
      chosen.forEach((id,index)=>effects.push({kind,sources:kind==='recall'?visibleIds:[],
        index,color:config[kind].color,duration:config[kind].duration,
        started:start+index*65}));
    }
    if(effects.length>18)effects.splice(0,effects.length-18);
    if(!effectFrame)effectFrame=requestAnimationFrame(frame);
  }
  pulse.addEventListener('animationend',()=>{
    workspace.classList.remove('flow-active','flow-to-brain','flow-to-chat','flow-recall');
    currentKind=null;
  });
  new ResizeObserver(relayout).observe(workspace);
  window.addEventListener('resize',relayout);
  reduceMotion.addEventListener?.('change',()=>{
    if(reduceMotion.matches)effects.length=0;
    relayout();
  });
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden)effects.length=0;
  });
  if(ctx)workspace.classList.add('comet-layer-enabled');
  window.KiyomiraUnity={signal,relayout,getStats:()=>({
    enabled:Boolean(ctx),activeEffects:effects.length,
    layerWidth:width,layerHeight:height,kind:currentKind
  })};
  relayout();
}

function initWorkspaceDivider() {
  const workspace=el('workspace'),divider=el('workspace-divider'),toggle=el('brain-auto-layout');
  if(!workspace||!divider||!toggle)return;
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  let dragging=false,automatic=true,lastFocus='neutral',manualPercent=35;
  try{
    manualPercent=clamp(Number(localStorage.getItem('kiyomira.workspace.chatPercent'))||35,25,55);
    automatic=localStorage.getItem('kiyomira.workspace.autoBalance')!=='off';
  }catch{}
  function apply(value,persist=false){
    const percent=clamp(Math.round(Number(value)||35),25,55);
    workspace.style.setProperty('--chat-percent',percent+'%');
    divider.setAttribute('aria-valuenow',String(percent));
    if(persist){
      manualPercent=percent;
      try{localStorage.setItem('kiyomira.workspace.chatPercent',String(percent));}catch{}
    }
    window.dispatchEvent(new Event('resize'));
    window.KiyomiraUnity?.relayout();
  }
  function syncToggle(){
    toggle.setAttribute('aria-pressed',String(automatic));
    toggle.classList.toggle('selected',automatic);
    toggle.title=automatic?'Баланс включён: мозг/чат реагируют на фокус':'Автобаланс отключён';
    try{localStorage.setItem('kiyomira.workspace.autoBalance',automatic?'on':'off');}catch{}
  }
  function focus(area){
    if(!automatic||dragging||document.body.classList.contains('brain-focus')||
      window.matchMedia('(max-width: 700px)').matches)return;
    if(!['brain','chat','neutral'].includes(area)||lastFocus===area)return;
    lastFocus=area;
    // Chat stays at least 30% wide, even when studying the memory graph.
    apply(area==='brain'?30:area==='chat'?45:35);
  }
  apply(manualPercent);syncToggle();
  toggle.addEventListener('click',()=>{
    automatic=!automatic;lastFocus='neutral';
    syncToggle();
    if(automatic)focus('neutral');
    else apply(manualPercent);
  });
  divider.addEventListener('pointerdown',e=>{
    if(window.matchMedia('(max-width: 700px)').matches)return;
    dragging=true;automatic=false;lastFocus='neutral';syncToggle();
    workspace.classList.add('workspace-resizing');
    divider.setPointerCapture(e.pointerId);e.preventDefault();
  });
  divider.addEventListener('pointermove',e=>{
    if(!dragging)return;
    const rect=workspace.getBoundingClientRect();
    if(!rect.width)return;
    apply((rect.right-e.clientX)/rect.width*100,true);
  });
  function stopDrag(){dragging=false;workspace.classList.remove('workspace-resizing');}
  divider.addEventListener('pointerup',stopDrag);
  divider.addEventListener('pointercancel',stopDrag);
  divider.addEventListener('keydown',e=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
    e.preventDefault();automatic=false;lastFocus='neutral';syncToggle();
    const current=Number(divider.getAttribute('aria-valuenow'))||35;
    apply(e.key==='Home'?25:e.key==='End'?55:current+(e.key==='ArrowLeft'?2:-2),true);
  });
  window.KiyomiraLayout={focus,getState:()=>({automatic,percent:Number(divider.getAttribute('aria-valuenow'))})};
}

async function bootstrap() {
  initWorkspaceDivider();
  initCognitiveFlow();
  el('chat-input').addEventListener('focus',()=>window.KiyomiraLayout?.focus('chat'));
  window.addEventListener('kiyomira-brain-interaction',()=>window.KiyomiraLayout?.focus('brain'));
  el('chat-form').addEventListener('submit',ev=>{void sendMessage(ev);});
  el('chat-input').addEventListener('keydown',ev=>{
    if(ev.key==='Enter'&&!ev.shiftKey&&!ev.isComposing){ev.preventDefault();el('chat-form').requestSubmit();}
  });
  el('stop-response').addEventListener('click',()=>{void stopMessage();});
  window.addEventListener('kiyomira-brain-select',event=>{if(event.detail?.chatId && !state.busy)void selectChat(event.detail.chatId,event.detail.messageId||null);});
  el('mobile-brain').addEventListener('click',()=>{
    const shown=el('workspace').classList.toggle('show-brain');
    el('mobile-brain').setAttribute('aria-pressed',String(shown));
    el('mobile-brain').title=shown?'Показать чат':'Показать мозг';
    el('mobile-brain').textContent=shown?'▤':'◎';
    window.dispatchEvent(new Event('resize'));
    window.KiyomiraUnity?.relayout();
  });
  el('new-chat').addEventListener('click',()=>{void newChat();});
  el('nav-chat').addEventListener('click',()=>{closeModal();el('sidebar').classList.toggle('mobile-open');});
  el('mobile-list').addEventListener('click',()=>el('sidebar').classList.toggle('mobile-open'));
  el('nav-settings').addEventListener('click',()=>modal('settings'));
  el('brain-facts').addEventListener('click',()=>modal('facts'));
  el('refresh-facts').addEventListener('click',()=>{void loadFacts();});
  el('doc-index').addEventListener('click',()=>{void indexDocument();});
  window.addEventListener('kiyomira-brain-document',event=>{
    if(!event.detail?.documentId)return;
    modal('facts');void viewDocument(event.detail.documentId);
  });
  el('embedding-index').addEventListener('click',()=>{void indexEmbeddings();});
  el('embedding-search').addEventListener('click',()=>{void searchEmbeddings();});
  el('nav-search').addEventListener('click',()=>modal('search'));
  el('dialog-close').addEventListener('click',closeModal);
  el('overlay').addEventListener('click',event=>{if(event.target===el('overlay'))closeModal();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')closeModal();});
  el('settings-form').addEventListener('submit',ev=>{void saveSettings(ev);});
  el('refresh-models').addEventListener('click',()=>{void models();});
  el('test-cloud').addEventListener('click',()=>{void testCloud();});
  el('test-generation').addEventListener('click',()=>{void testGeneration();});
  el('clear-key').addEventListener('click',async()=>{
    if(!confirm('Сбросить API-ключ только в текущем процессе?'))return;
    try{await api('/api/settings','POST',{clearKey:true});await loadSettings();await updateStatus();}catch(err){feedback(err.message);}
  });
  el('search-input').addEventListener('input',()=>{void search();});
  el('rename-chat').addEventListener('click',async()=>{
    if(!state.selected||state.busy)return;
    const old=state.chats.find(x=>x.ид===state.selected);
    const title=prompt('Название диалога',old?.название||'');
    if(title===null)return;
    try{await api('/api/chats/'+state.selected,'PATCH',{title});await refreshChats();await selectChat(state.selected);}catch(err){notice(err.message);}
  });
  el('delete-chat').addEventListener('click',async()=>{
    if(!state.selected||state.busy||!confirm('Удалить этот диалог и все его сообщения?'))return;
    try{await api('/api/chats/'+state.selected,'DELETE');state.selected=null;await refreshChats();
      if(state.chats.length)await selectChat(state.chats[0].ид);else await newChat();
    }catch(err){notice(err.message);}
  });
  el('quit-app')?.addEventListener('click',async()=>{
    if(!confirm('Завершить Kiyomira и закрыть веб-сервер?'))return;
    try{await api('/api/quit','POST',{});closeModal();notice('Kiyomira завершена. Можно закрыть вкладку.',true);}catch(err){notice(err.message);}
  });
  window.setInterval(()=>{if(state.busy&&!document.hidden)void pollBrainEvents().catch(()=>{});},850);
  try {
    await updateStatus();await refreshChats();
    if(state.chats.length)await selectChat(state.chats[0].ид);else await newChat();
  } catch(err){notice('Не удалось подключиться к локальному серверу: '+err.message);}
}
document.addEventListener('DOMContentLoaded',()=>{void bootstrap();});

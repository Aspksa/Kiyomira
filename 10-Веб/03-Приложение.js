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
function message(role,text,temporary=false) {
  const article=document.createElement('article');
  article.className='message '+(role==='пользователь'?'user':'assistant');
  if(temporary)article.dataset.temporary='1';
  const label=document.createElement('span');
  label.className='message-label';label.textContent=role==='пользователь'?'ВЫ':'KIYOMIRA';
  const body=document.createElement('div');
  body.className='message-body';body.innerHTML=markdown(text);
  article.append(label,body);
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
async function refreshBrain() {
  try {
    const snapshot=await api('/api/brain');
    window.KiyomiraBrain?.update(snapshot);
    if(!state.brainInitialized){state.brainEventId=snapshot.latest||0;state.brainInitialized=true;}
  } catch(err) { console.warn('Карта памяти: '+err.message); }
}
async function pollBrainEvents() {
  if(!state.brainInitialized||document.hidden)return;
  const payload=await api('/api/brain/events?after='+state.brainEventId);
  for(const event of payload.events||[]){
    if(event.id<=state.brainEventId)continue;
    state.brainEventId=event.id;
    window.KiyomiraBrain?.eventActivity(event);
  }
  state.brainEventId=Math.max(state.brainEventId,payload.latest||0);
}
async function refreshChats() {
  state.chats=(await api('/api/chats')).chats;
  renderChats();
  void refreshBrain();
}
async function selectChat(id) {
  if(state.busy) {notice('Сначала остановите текущий ответ');return;}
  state.selected=id;
  const chat=state.chats.find(x=>x.ид===id);
  el('chat-title').textContent=chat?.название||'Диалог';
  const {messages}=await api('/api/chats/'+id);
  el('messages').replaceChildren();
  if(!messages.length)emptyMessages();
  else for(const item of messages)message(item.роль,item.текст);
  renderChats();closeSidebar();notice();
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

async function sendMessage(ev) {
  ev.preventDefault();
  if(state.busy || !state.selected)return;
  const input=el('chat-input');const text=input.value.trim();
  if(!text)return;
  const id=state.selected;
  buttonBusy(true);notice();
  input.value='';
  if(el('messages').querySelector('.empty'))el('messages').replaceChildren();
  const temp=message('пользователь',text,true);
  try {
    const partial=message('ассистент','',true);
    let full='';
    await streamReply(id,text,part=>{
      full+=part;
      partial.querySelector('.message-body').innerHTML=markdown(full);
      el('messages').scrollTop=el('messages').scrollHeight;
    });
    temp.remove();partial.remove();
    const {messages}=await api('/api/chats/'+id);
    el('messages').replaceChildren();
    for(const item of messages)message(item.роль,item.текст);
    window.KiyomiraBrain?.setPhase('response');
    await pollBrainEvents().catch(()=>{});
    await refreshChats();
  } catch(err) {
    window.KiyomiraBrain?.setPhase('error');
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
  else if(kind==='facts'){void loadFacts();void refreshEmbeddingStatus();}
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
function initWorkspaceDivider() {
  const workspace=el('workspace'),divider=el('workspace-divider');
  if(!workspace||!divider)return;
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  function apply(value){
    const percent=clamp(Math.round(Number(value)||35),25,55);
    workspace.style.setProperty('--chat-percent',percent+'%');
    divider.setAttribute('aria-valuenow',String(percent));
    try{localStorage.setItem('kiyomira.workspace.chatPercent',String(percent));}catch{}
    window.dispatchEvent(new Event('resize'));
  }
  try{apply(localStorage.getItem('kiyomira.workspace.chatPercent')||35);}catch{apply(35);}
  let dragging=false;
  divider.addEventListener('pointerdown',e=>{
    if(window.matchMedia('(max-width: 700px)').matches)return;
    dragging=true;divider.setPointerCapture(e.pointerId);e.preventDefault();
  });
  divider.addEventListener('pointermove',e=>{
    if(!dragging)return;
    const rect=workspace.getBoundingClientRect();
    if(!rect.width)return;
    apply((rect.right-e.clientX)/rect.width*100);
  });
  divider.addEventListener('pointerup',()=>{dragging=false;});
  divider.addEventListener('pointercancel',()=>{dragging=false;});
  divider.addEventListener('keydown',e=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
    e.preventDefault();
    const current=Number(divider.getAttribute('aria-valuenow'))||35;
    apply(e.key==='Home'?25:e.key==='End'?55:current+(e.key==='ArrowLeft'?2:-2));
  });
}

async function bootstrap() {
  initWorkspaceDivider();
  el('chat-form').addEventListener('submit',ev=>{void sendMessage(ev);});
  el('chat-input').addEventListener('keydown',ev=>{
    if(ev.key==='Enter'&&!ev.shiftKey&&!ev.isComposing){ev.preventDefault();el('chat-form').requestSubmit();}
  });
  el('stop-response').addEventListener('click',()=>{void stopMessage();});
  window.addEventListener('kiyomira-brain-select',event=>{if(event.detail?.chatId && !state.busy)void selectChat(event.detail.chatId);});
  el('mobile-brain').addEventListener('click',()=>{
    const shown=el('workspace').classList.toggle('show-brain');
    el('mobile-brain').setAttribute('aria-pressed',String(shown));
    el('mobile-brain').title=shown?'Показать чат':'Показать мозг';
    el('mobile-brain').textContent=shown?'▤':'◎';
    window.dispatchEvent(new Event('resize'));
  });
  el('new-chat').addEventListener('click',()=>{void newChat();});
  el('nav-chat').addEventListener('click',()=>{closeModal();el('sidebar').classList.toggle('mobile-open');});
  el('mobile-list').addEventListener('click',()=>el('sidebar').classList.toggle('mobile-open'));
  el('nav-settings').addEventListener('click',()=>modal('settings'));
  el('brain-facts').addEventListener('click',()=>modal('facts'));
  el('refresh-facts').addEventListener('click',()=>{void loadFacts();});
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

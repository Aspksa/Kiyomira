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
    const result=await api('/api/chats/'+id+'/message','POST',{text});
    temp.remove();
    const {messages}=await api('/api/chats/'+id);
    el('messages').replaceChildren();
    for(const item of messages)message(item.роль,item.текст);
    window.KiyomiraBrain?.setPhase('response');
    if(!result.reply)notice('Пустой ответ модели');
    await pollBrainEvents().catch(()=>{});
    await refreshChats();
  } catch(err) {
    window.KiyomiraBrain?.setPhase('error');
    temp.remove();
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
  el('dialog-title').textContent=kind==='settings'?'Настройки Cloud.ru':'Поиск по памяти';
  if(kind==='settings')void loadSettings();
  else el('search-input').focus();
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
async function bootstrap() {
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

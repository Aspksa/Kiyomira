'use strict';
// Kiyomira's image is a UI character; the state shown below is only
// evidence-backed application activity, not a claimed inner consciousness.
(() => {
  const root=document.getElementById('persona-sky');
  if(!root)return;
  const state=document.getElementById('persona-state');
  const character=document.getElementById('persona-character');
  const growth=document.getElementById('persona-growth');
  const goal=document.getElementById('persona-goal');
  const activity=document.getElementById('persona-activity');
  const experiment=document.getElementById('persona-experiment');
  const toggle=document.getElementById('persona-learning-toggle');
  let enabled=true;
  const card=document.getElementById('persona-card');
  let lastEvent=0,inFlight=null;
  let currentPhase='idle';
  const labels={idle:'ОЖИДАНИЕ',контекст:'ЧТЕНИЕ ПАМЯТИ',генерация:'ОТВЕТ',сохранение:'СОХРАНЕНИЕ',
    ответ:'ГОТОВО',ошибка:'ОШИБКА','persona-growth':'УЧЁТ ОПЫТА',
    'persona-experiment':'ПРОВЕРКА ПОИСКА'};
  function setPhase(phase){
    currentPhase=Object.hasOwn(labels,phase)?phase:'idle';
    root.dataset.phase=currentPhase;
    state.textContent='ЛИЧНОСТЬ · '+labels[currentPhase];
  }
  async function refresh(){
    if(inFlight||document.hidden)return inFlight;
    inFlight=(async()=>{
      const response=await fetch('/api/personality',{credentials:'same-origin',
        headers:{'X-Kiyomira-Request':'1'}});
      if(!response.ok)throw Error('Недоступна личная память');
      const data=(await response.json()).personality;
      if(!data)return;
      enabled=data.развитие_включено!==false;
      toggle.textContent=enabled?'Приостановить фоновое развитие':'Возобновить фоновое развитие';
      toggle.setAttribute('aria-pressed',String(!enabled));
      const traits=Array.isArray(data.характер)?data.характер.slice(0,5):[];
      character.textContent=traits.join(', ')+'.';
      const count=Number.isSafeInteger(data.опыта)?data.опыта:0;
      growth.textContent='Зарегистрировано завершённых ответов: '+count+
        (data.ожидает?' · ожидает проверки: '+data.ожидает:'');
      const first=Array.isArray(data.цели)?data.цели[0]:null;
      goal.textContent=first?'Цель: '+first.название+' · '+first.статус:'Цели пока не зарегистрированы';
      const last=Array.isArray(data.события)?data.события[0]:null;
      activity.textContent=last?'Последний проверенный опыт: '+last.результат:
        'История опыта пока не создана';
      const check=Array.isArray(data.эксперименты)?data.эксперименты[0]:null;
      experiment.textContent=check?
        'Локальная проверка поиска: '+check.точность_текущая+'/'+check.образцов+
        ' → '+check.точность_кандидат+'/'+check.образцов+
        ' · '+check.результат.replaceAll('_',' '):
        'Локальные эксперименты поиска ещё не проводились.';
      if(last?.сообщение_ид && last.сообщение_ид!==lastEvent){
        lastEvent=last.сообщение_ид;
      }
    })();
    try{return await inFlight;}
    finally{inFlight=null;}
  }
  function eventActivity(event){
    if(!event)return;
    if(event.type==='persona-experiment'){
      setPhase('persona-experiment');
      void refresh().catch(()=>{});
    }else if(event.type==='persona-growth'){
      setPhase('persona-growth');
      void refresh().catch(()=>{});
    }else if(Object.hasOwn(labels,event.type)){
      setPhase(event.type);
      if(event.type==='ответ')void refresh().catch(()=>{});
    }
  }
  // Limit repeated calls. No animation frames are used by this component.
  card.addEventListener('toggle',()=>{if(card.open)void refresh().catch(()=>{});});
  toggle.addEventListener('click',async()=>{
    if(toggle.disabled)return;
    toggle.disabled=true;
    try{
      const response=await fetch('/api/personality/learning',{
        method:'POST',credentials:'same-origin',
        headers:{'X-Kiyomira-Request':'1','Content-Type':'application/json'},
        body:JSON.stringify({enabled:!enabled})
      });
      if(!response.ok)throw Error('Не удалось изменить разрешение');
      await refresh();
    }catch(err){activity.textContent=err.message||'Ошибка управления развитием';}
    finally{toggle.disabled=false;}
  });
  const ticker=setInterval(()=>{if(!document.hidden)void refresh().catch(()=>{});},15000);
  window.addEventListener('pagehide',()=>clearInterval(ticker),{once:true});
  window.KiyomiraPersona={setPhase,eventActivity,refresh};
  void refresh().catch(()=>{});
})();

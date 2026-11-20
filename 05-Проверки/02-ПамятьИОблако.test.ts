import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ПамятьДиалога } from '../02-Память/01-ПамятьДиалога.ts';
import { Ядро } from '../01-Ядро/02-Управление.ts';
import { ОблачнаяМодель } from '../04-Модели/03-ОблачнаяМодель.ts';
import { ТестоваяМодель } from '../04-Модели/02-ТестоваяМодель.ts';

test('SQLite восстанавливает диалог после повторного открытия', async () => {
  const папка = mkdtempSync(join(tmpdir(), 'kiyomira-'));
  const путь = join(папка, 'память.sqlite');
  try {
    const первая = new ПамятьДиалога(2, путь);
    const ядро = new Ядро(new ТестоваяМодель(), первая);
    ядро.запустить();
    await ядро.ответить('первое сообщение');
    await ядро.остановить();
    первая.закрыть();
    const вторая = new ПамятьДиалога(2, путь);
    assert.equal(вторая.размер(), 2);
    assert.deepEqual(вторая.получить().map(x => x.роль), ['пользователь', 'ассистент']);
    вторая.закрыть();
  } finally { rmSync(папка, { recursive: true, force: true }); }
});

test('ошибка модели не сохраняет половину диалога', async () => {
  const память = new ПамятьДиалога();
  const ядро = new Ядро({ async создатьОтвет() { throw new Error('нет ответа'); } }, память);
  ядро.запустить();
  await assert.rejects(ядро.ответить('вопрос'), /нет ответа/);
  assert.equal(память.размер(), 0);
  await ядро.остановить();
  память.закрыть();
});

test('Cloud.ru отправляет правильный запрос без реального API-вызова', async () => {
  let проверено = false;
  const подмена: typeof fetch = async (url, параметры) => {
    assert.equal(url, 'https://foundation-models.api.cloud.ru/v1/chat/completions');
    assert.equal((параметры?.headers as Record<string, string>).Authorization, 'Bearer тест-ключ');
    const тело = JSON.parse(String(параметры?.body));
    assert.equal(тело.model, 'тест-модель');
    assert.equal(тело.messages[0].role, 'user');
    проверено = true;
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Ответ Cloud.ru' } }] }), { status: 200 });
  };
  const клиент = new ОблачнаяМодель('тест-ключ', 'тест-модель', подмена);
  assert.equal(await клиент.создатьОтвет([{ роль: 'пользователь', текст: 'Привет' }]), 'Ответ Cloud.ru');
  assert.equal(проверено, true);
});

test('Cloud.ru не раскрывает ключ при ошибке HTTP', async () => {
  const подмена: typeof fetch = async () => new Response('ошибка', { status: 401 });
  const клиент = new ОблачнаяМодель('секрет', 'модель', подмена);
  await assert.rejects(клиент.создатьОтвет([{ роль: 'пользователь', текст: 'Привет' }]), /HTTP 401/);
});


test('Cloud.ru запрашивает каталог /v1/models и использует Bearer API key', async () => {
  const подмена: typeof fetch = async (url, параметры) => {
    assert.equal(url, 'https://foundation-models.api.cloud.ru/v1/models');
    assert.equal(параметры?.method, 'GET');
    assert.equal((параметры?.headers as Record<string,string>).Authorization, 'Bearer тест-ключ');
    return new Response(JSON.stringify({data:[{id:'ai-sage/GigaChat3-10B-A1.8B'},{id:'t-tech/T-pro-it-1.0'}]}),{status:200});
  };
  const клиент = new ОблачнаяМодель('тест-ключ','ai-sage/GigaChat3-10B-A1.8B',подмена);
  assert.deepEqual(await клиент.получитьМодели(),['ai-sage/GigaChat3-10B-A1.8B','t-tech/T-pro-it-1.0']);
});

test('Cloud.ru реальный пробный ответ использует 16 токенов и модель, без демо-фолбэка', async () => {
  const подмена: typeof fetch = async (_url, параметры) => {
    const body=JSON.parse(String(параметры?.body));
    assert.equal(body.model,'ai-sage/GigaChat3-10B-A1.8B');
    assert.equal(body.max_tokens,16);
    assert.equal(body.stream,false);
    return new Response(JSON.stringify({choices:[{message:{content:'Готово'}}]}),{status:200});
  };
  const клиент=new ОблачнаяМодель('секрет','ai-sage/GigaChat3-10B-A1.8B',подмена);
  assert.equal(await клиент.создатьОтвет([{роль:'пользователь',текст:'Ответь одним словом'}],undefined,16),'Готово');
});

test('Cloud.ru сообщает точный безопасный код HTTP 429 без секрета', async () => {
  const подмена: typeof fetch=async()=>new Response('Bearer тестовый_секрет_НЕ_ПЕРЕДАВАТЬ',{status:429});
  const клиент=new ОблачнаяМодель('тестовый_секрет_НЕ_ПЕРЕДАВАТЬ','модель',подмена);
  await assert.rejects(клиент.создатьОтвет([{роль:'пользователь',текст:'Привет'}]), e => {
    assert.match((e as Error).message,/HTTP 429/);
    assert.doesNotMatch((e as Error).message,/тестовый_секрет_НЕ_ПЕРЕДАВАТЬ/);
    return true;
  });
});

test('карта памяти: темы, кандидаты противоречий и точные источники контекста', async () => {
  const { определитьТемы, кандидатыПротиворечий } = await import('../02-Память/02-КартаЗнаний.ts');
  assert.equal(определитьТемы('SQLite и проект GitHub').includes('проекты'),true);
  assert.deepEqual(определитьТемы('абракадабра'),['общее']);
  const память=new ПамятьДиалога(50);
  try {
    const id=память.создатьДиалог('Проект Kiyomira');
    память.добавитьПару('Версия: 1.0','Принято',id);
    память.добавитьПару('Версия: 2.0','Изменено',id);
    const map=память.картаДиалогов(3);
    assert.equal(map.сообщения.length,3);
    assert.equal(map.всегоСообщений,4);
    assert.equal(память.источникиКонтекста(id).length,4);
    const candidates=кандидатыПротиворечий(память.картаДиалогов(100).сообщения);
    assert.equal(candidates.length,1);
    assert.equal(candidates[0].тип,'требует проверки');
    assert.equal(candidates[0].ключ,'версия');
  }finally{память.закрыть();}
});


test('Cloud.ru stream SSE handles UTF-8 chunks and rejects partial completions',async()=>{
  const encoder=new TextEncoder();
  const events=[
    'data: {"choices":[{"delta":{"content":"При"}}]}\n',
    '\ndata: {"choices":[{"delta":{"content":"вет"}}]}\n\n',
    'data: [DONE]\n\n'
  ];
  const fake:typeof fetch=async(_url,options)=>{
    const request=JSON.parse(String(options?.body));
    assert.equal(request.stream,true);
    return new Response(new ReadableStream({
      start(controller){for(const e of events)controller.enqueue(encoder.encode(e));controller.close();}
    }),{status:200,headers:{'Content-Type':'text/event-stream'}});
  };
  const cloud=new ОблачнаяМодель('тест-ключ','тест-модель',fake);
  const pieces:string[]=[];
  assert.equal(await cloud.создатьОтветПотоком([{роль:'пользователь',текст:'Привет'}],undefined,x=>pieces.push(x)),'Привет');
  assert.deepEqual(pieces,['При','вет']);
  const incomplete:typeof fetch=async()=>new Response('data: {"choices":[{"delta":{"content":"фрагмент"}}]}\n\n',{status:200});
  const broken=new ОблачнаяМодель('тест-ключ','тест-модель',incomplete);
  await assert.rejects(broken.создатьОтветПотоком([{роль:'пользователь',текст:'Тест'}],undefined,()=>{}),/поток завершён/);
});

test('streaming core writes atomic SQLite pair only after complete answer',async()=>{
  const memory=new ПамятьДиалога(50);
  const chat=memory.создатьДиалог('Streaming');
  const core=new Ядро({
    async создатьОтвет(){throw Error('Non-stream path unexpectedly called');},
    async создатьОтветПотоком(_messages,_signal,onChunk){onChunk('Часть');onChunk(' ответа');return 'Часть ответа';}
  },memory);
  core.запустить();
  const pieces:string[]=[];
  assert.equal(await core.ответитьПотоком('Вопрос',chat,undefined,x=>pieces.push(x)),'Часть ответа');
  assert.deepEqual(pieces,['Часть',' ответа']);
  assert.deepEqual(memory.сообщенияДиалога(chat).map(x=>x.роль),['пользователь','ассистент']);
  await core.остановить();memory.закрыть();
  const failedMemory=new ПамятьДиалога(50),failedChat=failedMemory.создатьДиалог('Failure');
  const failed=new Ядро({
    async создатьОтвет(){throw Error('not called');},
    async создатьОтветПотоком(_m,_s,onChunk){onChunk('Часть');throw Error('Interrupted');}
  },failedMemory);
  failed.запустить();
  await assert.rejects(failed.ответитьПотоком('Вопрос',failedChat,undefined,()=>{}),/Interrupted/);
  assert.equal(failedMemory.сообщенияДиалога(failedChat).length,0);
  await failed.остановить();failedMemory.закрыть();
});


test('local ranked retrieval: exact sources, false positives and reusable context',async()=>{
  const {релевантность,ранжировать}=await import('../02-Память/04-ГибридныйПоиск.ts');
  assert.ok(релевантность('Память SQLite','В проекте Kiyomira используется память SQLite')>6);
  assert.equal(релевантность('память sqlite','совершенно другая история'),0);
  const memory=new ПамятьДиалога(30);
  try{
    const original=memory.создатьДиалог('Предыдущая беседа');
    memory.добавитьПару('Проект: Kiyomira','Сохранил информацию',original);
    memory.добавитьПару('База данных: SQLite','Да',original);
    const newChat=memory.создатьДиалог('Новый чат');
    const matches=memory.поискГибридный('какая база данных SQLite');
    assert.equal(matches.some(row=>row.текст.includes('База данных: SQLite')&&row.ид>0),true);
    const context=memory.контекстПоЗапросу('Kiyomira проект',newChat);
    assert.equal(context.источники.length>0,true);
    assert.equal(context.история.some(item=>item.текст.includes('Источник #')),true);
    const facts=memory.кандидатыФактов();
    assert.equal(facts.length,2);
    assert.equal(facts.every(x=>x.статус==='требует проверки'),true);
    assert.equal(facts.every(x=>x.источник_ид>0),true);
    memory.добавитьПару('Проект: Kiyomira','Подтверждение',original);
    assert.equal(memory.связиФактов().length>0,true);
    memory.удалитьДиалог(original);
    assert.equal(memory.кандидатыФактов().length,0);
  }finally{memory.закрыть();}
});


test('Kiyomira 3 memory: plain-language candidates, explicit review and immutable timeline',async()=>{
  const {извлечьФакты}=await import('../02-Память/02-КартаЗнаний.ts');
  assert.equal(извлечьФакты('Я предпочитаю тёмную тему').some(x=>x.ключ==='предпочтение'),true);
  assert.equal(извлечьФакты('Я решил использовать SQLite').some(x=>x.ключ==='решение'),true);
  assert.deepEqual(извлечьФакты('Случайная беседа без утверждения'),[]);
  const memory=new ПамятьДиалога(100);
  try{
    const chat=memory.создатьДиалог('Факты v3');
    memory.добавитьПару('Я предпочитаю тёмную тему','Принято',chat);
    memory.добавитьПару('Я предпочитаю светлую тему','Принято',chat);
    const facts=memory.кандидатыФактов() as {ид:number;ключ:string;статус:string;источник_ид:number;значение:string}[];
    assert.equal(facts.length,2);
    assert.ok(facts.every(f=>f.источник_ид>0&&f.статус==='требует проверки'));
    assert.ok(memory.противоречияФактов().length>=1);
    const first=facts[0];
    memory.изменитьФакт(first.ид,'подтверждено');
    memory.изменитьФакт(first.ид,'требует проверки','исправленное предпочтение');
    const history=memory.историяФакта(first.ид) as {действие:string;статус:string;значение:string}[];
    assert.ok(history.length>=3);
    assert.equal(history[0].действие,'исправление');
    assert.equal(history[1].статус,'подтверждено');
    assert.ok(history.some(x=>x.действие==='извлечение'));
    memory.изменитьФакт(first.ид,'отклонено');
    assert.equal((memory.кандидатыФактов() as {ид:number;статус:string}[]).find(x=>x.ид===first.ид)?.статус,'отклонено');
    assert.equal(memory.противоречияФактов().length,0);
    memory.удалитьДиалог(chat);
    assert.deepEqual(memory.историяФакта(first.ид),[]);
  }finally{memory.закрыть();}
});


test('10k SQLite messages can be scanned without expanding the browser payload',()=>{
  const memory=new ПамятьДиалога(40);
  try{
    const chat=memory.создатьДиалог('Нагрузочная карта');
    for(let i=0;i<5000;i++)memory.добавитьПару('Вопрос номер '+i,'Ответ номер '+i,chat);
    const start=performance.now();
    const snapshot=memory.картаДиалогов(10000);
    const elapsed=performance.now()-start;
    assert.equal(snapshot.всегоСообщений,10000);
    assert.equal(snapshot.сообщения.length,10000);
    assert.equal(snapshot.сообщения[0].ид>0,true);
    assert.equal(snapshot.сообщения.at(-1)?.роль,'ассистент');
    assert.ok(elapsed<10000,'10k SQLite scan exceeded 10 seconds: '+elapsed);
  }finally{memory.закрыть();}
});


test('opt-in embedding adapter and SQLite vector cache work without live Cloud.ru calls',async()=>{
  const {CloudEmbeddings,МОДЕЛЬ_ЭМБЕДДИНГОВ}=await import('../04-Модели/04-Эмбеддинги.ts');
  let calls=0;
  const fake:typeof fetch=async(_url,init)=>{
    calls++;
    const payload=JSON.parse(String(init?.body));
    assert.equal(payload.model,МОДЕЛЬ_ЭМБЕДДИНГОВ);
    assert.equal(payload.input.length,1);
    return new Response(JSON.stringify({
      data:[{index:0,embedding:Array.from({length:32},(_,i)=>i===0?1:0)}]
    }),{status:200,headers:{'Content-Type':'application/json'}});
  };
  const adapter=new CloudEmbeddings('test-api-key',fake);
  const [vector]=await adapter.векторизовать(['Пример для теста']);
  assert.equal(calls,1);
  assert.equal(vector.length,32);
  const memory=new ПамятьДиалога(20);
  try{
    const chat=memory.создатьДиалог('Semantic');
    memory.добавитьПару('Моя память находится в SQLite','Принято',chat);
    const toIndex=memory.кандидатыВекторизации(МОДЕЛЬ_ЭМБЕДДИНГОВ,8);
    assert.equal(toIndex.length,1);
    assert.equal(memory.записатьВекторы(МОДЕЛЬ_ЭМБЕДДИНГОВ,
      [{...toIndex[0],вектор:vector}]),1);
    assert.equal(memory.кандидатыВекторизации(МОДЕЛЬ_ЭМБЕДДИНГОВ).length,0);
    assert.equal(memory.статусВекторов(МОДЕЛЬ_ЭМБЕДДИНГОВ).индексировано,1);
    const results=memory.поискПоВекторам(МОДЕЛЬ_ЭМБЕДДИНГОВ,vector,5);
    assert.equal(results.length,1);
    assert.equal(results[0].ид,toIndex[0].ид);
    assert.ok(results[0].балл>.99);
    assert.throws(()=>memory.записатьВекторы(МОДЕЛЬ_ЭМБЕДДИНГОВ,
      [{ид:toIndex[0].ид,текст:'Подменённый источник',вектор:vector}]),/не совпадает/);
    memory.удалитьДиалог(chat);
    assert.equal(memory.статусВекторов(МОДЕЛЬ_ЭМБЕДДИНГОВ).индексировано,0);
  }finally{memory.закрыть();}
});


test('Kiyomira 5 provenance remains linked to actual answer and survives reopen',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'k5-provenance-'));
  const path=join(dir,'memory.sqlite');
  let answerId=0,sourceId=0,chatId=0;
  try{
    const memory=new ПамятьДиалога(40,path);
    try{
      chatId=memory.создатьДиалог('Источники');
      memory.добавитьПару('Проект: Kiyomira','Принято',chatId);
      sourceId=memory.сообщенияДиалога(chatId)[0].ид;
      memory.добавитьПару('Что за проект?','Это Kiyomira',chatId,[sourceId,sourceId,999999]);
      const messages=memory.сообщенияДиалога(chatId);
      answerId=messages.at(-1)!.ид;
      assert.deepEqual(memory.источникиОтвета(answerId),[sourceId]);
      assert.equal(memory.сообщениеПоИд(sourceId)?.текст,'Проект: Kiyomira');
      assert.equal(memory.сообщениеПоИд(999999),null);
    }finally{memory.закрыть();}
    const memory2=new ПамятьДиалога(40,path);
    try{
      assert.deepEqual(memory2.источникиОтвета(answerId),[sourceId]);
      memory2.удалитьДиалог(chatId);
      assert.deepEqual(memory2.источникиОтвета(answerId),[]);
      assert.equal(memory2.сообщениеПоИд(sourceId),null);
    }finally{memory2.закрыть();}
  }finally{rmSync(dir,{recursive:true,force:true});}
});

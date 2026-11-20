'use strict';

const http = require('node:http');
const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { randomBytes } = require('node:crypto');

const TYPES = {
  '/': ['10-Веб/01-Страница.html', 'text/html; charset=utf-8'],
  '/02-Стиль.css': ['10-Веб/02-Стиль.css', 'text/css; charset=utf-8'],
  '/03-Приложение.js': ['10-Веб/03-Приложение.js', 'text/javascript; charset=utf-8'],
  '/04-Мозг.js': ['10-Веб/04-Мозг.js', 'text/javascript; charset=utf-8']
};

function json(ответ, статус, данные) {
  const тело = JSON.stringify(данные);
  ответ.writeHead(статус, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'Content-Length':Buffer.byteLength(тело) });
  ответ.end(тело);
}
function ошибка(сообщение, статус = 400) {
  return Object.assign(new Error(сообщение), { httpStatus: статус });
}
async function телоЗапроса(запрос) {
  if (!/^application\/json(?:;|$)/i.test(запрос.headers['content-type'] || '')) throw ошибка('Ожидается application/json',415);
  let текст = '';
  for await (const кусок of запрос) {
    текст += кусок.toString('utf8');
    if (Buffer.byteLength(текст) > 65536) throw ошибка('Запрос слишком большой',413);
  }
  try {
    const объект = JSON.parse(текст);
    if (!объект || Array.isArray(объект) || typeof объект !== 'object') throw Error();
    return объект;
  } catch { throw ошибка('Неверный JSON'); }
}
function idИзПути(путь) {
  const совпадение = /^\/api\/chats\/(\d+)(?:\/(message|message-stream|stop))?$/.exec(путь);
  if (!совпадение) return null;
  const ид = Number(совпадение[1]);
  if (!Number.isSafeInteger(ид) || ид < 1) throw ошибка('Неверный номер диалога');
  return { ид, действие: совпадение[2] || '' };
}

async function создатьВебСервер({ корень = resolve(__dirname, '..'), порт = 0 } = {}) {
  // Reuse the existing TypeScript core, memory and cloud provider; do not duplicate response logic.
  const [{ Ядро }, { ПамятьДиалога }, { ТестоваяМодель }, { ОблачнаяМодель }, { определитьТемы, кандидатыПротиворечий }] = await Promise.all([
    import('../01-Ядро/02-Управление.ts'),
    import('../02-Память/01-ПамятьДиалога.ts'),
    import('../04-Модели/02-ТестоваяМодель.ts'),
    import('../04-Модели/03-ОблачнаяМодель.ts'),
    import('../02-Память/02-КартаЗнаний.ts')
  ]);
  const база = new ПамятьДиалога(200, process.env.KIYOMIRA_DB_PATH || join(корень, '06-Данные', 'память.sqlite'));
  let ключ = process.env.CLOUD_RU_API_KEY || '';
  let модель = process.env.CLOUD_RU_MODEL || база.настройка('модель') || '';
  let демоРежим = false;
  let проверено = false;
  let последняяОшибка = '';
  let закрывается = false;
  const активные = new Map();
  const ожидают = new Set();
  const демонстрация = new ТестоваяМодель();
  const провайдер = {
    async создатьОтветПотоком(история, сигнал, onChunk) {
      if (демоРежим) {const text=await демонстрация.создатьОтвет(история);onChunk(text);return text;}
      if (!ключ || !модель) throw ошибка('Cloud.ru не настроен: укажите API-ключ и модель в настройках',409);
      try {
        const result=await new ОблачнаяМодель(ключ,модель).создатьОтветПотоком(история,сигнал,onChunk);
        последняяОшибка='';проверено=true;return result;
      }catch(err){последняяОшибка=err instanceof Error?err.message:'Сбой потока Cloud.ru';проверено=false;throw err;}
    },
    async создатьОтвет(история, сигнал) {
      if (демоРежим) return демонстрация.создатьОтвет(история);
      if (!ключ || !модель) throw ошибка('Cloud.ru не настроен: укажите API-ключ и модель в настройках', 409);
      try {
        const result = await new ОблачнаяМодель(ключ, модель).создатьОтвет(история, сигнал);
        последняяОшибка = '';
        проверено = true;
        return result;
      } catch (err) {
        последняяОшибка = err instanceof Error ? err.message : 'Сбой запроса Cloud.ru';
        проверено = false;
        throw err;
      }
    }
  };
  const ядро = new Ядро(провайдер, база);
  ядро.запустить();
  // Bounded in-process lifecycle log. No secret keys, raw prompts, or responses.
  let номерСобытия = 0;
  const событияМозга = [];
  ядро.подписаться(event=>{
    if (!['контекст','генерация','сохранение','ответ','ошибка'].includes(event.тип)) return;
    событияМозга.push({
      id:++номерСобытия, type:event.тип, at:event.время,
      chatId:event.диалогИд||null,
      sources:Array.isArray(event.источники)?event.источники.slice(-200):[]
    });
    if(событияМозга.length>160)событияМозга.shift();
  });
  const cookie = randomBytes(32).toString('hex');
  let origin = '';

  const сервер = http.createServer(async (запрос, ответ) => {
    const заголовки = {
      'X-Content-Type-Options':'nosniff',
      'X-Frame-Options':'DENY',
      'Referrer-Policy':'no-referrer',
      'Cross-Origin-Resource-Policy':'same-origin',
      'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    };
    for (const [имя, значение] of Object.entries(заголовки)) ответ.setHeader(имя, значение);
    try {
      if (закрывается) throw ошибка('Сервер завершает работу',503);
      if (запрос.socket.remoteAddress !== '127.0.0.1') throw ошибка('Локальный доступ обязателен',403);
      if (запрос.headers.host !== origin.replace('http://','')) throw ошибка('Недопустимый Host',403);
      if (запрос.headers.origin && запрос.headers.origin !== origin) throw ошибка('Запрещённый Origin',403);
      if (запрос.headers['sec-fetch-site'] === 'cross-site') throw ошибка('Запрещён межсайтовый запрос',403);
      const url = new URL(запрос.url || '/', origin);
      const путь = decodeURIComponent(url.pathname);
      if (запрос.method === 'GET' && Object.hasOwn(TYPES, путь)) {
        const [файл, тип] = TYPES[путь];
        const данные = readFileSync(join(корень, файл));
        if (путь === '/') ответ.setHeader('Set-Cookie', 'kiyomira_session=' + cookie + '; HttpOnly; SameSite=Strict; Path=/');
        ответ.writeHead(200, { 'Content-Type':тип, 'Cache-Control':'no-store' });
        return ответ.end(данные);
      }
      if (!путь.startsWith('/api/')) throw ошибка('Страница не найдена',404);
      const cookieHeader = запрос.headers.cookie || '';
      if (!cookieHeader.split(';').some(x => x.trim() === 'kiyomira_session=' + cookie) ||
          запрос.headers['x-kiyomira-request'] !== '1') throw ошибка('Нет доступа к API',403);
      if (!['GET','POST','PATCH','DELETE'].includes(запрос.method)) throw ошибка('Метод не поддерживается',405);
      if (запрос.method === 'GET' && путь === '/api/status') {
        return json(ответ,200,{ ready:true, provider:демоРежим ? 'demo' : ключ && модель ? 'cloud' : 'unconfigured', model:модель, keyPresent:!!ключ, verified:проверено, lastError:последняяОшибка, active:активные.size });
      }
      if (запрос.method === 'GET' && путь === '/api/brain/events') {
        const since = Math.max(0, Number(url.searchParams.get('after'))||0);
        return json(ответ,200,{latest:номерСобытия,events:событияМозга.filter(e=>e.id>since).slice(-80)});
      }
      if (запрос.method === 'GET' && путь === '/api/brain') {
        const snapshot = база.картаДиалогов(1000);
        const messages = snapshot.сообщения.map(item=>({
          id:item.ид,chatId:item.диалог_ид,role:item.роль,
          preview:String(item.текст||'').slice(0,160),at:item.время,
          topics:определитьТемы(item.текст)
        }));
        const chats=snapshot.диалоги.map(chat=>({
          id:chat.ид,title:chat.название,count:chat.сообщений,
          topics:определитьТемы(chat.название)
        }));
        const candidates=кандидатыПротиворечий(snapshot.сообщения);
        return json(ответ,200,{
          chats,messages,totalMessages:snapshot.всегоСообщений,
          candidates,facts:база.кандидатыФактов(200),factLinks:база.связиФактов(200),
          semanticLinks:база.связиПоСодержанию(120),factConflicts:база.противоречияФактов(60),latest:номерСобытия
        });
      }
      if (запрос.method === 'GET' && путь === '/api/memory/search') {
        const q=String(url.searchParams.get('q')||'').slice(0,160);
        return json(ответ,200,{results:база.поискГибридный(q,12),method:'local-lexical-hybrid'});
      }
      if (запрос.method === 'GET' && путь === '/api/memory/facts') {
        return json(ответ,200,{
          facts:база.кандидатыФактов(300),
          links:база.связиФактов(300),
          related:база.связиПоСодержанию(120),
          conflicts:база.противоречияФактов(60)
        });
      }
      if (запрос.method === 'GET' && путь === '/api/memory/facts/history') {
        const id=Number(url.searchParams.get('id'));
        if(!Number.isSafeInteger(id)||id<1)throw ошибка('Некорректный ID',400);
        return json(ответ,200,{history:база.историяФакта(id)});
      }
      const factRoute=путь.match(/^\/api\/memory\/facts\/(\d+)$/);
      if (запрос.method === 'PATCH' && factRoute) {
        const данные=await телоЗапроса(запрос);
        if(!['подтверждено','отклонено','требует проверки'].includes(данные.status))
          throw ошибка('Недопустимый статус факта',400);
        if(данные.value!==undefined&&(typeof данные.value!=='string'||!данные.value.trim()||данные.value.length>240))
          throw ошибка('Недопустимое исправление',400);
        try {
          return json(ответ,200,{fact:база.изменитьФакт(Number(factRoute[1]),данные.status,данные.value)});
        } catch(error){
          if(error instanceof Error&&/не найден/.test(error.message))throw ошибка(error.message,404);
          throw error;
        }
      }
      if (запрос.method === 'GET' && путь === '/api/chats') return json(ответ,200,{ chats:база.списокДиалогов() });
      if (запрос.method === 'POST' && путь === '/api/chats') {
        const параметры = await телоЗапроса(запрос);
        const имя = typeof параметры.title === 'string' ? параметры.title : 'Новый диалог';
        return json(ответ,201,{ id:база.создатьДиалог(имя) });
      }
      if (запрос.method === 'GET' && путь === '/api/search') {
        return json(ответ,200,{ results:база.поиск(url.searchParams.get('q') || '') });
      }
      if (запрос.method === 'GET' && путь === '/api/settings') {
        return json(ответ,200,{ model:модель, keyPresent:!!ключ, demoMode:демоРежим, verified:проверено, secretStored:false });
      }
      if (запрос.method === 'POST' && путь === '/api/settings') {
        const данные = await телоЗапроса(запрос);
        if (активные.size) throw ошибка('Нельзя менять модель во время генерации',409);
        if (данные.demoMode !== undefined) {
          if (typeof данные.demoMode !== 'boolean') throw ошибка('Неверное значение демо-режима');
          демоРежим = данные.demoMode;
        }
        if (данные.model !== undefined) {
          if (typeof данные.model !== 'string' || данные.model.length > 200) throw ошибка('Некорректная модель');
          модель = данные.model.trim();
          база.установитьНастройку('модель', модель);
        }
        if (данные.apiKey !== undefined) {
          if (typeof данные.apiKey !== 'string' || данные.apiKey.length > 4096) throw ошибка('Некорректный ключ');
          if (данные.apiKey.trim()) ключ = данные.apiKey.trim();
        }
        if (данные.clearKey === true) ключ = '';
        проверено = false;
        последняяОшибка = '';
        return json(ответ,200,{ model:модель, keyPresent:!!ключ, demoMode:демоРежим, verified:проверено, secretStored:false });
      }
      if (запрос.method === 'GET' && путь === '/api/models') {
        if (!ключ) throw ошибка('Сначала укажите API-ключ Cloud.ru');
        const models = await new ОблачнаяМодель(ключ, модель || 'проверка').получитьМодели();
        последняяОшибка = '';
        return json(ответ,200,{ models });
      }
      if (запрос.method === 'POST' && путь === '/api/test') {
        if (!ключ || !модель) throw ошибка('Укажите ключ и модель Cloud.ru');
        const models = await new ОблачнаяМодель(ключ, модель).получитьМодели();
        const listed = models.includes(модель);
        проверено = listed;
        последняяОшибка = listed ? '' : 'Выбранная модель отсутствует в списке Cloud.ru';
        return json(ответ,200,{ ok:listed, model:модель, listed, check:'models-only' });
      }
      if (запрос.method === 'POST' && путь === '/api/test-generation') {
        if (!ключ || !модель) throw ошибка('Укажите API-ключ и модель Cloud.ru');
        if (демоРежим) throw ошибка('Выключите демо-режим для проверки реальной модели');
        if (активные.size) throw ошибка('Дождитесь окончания текущего ответа',409);
        try {
          // An explicitly requested small, billable call. Never store it in dialogue history.
          const reply = await new ОблачнаяМодель(ключ, модель)
            .создатьОтвет([{ роль: 'пользователь', текст: 'Ответь одним словом: готово' }], undefined, 16);
          проверено = true;
          последняяОшибка = '';
          return json(ответ,200,{ok:true,reply,model:модель});
        } catch (err) {
          проверено = false;
          последняяОшибка = err instanceof Error ? err.message : 'Ошибка проверки генерации';
          throw err;
        }
      }
      const chat = idИзПути(путь);
      if (chat) {
        if (!база.существуетДиалог(chat.ид)) throw ошибка('Диалог не найден',404);
        if (запрос.method === 'GET' && !chat.действие) return json(ответ,200,{ messages:база.сообщенияДиалога(chat.ид) });
        if (запрос.method === 'PATCH' && !chat.действие) {
          const данные = await телоЗапроса(запрос);
          if (typeof данные.title !== 'string' || данные.title.length > 100) throw ошибка('Некорректное название');
          база.переименоватьДиалог(chat.ид, данные.title);
          return json(ответ,200,{ ok:true });
        }
        if (запрос.method === 'DELETE' && !chat.действие) {
          if (активные.has(chat.ид)) throw ошибка('Идёт генерация',409);
          база.удалитьДиалог(chat.ид);
          return json(ответ,200,{ ok:true });
        }
        if (запрос.method === 'POST' && chat.действие === 'stop') {
          активные.get(chat.ид)?.abort();
          return json(ответ,200,{ stopped:true });
        }
        if (запрос.method === 'POST' && chat.действие === 'message-stream') {
          const данные=await телоЗапроса(запрос);
          if(typeof данные.text!=='string'||!данные.text.trim()||данные.text.length>20000)
            throw ошибка('Сообщение должно содержать 1–20000 символов');
          if(активные.has(chat.ид))throw ошибка('Уже выполняется ответ в этом диалоге',409);
          const controller=new AbortController();
          активные.set(chat.ид,controller);
          ответ.setHeader('Content-Type','application/x-ndjson; charset=utf-8');
          ответ.setHeader('Cache-Control','no-store, no-transform');
          ответ.setHeader('X-Accel-Buffering','no');
          ответ.flushHeaders();
          const emit=(type,text='')=>{
            if(!ответ.destroyed&&!ответ.writableEnded)ответ.write(JSON.stringify({type,text})+'\n');
          };
          ответ.on('close',()=>{if(!ответ.writableEnded)controller.abort();});
          const work=ядро.ответитьПотоком(данные.text,chat.ид,controller.signal,chunk=>emit('chunk',chunk));
          ожидают.add(work);
          try{
            await work;
            emit('done');
          }catch(err){
            const message=controller.signal.aborted?'Запрос отменён':
              err instanceof Error&&(/Cloud.ru|поток|Пустой ответ/.test(err.message))?err.message:
              'Не удалось получить ответ';
            emit('error',message);
          }finally{
            ожидают.delete(work);активные.delete(chat.ид);
            if(!ответ.destroyed&&!ответ.writableEnded)ответ.end();
          }
          return;
        }
        if (запрос.method === 'POST' && chat.действие === 'message') {
          const данные = await телоЗапроса(запрос);
          if (typeof данные.text !== 'string' || !данные.text.trim() || данные.text.length > 20000) throw ошибка('Сообщение должно содержать 1–20000 символов');
          if (активные.has(chat.ид)) throw ошибка('Уже выполняется ответ в этом диалоге',409);
          const controller = new AbortController();
          активные.set(chat.ид, controller);
          const работа = ядро.ответить(данные.text, chat.ид, controller.signal);
          ожидают.add(работа);
          try {
            const text = await работа;
            return json(ответ,200,{ reply:text });
          } finally {
            ожидают.delete(работа);
            активные.delete(chat.ид);
          }
        }
      }
      if (запрос.method === 'POST' && путь === '/api/quit') {
        ответ.setHeader('Connection','close');
        json(ответ,200,{ ok:true });
        setImmediate(()=>{ void закрыть(); });
        return;
      }
      throw ошибка('API не найден',404);
    } catch (e) {
      const cloudError = e instanceof Error && (e.message.startsWith('Cloud.ru ') || e.message.startsWith('Запрос Cloud.ru '));
      const status = Number.isInteger(e?.httpStatus) ? e.httpStatus : cloudError ? 502 : e?.name === 'AbortError' ? 409 : 500;
      // Cloud errors are server-authored and sanitized, never upstream raw response bodies.
      const message = cloudError || status !== 500 ? String(e.message) : 'Операция не выполнена; проверьте настройки и подключение';
      if (!ответ.headersSent) json(ответ,status,{error:message});
      else ответ.end();
    }
  });

  async function закрыть() {
    if (закрывается) return;
    закрывается = true;
    for (const c of активные.values()) c.abort();
    await Promise.allSettled([...ожидают]);
    await ядро.остановить();
    база.закрыть();
    await new Promise(resolveDone => {
      сервер.close(resolveDone);
      // Closing the program must not wait forever for an idle browser keep-alive socket.
      сервер.closeAllConnections();
    });
  }

  try {
    await new Promise((resolveReady,rejectReady) => {
      сервер.once('error',rejectReady);
      сервер.listen(порт,'127.0.0.1',resolveReady);
    });
  } catch(e) { await ядро.остановить(); база.закрыть(); throw e; }
  origin = 'http://127.0.0.1:' + сервер.address().port;
  return { url:origin, server:сервер, close:закрыть };
}

if (require.main === module) {
  (async () => {
    const app = await создатьВебСервер();
    console.log('[Kiyomira] Веб-интерфейс:', app.url);
    if (process.send) process.send({ type:'ready', url:app.url });
    let остановка = false;
    const stop = () => {
      if (остановка) return;
      остановка = true;
      void app.close().then(() => { console.log('[Kiyomira] Веб-сервер остановлен'); if (process.connected) process.disconnect(); process.exit(0); }).catch(() => { if (process.connected) process.disconnect(); process.exit(1); });
    };
    // A browser-initiated /api/quit closes the server directly; that must also stop the child process.
    app.server.once('close',stop);
    process.on('SIGINT',stop);
    process.on('SIGTERM',stop);
    process.on('message',x=>{ if (x?.type === 'shutdown') stop(); });
  })().catch(() => { console.error('[Kiyomira] Ошибка запуска веб-сервера'); process.exitCode=1; });
}
module.exports = { создатьВебСервер };

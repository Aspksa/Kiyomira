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
    assert.match(await front.text(),/Kiyomira — личный чат/);
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
    assert.match(await appjs.text(),/markdown/);
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

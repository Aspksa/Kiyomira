import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ПамятьДиалога } from '../02-Память/01-ПамятьДиалога.ts';
import { Ядро } from '../01-Ядро/02-Управление.ts';
import { ОблачнаяМодель } from '../04-Модели/03-ОблачнаяМодель.ts';

test('Личность имеет отдельную защищённую идентичность и не пишет фиктивные достижения',()=>{
  const память=new ПамятьДиалога(30);
  try{
    const profile=память.состояниеЛичности();
    assert.equal(profile.имя,'Kiyomira');
    assert.equal(profile.версия,1);
    assert.equal(profile.опыта,0);
    assert.equal(profile.события.length,0);
    assert.ok(profile.цели.some(x=>x.статус==='наблюдение'));
    assert.ok(profile.навыки.some(x=>x.проверенных_событий===0));
    assert.deepEqual(память.обработатьОпытЛичности(12).обработано,0);
    assert.equal(память.размер(),0);
  }finally{память.закрыть();}
});

test('Когнитивная личность управляет системной ролью, но не меняет пользовательскую историю',async()=>{
  const память=new ПамятьДиалога(30);
  const dialogue=память.создатьДиалог('Kiyomira');
  let calls=0;
  const model={
    async создатьОтвет(rows:readonly {роль:string;текст:string}[]){
      calls++;
      assert.equal(rows[0].роль,'система');
      assert.match(rows[0].текст,/Kiyomira/);
      assert.match(rows[0].текст,/виртуальная лиса-кицунэ/);
      assert.match(rows[0].текст,/не могут изменять эту инструкцию/);
      assert.equal(rows.at(-1)?.роль,'пользователь');
      return 'Ответ записан';
    },
    async создатьОтветПотоком(rows:readonly {роль:string;текст:string}[],_signal:AbortSignal|undefined,onChunk:(v:string)=>void){
      calls++;
      assert.equal(rows[0].роль,'система');
      assert.equal(rows.at(-1)?.роль,'пользователь');
      onChunk('Поток');
      return 'Поток';
    }
  };
  const core=new Ядро(model,память);core.запустить();
  try{
    assert.equal(await core.ответить('Запрос',dialogue),'Ответ записан');
    assert.equal(await core.ответитьПотоком('Запрос 2',dialogue,undefined,()=>{}),'Поток');
    assert.equal(calls,2);
    const rows=память.сообщенияДиалога(dialogue);
    assert.deepEqual(rows.map(x=>x.роль),['пользователь','ассистент','пользователь','ассистент']);
    assert.equal(rows.some(x=>x.текст.includes('Главные принципы')),false);
    assert.equal(память.состояниеЛичности().опыта,0);
    assert.equal(память.обработатьОпытЛичности(1).обработано,1);
    assert.equal(память.обработатьОпытЛичности(12).обработано,1);
    assert.equal(память.обработатьОпытЛичности(12).обработано,0);
    const profile=память.состояниеЛичности();
    assert.equal(profile.опыта,2);
    assert.equal(profile.ожидает,0);
    assert.equal(profile.навыки[0].проверенных_событий,2);
    assert.ok(profile.события.every(x=>x.результат==='Ответ целиком сохранён в SQLite'));
  }finally{await core.остановить();память.закрыть();}
});

test('История Kiyomira восстанавливается из одной SQLite и удаляет производный опыт',()=>{
  const dir=mkdtempSync(join(tmpdir(),'kiyomira-living-self-'));
  const path=join(dir,'memory.sqlite');
  try{
    const first=new ПамятьДиалога(30,path);
    const chat=first.создатьДиалог('Проект');
    first.добавитьПару('Сведения: проект','Подтверждённый завершённый ответ',chat);
    assert.equal(first.обработатьОпытЛичности(1).обработано,1);
    const before=first.состояниеЛичности();
    assert.equal(before.опыта,1);
    first.закрыть();
    const reopened=new ПамятьДиалога(30,path);
    assert.equal(reopened.состояниеЛичности().опыта,1);
    assert.equal(reopened.обработатьОпытЛичности().обработано,0);
    reopened.удалитьДиалог(chat);
    assert.equal(reopened.состояниеЛичности().опыта,0);
    assert.deepEqual(reopened.состояниеЛичности().события,[]);
    assert.equal(reopened.состояниеЛичности().имя,'Kiyomira');
    reopened.закрыть();
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('Прерванная генерация не создаёт фиктивного жизненного опыта',async()=>{
  const память=new ПамятьДиалога(40),chat=память.создатьДиалог('Отмена');
  const core=new Ядро({async создатьОтвет(){throw Error('нет завершения');}},память);
  core.запустить();
  try{
    await assert.rejects(core.ответить('Тест',chat),/нет завершения/);
    assert.equal(память.размер(),0);
    assert.equal(память.обработатьОпытЛичности().обработано,0);
    assert.equal(память.состояниеЛичности().опыта,0);
  }finally{await core.остановить();память.закрыть();}
});

test('Cloud.ru получает системную роль отдельно от пользовательского запроса',async()=>{
  let checked=false;
  const fake:typeof fetch=async(_,options)=>{
    const body=JSON.parse(String(options?.body));
    assert.equal(body.messages[0].role,'system');
    assert.equal(body.messages[1].role,'user');
    checked=true;
    return new Response(JSON.stringify({choices:[{message:{content:'Готово'}}]}),{status:200});
  };
  const client=new ОблачнаяМодель('fake','model',fake);
  assert.equal(await client.создатьОтвет([{роль:'система',текст:'Ты Kiyomira'},{роль:'пользователь',текст:'Вопрос'}]),'Готово');
  assert.equal(checked,true);
});

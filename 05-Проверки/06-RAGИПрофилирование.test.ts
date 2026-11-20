import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { ПамятьДиалога } from '../02-Память/01-ПамятьДиалога.ts';

test('Локальный RAG использует документ и не придумывает ID сообщения',()=>{
  const memory=new ПамятьДиалога(50);
  try{
    const chat=memory.создатьДиалог('RAG');
    const saved=memory.индексироватьДокумент('План Kiyomira',
      'План Kiyomira: документация проекта, ключевая архитектура TypeScript и SQLite','Kiyomira');
    assert.ok(saved.id>0);
    const docs=memory.поискДокументов('архитектура TypeScript');
    assert.equal(docs[0].ид,saved.id);
    const context=memory.контекстПоЗапросу('архитектура TypeScript',chat);
    assert.ok(context.история.some(row=>row.текст.includes('Документ #'+saved.id)));
    assert.equal(context.источники.includes(saved.id),false);
  }finally{memory.закрыть();}
});

test('Противоречивые подтверждённые факты не попадают в персональный контекст',()=>{
  const memory=new ПамятьДиалога(50);
  try{
    const chat=memory.создатьДиалог('Факты');
    memory.добавитьПару('Мой любимый редактор: VS Code','Записано',chat);
    memory.добавитьПару('Мой любимый редактор: Vim','Записано',chat);
    const candidates=memory.кандидатыФактов(20).filter((f:any)=>f.ключ==='мой любимый редактор');
    assert.equal(candidates.length,2);
    for(const fact of candidates)memory.изменитьФакт(fact.ид,'подтверждено');
    assert.equal(memory.подтверждённыеДляКонтекста('любимый редактор').length,0);
    assert.equal(memory.противоречияФактов().length>0,true);
  }finally{memory.закрыть();}
});

test('Актуальность фактов не меняется без решения пользователя',()=>{
  const memory=new ПамятьДиалога(50);
  try{
    assert.deepEqual(memory.устаревающиеФакты(),[]);
  }finally{memory.закрыть();}
});


test('RAG находит релевантный фрагмент за пределами первых 12 тысяч символов',()=>{
  const memory=new ПамятьДиалога(50);
  try {
    const chat=memory.создатьДиалог('Длинный документ');
    const longText='нейтральное содержание '.repeat(750)+
      'Уникальный раздел: хранение долговременной памяти с контрольной проверкой источников.';
    const record=memory.индексироватьДокумент('Большая заметка',longText,'');
    const matches=memory.поискДокументов('контрольной проверкой источников');
    assert.equal(matches[0]?.ид,record.id);
    assert.match(matches[0].отрывок,/контрольной проверкой источников/);
    const context=memory.контекстПоЗапросу('контрольной проверкой источников',chat);
    assert.ok(context.история.some(row=>row.текст.includes('контрольной проверкой источников')));
  }finally{memory.закрыть();}
});

test('Поиск по длинному документу имеет ограниченную стоимость на локальном SQLite',()=>{
  const memory=new ПамятьДиалога(50);
  try {
    for(let i=0;i<60;i++)memory.индексироватьДокумент(
      'Документ '+i,('Локальная документация Kiyomira. ').repeat(800)+'Уникальное окончание '+i);
    const before=performance.now();
    const result=memory.поискДокументов('локальная документация');
    const elapsed=performance.now()-before;
    assert.ok(result.length>0);
    // Generous regression guard, not a production hardware performance claim.
    assert.ok(elapsed<10000,'retrieval should remain bounded on the CI runner: '+elapsed+'ms');
  }finally{memory.закрыть();}
});


test('Внутренний граф различает связи, противоречия и источник',async()=>{
  const {определитьСвязьФактов}=await import('../02-Память/02-КартаЗнаний.ts');
  const fact=(ид:number,источник_ид:number,ключ:string,значение:string,статус='подтверждено')=>({ид,источник_ид,ключ,значение,статус});
  assert.equal(определитьСвязьФактов(fact(1,1,'стек','SQLite'),fact(2,2,'стек','SQLite'))?.тип,'повторение');
  assert.equal(определитьСвязьФактов(fact(1,1,'стек','SQLite'),fact(3,3,'стек','PostgreSQL'))?.тип,'противоречие');
  assert.equal(определитьСвязьФактов(fact(1,1,'стек','SQLite'),fact(4,4,'база','SQLite'))?.тип,'общая_тема');
  assert.equal(определитьСвязьФактов(fact(1,1,'стек','SQLite'),fact(5,5,'любимое блюдо','борщ')),null);
  assert.equal(определитьСвязьФактов(fact(1,1,'стек','SQLite'),fact(6,1,'стек','SQLite')),null);
  assert.equal(определитьСвязьФактов(fact(1,1,'стек','SQLite'),fact(7,7,'стек','SQLite','отклонено')),null);
});

test('Граф контекста использует только подтверждённые связанные источники',()=>{
  const memory=new ПамятьДиалога(50);
  try{
    const chat=memory.создатьДиалог('Граф');
    memory.добавитьПару('Основная база: SQLite','Принято',chat);
    memory.добавитьПару('Хранилище: SQLite','Записано',chat);
    memory.добавитьПару('Основная база: PostgreSQL','Учту',chat);
    const facts=memory.кандидатыФактов(20);
    const sqlite=facts.filter((f:any)=>f.значение==='sqlite');
    assert.equal(sqlite.length,2);
    for(const fact of sqlite)memory.изменитьФакт(fact.ид,'подтверждено');
    const conflict=facts.find((f:any)=>f.значение==='postgresql');
    assert.ok(conflict);memory.изменитьФакт(conflict.ид,'подтверждено');
    assert.ok(memory.графСвязейПамяти().some(link=>link.тип==='противоречие'));
    assert.ok(!memory.подтверждённыеДляКонтекста('основная база').some(f=>f.ключ==='основная база'));
    const related=memory.связанныеПодтверждённыеФакты('хранилище sqlite');
    assert.ok(!related.some(f=>f.ключ==='основная база'));
    const context=memory.контекстПоЗапросу('хранилище sqlite',chat);
    assert.ok(context.история.some(row=>row.текст.includes('Подтверждённый факт')));
  }finally{memory.закрыть();}
});


test('Обход графа возвращает проверяемую цепочку реальных источников и не зацикливается',()=>{
  const memory=new ПамятьДиалога(50);
  try{
    const chat=memory.создатьДиалог('Цепочка');
    memory.добавитьПару('Технология: SQLite','Сохранено',chat);
    memory.добавитьПару('Хранилище: SQLite','Сохранено',chat);
    memory.добавитьПару('Движок: SQLite','Сохранено',chat);
    for(const fact of memory.кандидатыФактов(30))memory.изменитьФакт(fact.ид,'подтверждено');
    const links=memory.путиПодтверждённыхФактов('технология SQLite',6,2);
    assert.ok(links.length>=1);
    for(const link of links){
      assert.ok(link.глубина>=1&&link.глубина<=2);
      assert.equal(link.путь.length,link.глубина+1);
      assert.equal(link.источники.length,link.путь.length);
      assert.equal(new Set(link.путь).size,link.путь.length);
      assert.equal(new Set(link.источники).size,link.источники.length);
      assert.equal(link.источники[link.источники.length-1],link.источник_ид);
      assert.ok(link.сила>0&&link.сила<=1);
    }
    assert.ok(memory.путиПодтверждённыхФактов('технология SQLite',6,1).every(f=>f.глубина===1));
    assert.ok(memory.путиПодтверждённыхФактов('технология SQLite',1,3).length<=1);
    const context=memory.контекстПоЗапросу('технология SQLite',chat);
    assert.ok(context.история.some(m=>m.текст.includes('цепочка источников')));
  }finally{memory.закрыть();}
});

test('Обход не проходит через конфликтующие или неподтверждённые записи',()=>{
  const memory=new ПамятьДиалога(50);
  try{
    const chat=memory.создатьДиалог('Контроль');
    memory.добавитьПару('Технология: SQLite','Принято',chat);
    memory.добавитьПару('Движок: SQLite','Принято',chat);
    memory.добавитьПару('Движок: Postgres','Принято',chat);
    memory.добавитьПару('Другое: SQLite','Принято',chat);
    const facts=memory.кандидатыФактов(20);
    for(const fact of facts.filter((f:any)=>f.ключ!=='другое'))
      memory.изменитьФакт(fact.ид,'подтверждено');
    assert.deepEqual(memory.путиПодтверждённыхФактов('технология sqlite',5,3),[]);
    assert.ok(!memory.контекстПоЗапросу('технология sqlite',chat).история
      .some(m=>m.текст.includes('Связанный подтверждённый факт')));
    assert.equal(memory.путиПодтверждённыхФактов('совсем неизвестный текст',4,2).length,0);
  }finally{memory.закрыть();}
});


test('Быстрый поиск после добавления и удаления сообщений не отдаёт устаревший кэш',()=>{
  const memory=new ПамятьДиалога(70);
  try{
    const chat=memory.создатьДиалог('Индексация');
    memory.добавитьПару('Система использует уникальный индекс алмазавр','Записано',chat);
    const first=memory.поискГибридный('алмазавр',10);
    assert.ok(first.length>0);
    assert.equal(memory.поискГибридный('алмазавр',10)[0].ид,first[0].ид);
    memory.добавитьПару('Алмазавр и хранение проверенных записей','Принято',chat);
    assert.ok(memory.поискГибридный('алмазавр',10).length>=2);
    memory.удалитьДиалог(chat);
    assert.equal(memory.поискГибридный('алмазавр',10).length,0);
    const profile=memory.профильПоиска();
    assert.ok(profile.messageSearch?.samples>=2);
    assert.ok(profile.messageCache?.samples>=1);
  }finally{memory.закрыть();}
});

test('Кэш документов обновляется при добавлении и удалении, без потери источника',()=>{
  const memory=new ПамятьДиалога(50);
  try{
    const a=memory.индексироватьДокумент('Файл 1','Уникальная память ревизионов и проверка источника','Kiyomira');
    assert.equal(memory.поискДокументов('ревизионов')[0].ид,a.id);
    assert.equal(memory.поискДокументов('ревизионов')[0].ид,a.id);
    const b=memory.индексироватьДокумент('Файл 2','Ревизионов память в новом документе','Kiyomira');
    assert.ok(memory.поискДокументов('ревизионов').some(x=>x.ид===b.id));
    memory.удалитьДокумент(a.id);
    assert.ok(!memory.поискДокументов('ревизионов').some(x=>x.ид===a.id));
    assert.ok(memory.профильПоиска().documentCache?.samples>=1);
  }finally{memory.закрыть();}
});

test('Кэш подтверждённого графа сбрасывается после проверки и конфликта',()=>{
  const memory=new ПамятьДиалога(50);
  try{
    const chat=memory.создатьДиалог('Обход');
    memory.добавитьПару('Стек: SQLite','ОК',chat);
    memory.добавитьПару('Хранилище: SQLite','ОК',chat);
    const f=memory.кандидатыФактов(10);
    for(const x of f)memory.изменитьФакт(x.ид,'подтверждено');
    assert.ok(memory.путиПодтверждённыхФактов('стек SQLite',4,2).length>=1);
    assert.ok(memory.путиПодтверждённыхФактов('стек SQLite',4,2).length>=1);
    memory.добавитьПару('Хранилище: PostgreSQL','ОК',chat);
    const conflict=memory.кандидатыФактов(10).find((x:any)=>x.значение==='postgresql');
    assert.ok(conflict);
    memory.изменитьФакт(conflict.ид,'подтверждено');
    assert.equal(memory.путиПодтверждённыхФактов('стек SQLite',4,2).length,0);
    assert.ok(memory.профильПоиска().graphWalk?.samples>=2);
  }finally{memory.закрыть();}
});

test('Подготовка контекста имеет внутреннюю телеметрию без нового интерфейса',()=>{
  const memory=new ПамятьДиалога(50);
  try{
    const chat=memory.создатьДиалог('Профиль');
    memory.добавитьПару('Архитектура: SQLite','Записано',chat);
    const context=memory.контекстПоЗапросу('архитектура sqlite',chat);
    assert.ok(context.источники.length>0);
    const metrics=memory.профильПоиска();
    assert.equal(metrics.contextBuild.samples,1);
    assert.ok(metrics.contextBuild.averageMs>=0);
  }finally{memory.закрыть();}
});

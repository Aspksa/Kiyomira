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

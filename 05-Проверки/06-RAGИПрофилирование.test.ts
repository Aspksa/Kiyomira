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

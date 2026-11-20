// Lightweight local hybrid lexical retrieval for SQLite messages, no model calls.
// This is NOT embedding-based semantic search; every hit has a real source ID.
export type ПоисковаяЗапись={
  ид:number;диалог_ид:number;роль:'пользователь'|'ассистент';текст:string;время:string
};
export function нормализовать(текст:string):string{
  return текст.toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
}
export function токены(текст:string):string[]{
  return [...new Set(нормализовать(текст).split(/\s+/).filter(x=>x.length>2))].slice(0,30);
}
function куски(текст:string):Set<string>{
  const input=нормализовать(текст).slice(0,240);
  const set=new Set<string>();
  for(let i=0;i+2<input.length;i++)set.add(input.slice(i,i+3));
  return set;
}
export function релевантность(запрос:string,текст:string):number{
  const needle=нормализовать(запрос),hay=нормализовать(текст);
  if(!needle||!hay)return 0;
  const query=токены(needle),words=new Set(токены(hay));
  let value=hay.includes(needle)?10:0;
  for(const term of query)if(words.has(term))value+=3;
  const a=куски(needle),b=куски(hay);
  let common=0;
  for(const term of a)if(b.has(term))common++;
  const overlap=a.size?common/a.size:0;
  value+=overlap*4;
  // Avoid returning unrelated coincidental trigrams as "semantic" matches.
  if(value<2.5)return 0;
  return Math.round(value*100)/100;
}
export function ранжировать(запрос:string,строки:ПоисковаяЗапись[],лимит=8){
  return строки.map((row,i)=>({...row,балл:релевантность(запрос,row.текст)+
    (строки.length?i/строки.length*.15:0)}))
    .filter(row=>row.балл>=2.5)
    .sort((a,b)=>b.балл-a.балл||b.ид-a.ид)
    .slice(0,Math.max(1,Math.min(30,лимит)));
}

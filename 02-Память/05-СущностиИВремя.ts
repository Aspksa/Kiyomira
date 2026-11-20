// Source-grounded internal entity metadata; never turn heuristics into approved facts.
// This module has no model calls, UI dependencies or autonomous writes.
export type ТипСущности='проект'|'человек'|'документ'|'событие'|'решение';
export type ВременнойСтатус='прошлое'|'будущее'|'указана_дата'|'неизвестно';
export type СущностьПамяти={тип:ТипСущности;название:string;источник_ид:number;
  подтверждено:boolean;основание:'явное_упоминание'|'метаданные_документа'};
export type ЗаписьФакта={ид:number;источник_ид:number;ключ:string;значение:string;
  статус:string;создано?:string;изменено?:string};
export type ДоказательнаяСвязь={a:number;b:number;тип:'повторение'|'общая_тема'|'возможный_конфликт';
  источники:[number,number];сила:number;основание:string};
const clean=(v:string)=>v.replace(/\s+/g,' ').trim();
export const нормализоватьСущность=(v:string)=>clean(v.toLocaleLowerCase('ru').replace(/ё/g,'е')
  .replace(/[^\p{L}\p{N}]+/gu,' '));
export function временнаяМетка(текст:string,создано=''):{
  состояние:ВременнойСтатус;дата:string|null;доказательство:string
}{
  const iso=текст.match(/\b(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/);
  if(iso){
    const parsed=new Date(iso[0]+'T00:00:00Z');
    if(!Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===iso[0])
      return {состояние:'указана_дата',дата:iso[0],доказательство:'дата в источнике'};
  }
  // Relative dates are not resolved against the user's clock.
  if(/\b(?:буду|планирую|запланировано|предстоит|планируется)\b/iu.test(текст))
    return {состояние:'будущее',дата:null,доказательство:'временная формулировка'};
  if(/\b(?:было|раньше|завершено|сделал|сделали)\b/iu.test(текст))
    return {состояние:'прошлое',дата:null,доказательство:'временная формулировка'};
  return {состояние:'неизвестно',дата:null,
    доказательство:создано?'время сохранения не равно времени события':'дата не указана'};
}
export function извлечьСущностиСИсточником(текст:string,источник_ид:number,
  подтверждено=false):СущностьПамяти[]{
  if(!Number.isSafeInteger(источник_ид)||источник_ид<1)return [];
  const patterns:{тип:ТипСущности;re:RegExp}[]=[
    {тип:'проект',re:/(?:проект|репозиторий)\s*[:：]\s*([^\n;,.]{2,90})/giu},
    {тип:'человек',re:/(?:человек|контакт|коллега)\s*[:：]\s*([^\n;,.]{2,90})/giu},
    {тип:'документ',re:/(?:документ|файл)\s*[:：]\s*([^\n;,.]{2,90})/giu},
    {тип:'событие',re:/(?:событие|встреча)\s*[:：]\s*([^\n;,.]{2,90})/giu},
    {тип:'решение',re:/(?:решение|утверждено)\s*[:：]\s*([^\n;,.]{2,90})/giu}
  ];
  const result:СущностьПамяти[]=[],seen=new Set<string>();
  for(const {тип,re} of patterns)for(const match of текст.matchAll(re)){
    const название=clean(match[1]);
    if(!название||название.length>90)continue;
    const key=тип+'|'+нормализоватьСущность(название);
    if(!seen.has(key)){seen.add(key);result.push({тип,название,источник_ид,
      подтверждено,основание:'явное_упоминание'});}
    if(result.length>=12)return result;
  }
  return result;
}
export function оценитьДостоверность(row:ЗаписьФакта):{
  уровень:'подтверждено_пользователем'|'требует_проверки'|'отклонено';
  источник_ид:number;время:string|null
}{
  return {уровень:row.статус==='подтверждено'?'подтверждено_пользователем':
    row.статус==='отклонено'?'отклонено':'требует_проверки',
    источник_ид:row.источник_ид,время:row.изменено||row.создано||null};
}
export function объединитьПовторы(rows:ЗаписьФакта[]){
  const groups=new Map<string,{факт:ЗаписьФакта;источники:number[];факты:number[]}>();
  for(const row of rows){
    const key=нормализоватьСущность(row.ключ)+'\u0000'+нормализоватьСущность(row.значение);
    const group=groups.get(key);
    if(group){
      if(!group.источники.includes(row.источник_ид))group.источники.push(row.источник_ид);
      group.факты.push(row.ид);
    }else groups.set(key,{факт:row,источники:[row.источник_ид],факты:[row.ид]});
  }
  return [...groups.values()];
}
// Only explicit evidence links, not arbitrary named-entity coincidences.
export function связатьСущности(rows:СущностьПамяти[],лимит=100){
  const byIdentity=new Map<string,СущностьПамяти[]>();
  for(const row of rows){
    const key=row.тип+'|'+нормализоватьСущность(row.название);
    if(!byIdentity.has(key))byIdentity.set(key,[]);
    byIdentity.get(key)!.push(row);
  }
  const result:{тип:ТипСущности;название:string;источники:number[];подтверждено:boolean}[]=[];
  for(const list of byIdentity.values()){
    const unique=[...new Set(list.map(x=>x.источник_ид))];
    if(unique.length>1)result.push({тип:list[0].тип,название:list[0].название,
      источники:unique,подтверждено:list.every(x=>x.подтверждено)});
    if(result.length>=Math.max(1,Math.min(500,лимит)))break;
  }
  return result;
}
export function маршрутПоиска(запрос:string,подтвержденных=0){
  const tokens=запрос.trim().split(/\s+/).filter(Boolean);
  const complex=/(?:связ|почему|как измен|истори|противореч|между|сначала|потом|после|до |проект.+документ)/iu.test(запрос);
  const depth=complex&&подтвержденных>0?2:0;
  return {режим:depth?'граф' as const:'быстрый' as const,глубина:depth,
    // Metadata always remains separate from generated model assertions.
    причина:depth?'запрос о взаимосвязях':'прямое извлечение',слов:tokens.length};
}

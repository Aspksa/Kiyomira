// Conservative evidence extraction from user-authored natural-language sentences.
// Relations are candidates only: no automatic fact approval or causal inference.
export type ТипОтношения='использует'|'содержит_документ'|'относится_к_проекту'|'изменяет'|'ответственный';
export type Отношение={
  тип:ТипОтношения;субъект:string;объект:string;
  источник_ид:number;фрагмент:string;статус:'кандидат';
  уверенность:'явное_высказывание';отрицание:boolean;
};
const normalize=(s:string)=>s.trim().replace(/\s+/g,' ');
const negation=(s:string)=>/(?:^|[^\p{L}])(?:не|никогда|без)(?=$|[^\p{L}])/iu.test(s);
const patterns:{тип:ТипОтношения;pattern:RegExp;swap?:boolean}[]=[
  {тип:'использует',pattern:/^(?:проект\s+)?([\p{L}\p{N}_./-]{2,60})\s+(?:использует|работает на|основан на)\s+([\p{L}\p{N}_./-]{2,60})$/iu},
  {тип:'содержит_документ',pattern:/^(?:проект\s+)?([\p{L}\p{N}_./-]{2,60})\s+(?:содержит|включает)\s+(?:документ|файл)\s+([\p{L}\p{N}_./-]{2,100})$/iu},
  {тип:'относится_к_проекту',pattern:/^(?:документ|файл)\s+([\p{L}\p{N}_./-]{2,100})\s+относится к\s+(?:проекту\s+)?([\p{L}\p{N}_./-]{2,60})$/iu},
  {тип:'изменяет',pattern:/^(?:решение\s+)?([\p{L}\p{N}_./-]{2,60})\s+(?:изменяет|обновляет)\s+(?:проект\s+)?([\p{L}\p{N}_./-]{2,60})$/iu},
  {тип:'ответственный',pattern:/^([\p{L}\p{N}_./-]{2,60})\s+(?:отвечает за|ведет проект)\s+([\p{L}\p{N}_./-]{2,60})$/iu}
];
export function извлечьОтношения(текст:string,источник_ид:number,лимит=12):Отношение[]{
  if(!Number.isSafeInteger(источник_ид)||источник_ид<1||typeof текст!=='string')return [];
  const found:Отношение[]=[],seen=new Set<string>();
  const lines=текст.split(/\.(?=\s|$)|[!?\r\n;]+/).slice(0,30);
  for(const raw of lines){
    const line=normalize(raw).slice(0,240);
    if(!line||negation(line)||/^(?:если|возможно|кажется|предположим|может быть)\b/iu.test(line))continue;
    for(const entry of patterns){
      const match=line.match(entry.pattern);
      if(!match)continue;
      const субъект=normalize(match[1]),объект=normalize(match[2]);
      if(!субъект||!объект||субъект.toLocaleLowerCase('ru')===объект.toLocaleLowerCase('ru'))continue;
      const id=entry.тип+'|'+субъект.toLocaleLowerCase('ru')+'|'+объект.toLocaleLowerCase('ru');
      if(seen.has(id))continue;seen.add(id);
      found.push({тип:entry.тип,субъект,объект,источник_ид,фрагмент:line,
        статус:'кандидат',уверенность:'явное_высказывание',отрицание:false});
      if(found.length>=Math.max(1,Math.min(50,лимит)))return found;
    }
  }
  return found;
}
export function согласоватьОтношения(rows:Отношение[],лимит=100){
  const grouped=new Map<string,{тип:ТипОтношения;субъект:string;объект:string;
    источники:number[];статус:'кандидат';доказательства:string[]}>();
  for(const row of rows){
    const key=[row.тип,row.субъект.toLocaleLowerCase('ru'),row.объект.toLocaleLowerCase('ru')].join('|');
    let group=grouped.get(key);
    if(!group){group={тип:row.тип,субъект:row.субъект,объект:row.объект,
      источники:[],статус:'кандидат',доказательства:[]};grouped.set(key,group);}
    if(!group.источники.includes(row.источник_ид)){
      group.источники.push(row.источник_ид);group.доказательства.push(row.фрагмент);
    }
  }
  return [...grouped.values()].slice(0,Math.max(1,Math.min(200,лимит)));
}

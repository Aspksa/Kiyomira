// Deterministic, inspectable graph metadata. No LLM cost or unsupported inference.
export type ГрафЗапись = { ид: number; диалог_ид: number; роль: string; текст: string; время: string };
export type ГрафТема = 'проекты'|'люди'|'события'|'документы'|'решения'|'общее';
const МАРКЕРЫ: Record<Exclude<ГрафТема,'общее'>,RegExp> = {
  проекты: /\b(?:github|git|typescript|python|sqlite|cloud\.ru|node|api|pr)\b|проект|репозитор|код|коммит|программ/iu,
  люди: /человек|люди|имя|семь|друз|коллег|знаком|дочь|сын|жена|муж/iu,
  события: /вчера|сегодня|завтра|событи|встреч|поезд|дата|случил|прошл/iu,
  документы: /файл|документ|pdf|docx|excel|таблиц|папк|архив/iu,
  решения: /решил|утверд|выбира|одобр|соглас|принят|отмен|план/iu
};
export function определитьТемы(текст:string):ГрафТема[]{
  const topics=(Object.entries(МАРКЕРЫ) as [Exclude<ГрафТема,'общее'>,RegExp][])
    .filter(([,pattern])=>pattern.test(текст)).map(([key])=>key);
  return topics.length?topics.slice(0,3):['общее'];
}
export type Утверждение={ключ:string;значение:string;отрицание:boolean};
// Only explicit 'key: value' statements are compared; all conflicts are candidates,
// not validated facts. Restrict to user-authored messages, not model guesses.
export function явноеУтверждение(текст:string):Утверждение|null {
  const line=текст.split(/\r?\n/).find(x=>x.length<=160 && /^[^:：]{3,50}[:：]\s*[^:：]{1,90}$/.test(x.trim()));
  if(!line)return null;
  const pieces=line.split(/[:：]/),key=pieces[0].trim().toLocaleLowerCase('ru');
  const value=pieces.slice(1).join(':').trim().toLocaleLowerCase('ru');
  if(!value||key.length<3)return null;
  return {ключ:key,значение:value,отрицание:/^(?:не|нет|без)\s/iu.test(value)};
}
export function кандидатыПротиворечий(записи:ГрафЗапись[],max=40){
  const byKey=new Map<string,{ид:number;значение:string}[]>();
  const result:{a:number;b:number;тип:'требует проверки';ключ:string}[]=[];
  for(const row of записи){
    if(row.роль!=='пользователь')continue;
    const statement=явноеУтверждение(row.текст);
    if(!statement)continue;
    const seen=byKey.get(statement.ключ)||[];
    for(const before of seen){
      if(before.значение!==statement.значение){
        result.push({a:before.ид,b:row.ид,тип:'требует проверки',ключ:statement.ключ});
        if(result.length>=max)return result;
      }
    }
    seen.push({ид:row.ид,значение:statement.значение});
    if(seen.length>8)seen.shift();
    byKey.set(statement.ключ,seen);
  }
  return result;
}

// Rule-based extraction of *candidate* facts from plain-language user statements.
// No autonomous claim is trusted. Every candidate retains its original message ID.
export function извлечьФакты(текст:string):Утверждение[]{
  const candidates:Утверждение[]=[];
  const seen=new Set<string>();
  for(const raw of текст.split(/[\r\n.!?]+/).slice(0,12)){
    const line=raw.trim().slice(0,220);
    if(line.length<6)continue;
    const explicit=явноеУтверждение(line);
    if(explicit)candidates.push(explicit);
    const patterns:[RegExp,string][]=[
      [/^я\s+(?:решил[а]?|выбрал[а]?|утвердил[а]?)\s+(.{4,130})$/iu,'решение'],
      [/^я\s+(?:предпочитаю|люблю)\s+(.{4,130})$/iu,'предпочтение'],
      [/^(?:мой|наш)\s+проект\s+(?:называется|это)\s+(.{2,90})$/iu,'название проекта'],
      [/^(?:мы\s+)?(?:используем|использую)\s+(.{4,130})$/iu,'используемое'],
      [/^мне\s+нравится\s+(.{4,130})$/iu,'предпочтение']
    ];
    for(const [re,key] of patterns){
      const match=line.match(re);
      if(match)candidates.push({ключ:key,значение:match[1].trim().toLocaleLowerCase('ru'),отрицание:false});
    }
  }
  return candidates.filter(item=>{
    const key=item.ключ+'|'+item.значение;
    if(seen.has(key))return false;seen.add(key);return true;
  }).slice(0,8);
}

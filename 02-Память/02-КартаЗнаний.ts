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
  return {ключ,значение:value,отрицание:/^(?:не|нет|без)\s/iu.test(value)};
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

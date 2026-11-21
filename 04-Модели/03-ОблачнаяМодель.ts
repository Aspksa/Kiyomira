import type { ПровайдерМодели, КонтекстМодели } from './01-ПровайдерМодели.ts';

type Запрос = typeof fetch;
type ОтветAPI = { choices?: Array<{ message?: { content?: unknown } }> };
const БАЗОВЫЙ_АДРЕС = 'https://foundation-models.api.cloud.ru/v1';

function ошибкаHTTP(status: number): Error {
  const причины: Record<number, string> = {
    400: 'Проверьте название модели и параметры запроса',
    401: 'API-ключ недействителен или срок его действия истёк',
    402: 'Недостаточно средств или превышен разрешённый бюджет',
    403: 'Сервис Foundation Models недоступен для ключа или проекта',
    404: 'Модель или эндпоинт не найден',
    408: 'Время ожидания ответа истекло',
    429: 'Достигнут лимит Cloud.ru, повторите позднее',
    500: 'Временная ошибка Cloud.ru',
    502: 'Шлюз Cloud.ru временно недоступен',
    503: 'Cloud.ru временно перегружен',
    504: 'Истекло время ожидания шлюза'
  };
  return new Error(`Cloud.ru HTTP ${status}: ${причины[status] || 'запрос отклонён сервисом'}`);
}

export class ОблачнаяМодель implements ПровайдерМодели {
  constructor(
    private readonly ключ: string,
    private readonly модель: string,
    private readonly запрос: Запрос = fetch,
    private readonly адрес = БАЗОВЫЙ_АДРЕС
  ) {
    if (!ключ.trim() || !модель.trim()) throw new Error('Для Cloud.ru необходимы API-ключ и модель');
    const адресAPI = new URL(адрес);
    if (адресAPI.protocol !== 'https:' || (адресAPI.hostname !== 'foundation-models.api.cloud.ru' && запрос === fetch)) {
      throw new Error('Неверный HTTPS-адрес Cloud.ru');
    }
  }

  private async выполнить(path: string, init: RequestInit, таймаут: number): Promise<Response> {
    try {
      const response = await this.запрос(this.адрес + path, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.ключ}`,
          ...(init.headers || {})
        },
        signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(таймаут)]) : AbortSignal.timeout(таймаут)
      });
      if (!response.ok) throw ошибкаHTTP(response.status);
      return response;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Cloud.ru HTTP ')) throw error;
      if (init.signal?.aborted) throw new Error('Запрос Cloud.ru отменён');
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new Error('Cloud.ru: превышено время ожидания ответа');
      }
      // Never echo fetch errors that could include request headers, keys or proxy details.
      throw new Error('Cloud.ru: нет соединения с API. Проверьте интернет, DNS, прокси и доступность сервиса');
    }
  }

  async получитьМодели(): Promise<string[]> {
    const ответ = await this.выполнить('/models', { method: 'GET' }, 15000);
    const данные = await ответ.json() as { data?: { id?: unknown }[] };
    if (!Array.isArray(данные?.data)) throw new Error('Cloud.ru: неверный формат списка моделей');
    return [...new Set(данные.data.map(x => x.id).filter((id): id is string => typeof id === 'string' && !!id.trim()))];
  }

  async создатьОтвет(история: readonly КонтекстМодели[], сигнал?: AbortSignal, максТокенов = 2500): Promise<string> {
    if (!Number.isSafeInteger(максТокенов) || максТокенов < 1 || максТокенов > 8192) throw new Error('Недопустимый лимит токенов');
    const ответ = await this.выполнить('/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.модель,
        stream: false,
        max_tokens: максТокенов,
        messages: история.map(сообщение => ({
          role: сообщение.роль === 'система' ? 'system' : сообщение.роль === 'пользователь' ? 'user' : 'assistant',
          content: сообщение.текст
        }))
      }),
      signal: сигнал
    }, 60000);
    const данные = await ответ.json() as ОтветAPI;
    const текст = данные.choices?.[0]?.message?.content;
    if (typeof текст !== 'string' || !текст.trim()) throw new Error('Cloud.ru вернул пустой или неверный ответ');
    return текст;
  }
  // OpenAI-compatible Cloud.ru SSE: only [DONE] marks an atomic complete answer.
  async создатьОтветПотоком(
    история: readonly КонтекстМодели[], сигнал: AbortSignal|undefined,
    onChunk:(chunk:string)=>void, максТокенов=2500
  ):Promise<string>{
    if(!Number.isSafeInteger(максТокенов)||максТокенов<1||максТокенов>8192)throw new Error('Недопустимый лимит токенов');
    const response=await this.выполнить('/chat/completions',{
      method:'POST',headers:{'Content-Type':'application/json','Accept':'text/event-stream'},
      body:JSON.stringify({model:this.модель,stream:true,max_tokens:максТокенов,
        messages:история.map(m=>({role:m.роль==='система'?'system':m.роль==='пользователь'?'user':'assistant',content:m.текст}))}),
      signal:сигнал
    },60000);
    if(!response.body)throw new Error('Cloud.ru не вернул поток ответа');
    const reader=response.body.getReader(),decoder=new TextDecoder();
    let buffer='',answer='',done=false;
    try {
      while(true){
        const item=await reader.read();
        if(item.done)break;
        if(сигнал?.aborted)throw new Error('Запрос Cloud.ru отменён');
        buffer+=decoder.decode(item.value,{stream:true});
        if(buffer.length>262144)throw new Error('Cloud.ru: слишком длинный фрагмент потока');
        let split;
        while((split=buffer.indexOf('\n'))>=0){
          const line=buffer.slice(0,split).trim();
          buffer=buffer.slice(split+1);
          if(!line.startsWith('data:'))continue;
          const data=line.slice(5).trim();
          if(data==='[DONE]'){done=true;break;}
          if(!data)continue;
          let packet;
          try{packet=JSON.parse(data);}catch{throw new Error('Cloud.ru: повреждён поток ответа');}
          if(packet.error)throw new Error('Cloud.ru: генерация завершилась ошибкой');
          const delta=packet.choices?.[0]?.delta?.content;
          if(typeof delta==='string'&&delta.length){
            answer+=delta;
            if(answer.length>500000)throw new Error('Cloud.ru: ответ слишком большой');
            onChunk(delta);
          }
        }
        if(done)break;
      }
      if(сигнал?.aborted)throw new Error('Запрос Cloud.ru отменён');
      if(!done||!answer.trim())throw new Error('Cloud.ru: поток завершён без полного ответа');
      return answer;
    }finally{await reader.cancel().catch(()=>{});}
  }

}

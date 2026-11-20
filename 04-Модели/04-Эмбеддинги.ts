// Experimental opt-in OpenAI-compatible embeddings adapter. NEVER used automatically.
// Foundation Models lists Qwen3-Embedding, but /embeddings is not in its public
// OpenAPI specification. A real key may encounter an unsupported endpoint.
export const МОДЕЛЬ_ЭМБЕДДИНГОВ='Qwen/Qwen3-Embedding-0.6B';
export class CloudEmbeddings {
  constructor(
    private readonly ключ:string,
    private readonly запрос:typeof fetch=fetch,
    private readonly base='https://foundation-models.api.cloud.ru/v1'
  ){
    if(!ключ.trim())throw new Error('Отсутствует ключ Cloud.ru');
    const endpoint=new URL(base);
    if(endpoint.protocol!=='https:'||this.запрос===fetch&&endpoint.hostname!=='foundation-models.api.cloud.ru')
      throw new Error('Неверный адрес Cloud.ru embeddings');
  }
  async векторизовать(тексты:string[],сигнал?:AbortSignal):Promise<number[][]>{
    if(!тексты.length||тексты.length>16||тексты.some(t=>!t.trim()||t.length>2400))
      throw new Error('Недопустимый размер пакета embeddings');
    let response:Response;
    try{
      response=await this.запрос(this.base+'/embeddings',{
        method:'POST',
        headers:{Authorization:'Bearer '+this.ключ,'Content-Type':'application/json'},
        body:JSON.stringify({model:МОДЕЛЬ_ЭМБЕДДИНГОВ,input:тексты}),
        signal:сигнал?AbortSignal.any([сигнал,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)
      });
    }catch{
      throw new Error('Cloud.ru: не удалось выполнить запрос эмбеддингов');
    }
    if(!response.ok)throw new Error('Cloud.ru embeddings: HTTP '+response.status+
      '. Проверьте поддержку эндпоинта и доступ к модели.');
    const payload=await response.json() as {
      data?:Array<{index?:number;embedding?:unknown}>
    };
    if(!Array.isArray(payload.data)||payload.data.length!==тексты.length)
      throw new Error('Cloud.ru embeddings: неожиданный формат ответа');
    const vectors=payload.data.map((entry,i)=>({
      index:Number.isInteger(entry.index)?entry.index:i,
      value:entry.embedding
    })).sort((a,b)=>a.index-b.index);
    if(vectors.some((entry,i)=>entry.index!==i||!Array.isArray(entry.value)||
      entry.value.length<16||entry.value.length>8192||
      entry.value.some(v=>typeof v!=='number'||!Number.isFinite(v))))
      throw new Error('Cloud.ru embeddings: неверная размерность или значения');
    const dimension=(vectors[0].value as number[]).length;
    if(vectors.some(v=>(v.value as number[]).length!==dimension))
      throw new Error('Cloud.ru embeddings: несовместимые размерности');
    return vectors.map(v=>v.value as number[]);
  }
}

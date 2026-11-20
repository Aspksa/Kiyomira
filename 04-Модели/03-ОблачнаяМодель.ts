import type { ПровайдерМодели } from './01-ПровайдерМодели.ts';
import type { Сообщение } from '../02-Память/01-ПамятьДиалога.ts';

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

  async создатьОтвет(история: readonly Сообщение[], сигнал?: AbortSignal): Promise<string> {
    const ответ = await this.выполнить('/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.модель,
        stream: false,
        max_tokens: 2500,
        messages: история.map(сообщение => ({
          role: сообщение.роль === 'пользователь' ? 'user' : 'assistant',
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
}

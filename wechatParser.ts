import axios from 'axios';
import * as cheerio from 'cheerio';

// ✅ Логирование для отладки
const logs: string[] = [];
function log(msg: string) {
  logs.push(msg);
  console.log(`[WeChatParser] ${msg}`);
}

export function getLogs() {
  return logs;
}

export function clearLogs() {
  logs.length = 0;
}

export async function parseWeChat(url: string) {
  clearLogs();
  log(`Начинаем парсинг WeChat: ${url}`);

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; SM-G981B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Referer': 'https://mp.weixin.qq.com/'
      },
      timeout: 20000
    });

    const $ = cheerio.load(response.data);
    
    const title = $('meta[property="og:title"]').attr('content') || $('h1').text() || 'Без названия';
    log(`Заголовок: ${title}`);

    let text = '';
    $('.rich_media_content p, article p').each((i, el) => {
      const pText = $(el).text().trim();
      if (pText.length > 10) text += pText + '\n';
    });

    if (text.length < 50) {
      text = $('body').text().trim();
    }
    text = text.substring(0, 10000);
    log(`Извлечено текста: ${text.length} символов`);

    const images: string[] = [];
    $('img').each((i, el) => {
      if (images.length >= 10) return;
      const src = $(el).attr('data-src') || $(el).attr('src');
      if (src && (src.includes('mmbiz') || src.includes('qpic.cn'))) {
        images.push(src);
      }
    });
    log(`Найдено изображений: ${images.length}`);

    return { title, text, images };
  } catch (e: any) {
    log(`Ошибка парсинга: ${e.message}`);
    throw e;
  }
}

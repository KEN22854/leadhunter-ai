// Очистка HTML-прототипа от активного содержимого. Прототип показывается в iframe с sandbox (без скриптов)
// и уходит клиенту вложением — поэтому скрипты, обработчики событий и внешние загрузки вырезаются всегда.

const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">`;

export function sanitizePrototype(html: string): string {
  let s = html.slice(0, 400_000);
  s = s.replace(/<\s*(script|iframe|object|embed|applet|frame|frameset|base|link|form|input|button|textarea|select|meta\s+http-equiv)[\s\S]*?(<\/\s*\1\s*>|>)/gi, (m, tag: string) =>
    /^meta/i.test(tag) ? "" : /^(input|button|textarea|select)$/i.test(tag) ? m.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "") : "",
  );
  s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  s = s.replace(/(href|src|action|formaction|xlink:href)\s*=\s*("|')\s*(javascript|vbscript|data:text\/html)[^"']*\2/gi, '$1="#"');
  // Внешние ресурсы в CSS (@import, url(http…)) — запрещены
  s = s.replace(/@import[^;]+;/gi, "").replace(/url\(\s*(['"]?)(https?:|\/\/)[^)]*\)/gi, "none");
  s = s.replace(/<img[^>]+src=["']https?:[^"']*["'][^>]*>/gi, "");
  if (!/<!doctype html>/i.test(s)) s = `<!doctype html>\n${s}`;
  // CSP первым элементом <head>: даже если что-то пропущено фильтром, браузер не выполнит скрипты и не пойдёт в сеть
  s = /<head[^>]*>/i.test(s) ? s.replace(/<head[^>]*>/i, (h) => `${h}\n${CSP}`) : s.replace(/<html[^>]*>/i, (h) => `${h}<head>${CSP}</head>`);
  return s;
}

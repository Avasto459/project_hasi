export function productImageSrc(source: string) {
  const value = source.trim();
  if (!value) return "";
  if (/^(https?:\/\/|data:image\/|blob:)/i.test(value)) return value;
  // Локальные статичные ассеты проекта (SVG-заглушки /products/*.svg и /hasi-logo.png
  // лежат в public/ и раздаются самим Next.js) — оставляем как есть.
  // Всё остальное локальное (/products/....jpg, products/... и т.п.) — прямая ссылка
  // на оригинал с hasi.tj, чтобы картинка открывалась и локально, и на Vercel.
  if (value === "/hasi-logo.png" || (/^\/products\/.+\.svg(\?.*)?$/i.test(value))) return value;
  if (value.startsWith("public/")) return `https://hasi.tj/${value.slice("public/".length)}`;
  if (value.startsWith("./")) return `https://hasi.tj/${value.slice(2)}`;
  if (value.startsWith("/")) {
    // WooCommerce хранит медиа в /wp-content/uploads/...; если в БД лежит
    // укороченный путь /uploads/..., подставляем wp-content/ между хостом и путём.
    if (value.startsWith("/uploads/") && !value.startsWith("/wp-content/")) {
      return `https://hasi.tj/wp-content${value}`;
    }
    return `https://hasi.tj${value}`;
  }
  return `https://hasi.tj/${value}`;
}

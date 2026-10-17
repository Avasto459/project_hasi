export function productImageSrc(source: string) {
  const value = source.trim();
  if (!value) return "";
  if (/^(https?:\/\/|data:image\/|blob:)/i.test(value)) return value;
  if (value.startsWith("public/")) return `/${value.slice("public/".length)}`;
  if (value.startsWith("./")) return `/${value.slice(2)}`;
  // Локальные относительные пути (например /products/foo.jpg) — преобразуем
  // в прямую ссылку на оригинал с hasi.tj, чтобы картинка открывалась и на Vercel.
  if (value.startsWith("/")) return `https://hasi.tj${value}`;
  return `https://hasi.tj/${value}`;
}

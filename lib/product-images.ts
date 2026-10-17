export function productImageSrc(source: string) {
  const value = source.trim();
  if (!value) return "";
  if (/^(https?:\/\/|data:image\/|blob:)/i.test(value)) return value;
  // Локальные относительные пути (например /products/foo.jpg, public/..., ./...) — преобразуем
  // в прямую ссылку на оригинал с hasi.tj, чтобы картинка открывалась и локально, и на Vercel.
  if (value.startsWith("public/")) return `https://hasi.tj/${value.slice("public/".length)}`;
  if (value.startsWith("./")) return `https://hasi.tj/${value.slice(2)}`;
  if (value.startsWith("/")) return `https://hasi.tj${value}`;
  return `https://hasi.tj/${value}`;
}

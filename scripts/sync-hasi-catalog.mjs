import { createClient } from '@libsql/client';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';

const site = (process.env.HASI_CATALOG_URL || 'https://hasi.tj').replace(/\/$/, '');
const localOnly = process.argv.includes('--local');
const useTurso = !localOnly && Boolean(process.env.TURSO_DATABASE_URL?.trim() && process.env.TURSO_AUTH_TOKEN?.trim());
if (localOnly) await mkdir('data', { recursive: true });
const db = useTurso
  ? createClient({ url: process.env.TURSO_DATABASE_URL.trim(), authToken: process.env.TURSO_AUTH_TOKEN.trim() })
  : createClient({ url: 'file:data/hasi.db' });
const now = new Date().toISOString();
const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `item-${randomUUID()}`;
const plainText = (html) => String(html || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/\s+/g, ' ').trim();
// def(value, fallback) — если value === undefined, подставляем надёжное бек-ап значение,
// чтобы в базу никогда не попали undefined-аргументы (вызывает ошибку SQLite).
const def = (v, fb) => v === undefined ? fb : v;
async function getJson(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // Create a fresh timeout for every request; reusing one AbortSignal causes all
      // requests after the first 20 seconds to fail immediately.
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; HASI-TJ-CatalogSync/1.0; +https://hasi.tj)',
          Accept: 'application/json, text/plain, */*',
        },
        signal: AbortSignal.timeout(25000),
        redirect: 'follow',
      });
      if (!response.ok) throw new Error(`HASI API вернул HTTP ${response.status} для ${url}`);
      try {
        return await response.json();
      } catch (error) {
        throw new Error(`Ответ HASI.TJ не является корректным JSON (${url}): ${error?.message || error}`);
      }
    } catch (error) {
      lastError = error;
      const cause = error?.cause;
      const detail = [error?.message, cause?.code, cause?.message].filter(Boolean).join(' | ');
      if (attempt < 3) {
        console.warn(`Запрос ${attempt}/3 не удался: ${detail}. Повтор через ${attempt * 2} сек.`);
        await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
      }
    }
  }
  const cause = lastError?.cause;
  throw new Error(`Не удалось получить ${url} после 3 попыток. ${lastError?.message || lastError}${cause?.code ? ` (код: ${cause.code})` : ''}. Проверь интернет/DNS, доступность hasi.tj и переменную HASI_CATALOG_URL.`);
}

async function fetchAllProducts() {
  const products = [];
  for (let page = 1; page <= 100; page++) {
    const batch = await getJson(`${site}/wp-json/wc/store/v1/products?per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error('WooCommerce Store API вернул неожиданный формат. База не изменена.');
    products.push(...batch);
    if (batch.length < 100) break;
  }
  if (!products.length) throw new Error('HASI.TJ вернул пустой каталог. База не изменена.');
  return products;
}

function priceOf(p) {
  const raw = p?.prices?.price ?? p?.price ?? p?.regular_price;
  if (raw === undefined || raw === null || raw === '') return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  if (p?.prices?.currency_minor_unit !== undefined) return n / (10 ** Number(p.prices.currency_minor_unit));
  return n;
}

try {
  // Minimal schema bootstrap for a fresh local dev database. Full schema is created by the app.
  await db.execute(`CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, subtitle TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', image TEXT NOT NULL DEFAULT '', sourceUrl TEXT NOT NULL DEFAULT '', sort INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'published')`);
  await db.execute(`CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, shortDescription TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', sku TEXT NOT NULL DEFAULT '', brand TEXT NOT NULL DEFAULT '', images TEXT NOT NULL DEFAULT '[]', specifications TEXT NOT NULL DEFAULT '{}', price REAL NOT NULL DEFAULT 0, previousPrice REAL, image TEXT NOT NULL DEFAULT '', sourceUrl TEXT NOT NULL DEFAULT '', categoryId TEXT NOT NULL, featured INTEGER NOT NULL DEFAULT 0, rating REAL NOT NULL DEFAULT 0, stock INTEGER NOT NULL DEFAULT 0, isPublished INTEGER NOT NULL DEFAULT 1, createdAt TEXT NOT NULL, FOREIGN KEY(categoryId) REFERENCES categories(id))`);

  const rawProducts = await fetchAllProducts();
  let officialCategories = [];
  try {
    for (let page = 1; page <= 20; page++) {
      const batch = await getJson(`${site}/wp-json/wc/store/v1/products/categories?per_page=100&page=${page}`);
      if (!Array.isArray(batch)) break;
      officialCategories.push(...batch);
      if (batch.length < 100) break;
    }
  } catch { /* older WooCommerce installations may not expose Store API categories */ }
  const liveProducts = rawProducts.map((p) => {
    const name = plainText(p.name) || p.sku || `Товар ${p.id}`;
    const slug = slugify(p.slug || name);
    // Нормализация картинок: в БД сохраняем ТОЛЬКО полные внешние URL вида
    // https://hasi.tj/wp-content/uploads/..., никогда локальные /products/... пути.
    // Обрабатываем все формы, которые может вернуть WooCommerce API:
    // https://..., http://... (апгрейд до https), //host/... (добавляем https:),
    // /wp-content/... и wp-content/... (добавляем https://hasi.tj).
    const toAbsoluteImageUrl = (raw) => {
      if (typeof raw !== 'string') return '';
      const src = raw.trim();
      if (!src) return '';
      if (/^https:\/\//i.test(src)) return src;
      if (/^http:\/\//i.test(src)) return src.replace(/^http:\/\//i, 'https://');
      if (src.startsWith('//')) return `https:${src}`;
      if (src.startsWith('/')) {
        // WooCommerce хранит медиа в /wp-content/uploads/...; если в БД лежит
        // укороченный путь /uploads/..., подставляем wp-content/ между хостом и путём.
        if (src.startsWith('/uploads/') && !src.startsWith('/wp-content/')) {
          return `${site}/wp-content${src}`;
        }
        return `${site}${src}`;
      }
      if (/^[a-z0-9-]+\.[a-z]{2,}\//i.test(src)) return `https://${src}`;
      if (/^[\w][\w\-./]*\.(jpe?g|png|webp|gif|avif|svg)(\?.*)?$/i.test(src)) return `${site}/${src.replace(/^\.\//, '')}`;
      // Остальное (data:, blob:, чужие https — тоже оставляем, остальное отбрасываем).
      if (/^(data:image\/|blob:|https:\/\/)/i.test(src)) return src;
      return '';
    };
    const images = (p.images || [])
      .map((i) => toAbsoluteImageUrl(i?.src || i?.thumbnail || i?.url || ''))
      .filter(Boolean);
    const cats = Array.isArray(p.categories) ? p.categories : [];
    const cat = cats[0] || { name: 'Hikvision', slug: 'hikvision' };
    const description = plainText(p.description || p.short_description || name);
    const short = plainText(p.short_description || p.description || name).slice(0, 450);
    const sku = plainText(p.sku || '');
    const brand = /hikvision/i.test(`${name} ${description}`) ? 'Hikvision' : 'HASI Technology';
    const price = priceOf(p);
    const previous = p.prices?.regular_price ? Number(p.prices.regular_price) / (10 ** Number(p.prices.currency_minor_unit ?? 2)) : null;
    return { id: `hasi-${slug}`, slug, name, sku, description, short, images, image: images[0] || '', sourceUrl: p.permalink || `${site}/?post_type=product&p=${p.id}`, categoryName: plainText(cat.name) || 'Каталог', categorySlug: slugify(cat.slug || cat.name), price, previousPrice: previous && previous > price ? previous : null, stock: p.is_in_stock ? 10 : 0, featured: Boolean(p.is_featured), createdAt: now };
  });

  // Ensure categories are upserted before products reference them.
  const categories = new Map();
  for (const c of officialCategories) {
    const name = plainText(c.name);
    if (name) categories.set(slugify(c.slug || name), { slug: slugify(c.slug || name), name });
  }
  for (const p of liveProducts) categories.set(p.categorySlug, { slug: p.categorySlug, name: p.categoryName });
  let sort = 0;
  const categoryIds = new Map();
  for (const c of categories.values()) {
    const found = await db.execute({ sql: 'SELECT id FROM categories WHERE slug=? LIMIT 1', args: [c.slug] });
    const id = found.rows[0]?.id ? String(found.rows[0].id) : `hasi-cat-${c.slug}`;
    categoryIds.set(c.slug, id);
    await db.execute({
      sql: `INSERT INTO categories(id,slug,name,subtitle,description,image,sourceUrl,sort,status) VALUES(?,?,?,?,?,?,?,?, 'published')
            ON CONFLICT(slug) DO UPDATE SET name=excluded.name,subtitle=excluded.subtitle,description=excluded.description,sourceUrl=excluded.sourceUrl,status='published'`,
      args: [id, c.slug, c.name, c.name, `Товары категории ${c.name} с официального каталога HASI.TJ.`, '', `${site}/product-category/${c.slug}/`, sort++],
    });
    const actual = await db.execute({ sql: 'SELECT id FROM categories WHERE slug=? LIMIT 1', args: [c.slug] });
    categoryIds.set(c.slug, String(actual.rows[0].id));
  }

  // Убедимся, что у каждого товара есть категория в categoryIds (защита от undefined categoryId).
  for (const p of liveProducts) {
    if (!categoryIds.has(p.categorySlug)) {
      const fallbackSlug = 'hasi-cat-uncategorized';
      if (!categoryIds.has(fallbackSlug)) {
        categoryIds.set(fallbackSlug, fallbackSlug);
        await db.execute({
          sql: `INSERT INTO categories(id,slug,name,subtitle,description,image,sourceUrl,sort,status) VALUES(?,?,?,?,?,?,?,?, 'published')
                ON CONFLICT(slug) DO NOTHING`,
          args: [fallbackSlug, fallbackSlug, 'Без категории', '', 'Товары без указанной категории.', '', `${site}/product-category/uncategorized/`, 9999],
        });
      }
      categoryIds.set(p.categorySlug, categoryIds.get(fallbackSlug));
    }
  }

  const keepSlugs = new Set();
  for (const p of liveProducts) {
    keepSlugs.add(p.slug);
    const old = await db.execute({ sql: 'SELECT id FROM products WHERE slug=? LIMIT 1', args: [p.slug] });
    const id = old.rows[0]?.id ? String(old.rows[0].id) : p.id;
    await db.execute({
      sql: `INSERT INTO products(id,slug,name,shortDescription,description,sku,brand,images,specifications,price,previousPrice,image,sourceUrl,categoryId,featured,rating,stock,isPublished,createdAt)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(slug) DO UPDATE SET name=excluded.name,shortDescription=excluded.shortDescription,description=excluded.description,sku=excluded.sku,brand=excluded.brand,images=excluded.images,price=excluded.price,previousPrice=excluded.previousPrice,image=excluded.image,sourceUrl=excluded.sourceUrl,categoryId=excluded.categoryId,featured=excluded.featured,stock=excluded.stock,isPublished=1`,
      args: [
        def(id, randomUUID()), def(p.slug, slugify(p.name)), def(p.name, `Товар ${p.id}`),
        def(p.short, ''), def(p.description, ''), def(p.sku, ''), def(p.brand, 'HASI Technology'),
        JSON.stringify(def(p.images, [])), JSON.stringify(def({ source: 'hasi.tj' }, { source: 'hasi.tj' })),
        def(p.price, 0), def(p.previousPrice, null), def(p.image, ''), def(p.sourceUrl, `${site}/?post_type=product&p=${p.id}`),
        def(categoryIds.get(p.categorySlug), 'hasi-cat-uncategorized'),
        def(p.featured ? 1 : 0, 0), def(5, 0), def(p.stock, 0), 1, def(p.createdAt, now)
      ],
    });
  }

  // Delete products absent from the current live catalog. Keep order item snapshots, but clear stock ledgers that reference products.
  const all = await db.execute('SELECT id,slug FROM products');
  const stale = all.rows.filter((r) => !keepSlugs.has(String(r.slug)));
  for (const p of stale) {
    const id = String(p.id);
    for (const table of ['offers_stock', 'stock_movements']) {
      try { await db.execute({ sql: `DELETE FROM ${table} WHERE productId=?`, args: [id] }); }
      catch (e) { if (!/no such table/i.test(String(e?.message || e))) throw e; }
    }
    await db.execute({ sql: 'DELETE FROM products WHERE id=?', args: [id] });
  }
  const keepCategorySlugs = [...categories.keys()];
  if (keepCategorySlugs.length) {
    const placeholders = keepCategorySlugs.map(() => '?').join(',');
    await db.execute({ sql: `DELETE FROM categories WHERE slug NOT IN (${placeholders}) AND id NOT IN (SELECT DISTINCT categoryId FROM products)`, args: keepCategorySlugs });
  }

  const count = await db.execute('SELECT COUNT(*) AS n FROM products WHERE isPublished=1');
  console.log(`Каталог HASI.TJ обновлён: ${count.rows[0].n} товаров, ${categories.size} категорий.`);
  console.log(`Источник: ${site}; база: ${useTurso ? 'Turso (remote)' : 'локальная data/hasi.db'}.`);
} catch (error) {
  console.error('Не удалось обновить каталог. Текущие товары не были очищены до успешного получения данных.', error?.message || error);
  process.exitCode = 1;
} finally {
  await db.close();
}

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["bcryptjs"],
  images: {
    // Картинки из каталога hasi.tj (абсолютные URL, синхронизируются через sync-hasi-catalog.mjs)
    remotePatterns: [
      {
        protocol: "https",
        hostname: "hasi.tj",
        port: "",
        pathname: "/**",
      },
    ],
  },
  // В serverless-бандл Vercel обязательно упаковываем SQLite-файл с 47 актуальными
  // товарами, иначе Server Components/API не найдут data/hasi.db и упадут на
  // пустую in-memory базу с демо-заглушками (расхождение с localhost).
  outputFileTracingIncludes: {
    "/": ["./data/hasi.db"],
    "/api/**/*": ["./data/hasi.db"],
    "/catalog": ["./data/hasi.db"],
    "/product/**/*": ["./data/hasi.db"],
  },
};

export default nextConfig;

export default nextConfig;

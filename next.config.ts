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
};

export default nextConfig;

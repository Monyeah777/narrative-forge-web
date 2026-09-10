import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `next dev` 会用模板路径 /hall/[id] 去对 generateStaticParams；
  // 开着 export 就会 E443。静态导出只在 production build 启用。
  ...(process.env.NODE_ENV === "production" ? { output: "export" as const } : {}),
  images: { unoptimized: true },
};

export default nextConfig;

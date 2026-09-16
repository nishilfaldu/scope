import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  allowedDevOrigins: ["127.0.0.1"],
  async redirects() {
    return [
      {
        source: "/passports",
        destination: "/",
        permanent: true,
      },
      {
        source: "/passports/:path*",
        destination: "/slices/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;

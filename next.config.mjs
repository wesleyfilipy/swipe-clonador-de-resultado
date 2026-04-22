/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  experimental: {
    /** Apify SDK + proxy: fora do bundle do RSC, evita "Cannot find module 'proxy-agent'" no Vercel. */
    serverComponentsExternalPackages: ["apify-client", "proxy-agent"],
  },
};

export default nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  experimental: {
    /** Apify SDK + proxy: fora do bundle do RSC, evita "Cannot find module 'proxy-agent'" no Vercel. */
    serverComponentsExternalPackages: ["apify-client", "proxy-agent"],
    /**
     * apify-client usa import() dinâmico de `proxy-agent`; o file-tracing do Next não a incluía no .nft.json.
     * Chave `**` aplica a todos os entrypoints server.
     */
    outputFileTracingIncludes: {
      "**": [
        "node_modules/proxy-agent/**",
        "node_modules/http-proxy-agent/**",
        "node_modules/https-proxy-agent/**",
        "node_modules/socks-proxy-agent/**",
        "node_modules/pac-proxy-agent/**",
        "node_modules/agent-base/**",
        "node_modules/lru-cache/**",
        "node_modules/apify-client/**",
      ],
    },
  },
};

export default nextConfig;

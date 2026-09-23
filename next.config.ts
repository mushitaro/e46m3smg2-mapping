import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    output: 'export',
    // The tool must run from a folder in a garage with no network, so nothing may depend on a
    // server at request time.
    images: { unoptimized: true },
    reactStrictMode: true,
};

export default nextConfig;

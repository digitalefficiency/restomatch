import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@restomatch/api',
    '@restomatch/charts',
    '@restomatch/db',
    '@restomatch/types',
    '@restomatch/ui-tokens',
  ],
  serverExternalPackages: ['nodemailer', 'postgres'],
};

export default config;

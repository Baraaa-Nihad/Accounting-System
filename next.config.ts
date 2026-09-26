import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  serverExternalPackages: ['exceljs', 'pg', '@prisma/adapter-pg'],
  experimental: {
    serverActions: {
      // رفع المرفقات وملفات Excel والنسخ الاحتياطية
      bodySizeLimit: '25mb',
    },
  },
}

export default nextConfig

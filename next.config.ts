import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  serverExternalPackages: ['exceljs', 'pg', '@prisma/adapter-pg'],
  experimental: {
    serverActions: {
      // رفع المرفقات وملفات Excel
      bodySizeLimit: '25mb',
    },
    // proxy يخزّن جسم الطلب مؤقتًا ويقطعه بصمت عند الحد (10MB افتراضيًا): يجب أن يتجاوز حد الرفع أعلاه
    proxyClientMaxBodySize: '30mb',
  },
}

export default nextConfig

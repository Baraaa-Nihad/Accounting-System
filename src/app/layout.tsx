import type { Metadata, Viewport } from 'next'
import { Toaster } from 'sonner'
import '@fontsource/ibm-plex-sans-arabic/400.css'
import '@fontsource/ibm-plex-sans-arabic/500.css'
import '@fontsource/ibm-plex-sans-arabic/600.css'
import '@fontsource/ibm-plex-sans-arabic/700.css'
import './globals.css'

// كل الصفحات ديناميكية (تعتمد على الجلسة وتحتاج nonce لسياسة أمان المحتوى)
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: { default: 'النظام المالي للمدرسة', template: '%s — النظام المالي للمدرسة' },
  description: 'نظام محاسبي وإداري مالي متكامل للمدارس الخاصة',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0e7d73',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>
        {children}
        <Toaster
          dir="rtl"
          position="top-center"
          richColors
          closeButton
          toastOptions={{ style: { fontFamily: 'var(--font-sans)', fontSize: '15px' } }}
        />
      </body>
    </html>
  )
}

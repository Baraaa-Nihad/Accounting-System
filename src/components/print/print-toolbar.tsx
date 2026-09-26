'use client'

import * as React from 'react'
import { Printer, X, FileDown } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** شريط أعلى صفحة الطباعة (لا يظهر على الورق). */
export function PrintToolbar({ title, pdfHref }: { title: string; pdfHref?: string | null }) {
  React.useEffect(() => {
    if (new URLSearchParams(window.location.search).get('auto') === '1') {
      const t = setTimeout(() => window.print(), 400)
      return () => clearTimeout(t)
    }
  }, [])
  return (
    <div className="no-print sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="font-semibold text-slate-800">{title}</p>
      <div className="flex gap-2">
        {pdfHref ? (
          <Button variant="secondary" asChild>
            <a href={pdfHref}>
              <FileDown />
              تنزيل PDF
            </a>
          </Button>
        ) : null}
        <Button onClick={() => window.print()}>
          <Printer />
          طباعة / حفظ PDF
        </Button>
        <Button variant="ghost" onClick={() => window.close()}>
          <X />
          إغلاق
        </Button>
      </div>
    </div>
  )
}

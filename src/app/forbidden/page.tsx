import Link from 'next/link'
import { ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'

export const metadata = { title: 'لا تملك صلاحية' }

export default function ForbiddenPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="card max-w-md p-8 text-center">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
          <ShieldAlert className="size-7" />
        </div>
        <h1 className="text-xl font-bold text-slate-900">لا تملك صلاحية الوصول لهذه الصفحة</h1>
        <p className="mt-2 text-slate-500">إذا كنت تحتاج هذه الصفحة في عملك، اطلب من مدير النظام منحك الصلاحية المناسبة.</p>
        <Button asChild className="mt-6">
          <Link href="/">العودة للرئيسية</Link>
        </Button>
      </div>
    </main>
  )
}

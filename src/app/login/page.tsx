import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/server/auth/guard'
import { getSetting } from '@/server/settings'
import { LoginForm } from './login-form'

export const metadata = { title: 'تسجيل الدخول' }

export default async function LoginPage() {
  const user = await getCurrentUser()
  if (user) redirect('/')
  const school = await getSetting('school')
  return (
    <main className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-brand-50 via-white to-slate-100 p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-brand-600 text-3xl font-bold text-white shadow-lg shadow-brand-600/20">
            {school.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/api/logo" alt="" className="size-16 rounded-2xl bg-white object-contain p-1" />
            ) : (
              <span>م</span>
            )}
          </div>
          <h1 className="text-2xl font-bold text-slate-900">{school.name}</h1>
          <p className="mt-1 text-slate-500">النظام المالي والمحاسبي</p>
        </div>
        <div className="card p-6 sm:p-8">
          <h2 className="mb-5 text-lg font-semibold text-slate-800">تسجيل الدخول</h2>
          <LoginForm />
        </div>
        <p className="mt-6 text-center text-xs text-slate-400">جميع عمليات الدخول مسجلة لأغراض الأمان</p>
      </div>
    </main>
  )
}

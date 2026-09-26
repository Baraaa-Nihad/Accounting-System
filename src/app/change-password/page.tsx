import { requireUser } from '@/server/auth/guard'
import { ChangePasswordForm } from './form'

export const metadata = { title: 'تغيير كلمة المرور' }

export default async function ChangePasswordPage() {
  const user = await requireUser({ allowPasswordChange: true })
  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface p-4">
      <div className="w-full max-w-md">
        <div className="card p-6 sm:p-8">
          <h1 className="text-lg font-bold text-slate-900">تغيير كلمة المرور</h1>
          <p className="mb-5 mt-1 text-sm text-slate-500">
            {user.mustChangePassword
              ? 'لحماية حسابك يجب تعيين كلمة مرور جديدة خاصة بك قبل المتابعة.'
              : 'أدخل كلمة المرور الحالية ثم الجديدة.'}
          </p>
          <ChangePasswordForm />
        </div>
      </div>
    </main>
  )
}

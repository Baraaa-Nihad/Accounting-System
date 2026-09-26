'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { login, logout } from '@/server/auth/login'

const schema = z.object({
  username: z.string().trim().min(1, 'أدخل اسم المستخدم').max(100),
  password: z.string().min(1, 'أدخل كلمة المرور').max(200),
})

export async function loginAction(_prev: { error?: string } | null, formData: FormData): Promise<{ error?: string }> {
  const parsed = schema.safeParse({ username: formData.get('username'), password: formData.get('password') })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'بيانات غير صالحة' }
  const result = await login(parsed.data.username, parsed.data.password)
  if (!result.ok) return { error: result.error }
  redirect(result.mustChangePassword ? '/change-password' : '/')
}

export async function logoutAction() {
  await logout()
  redirect('/login')
}

'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import type { ActionResult } from '@/server/errors'

/**
 * تشغيل Server Action مع حالة الانتظار والأخطاء والإشعارات:
 * const { run, pending, fieldErrors } = useAction(createStudentAction)
 */
export function useAction<TInput, TOutput>(
  action: (input: TInput) => Promise<ActionResult<TOutput>>,
  options?: {
    successMessage?: string | ((data: TOutput) => string)
    onSuccess?: (data: TOutput) => void
    refresh?: boolean
  },
) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)

  const run = React.useCallback(
    (input: TInput): Promise<ActionResult<TOutput>> =>
      new Promise((resolve) => {
        startTransition(async () => {
          setError(null)
          setFieldErrors({})
          let result: ActionResult<TOutput>
          try {
            result = await action(input)
          } catch {
            result = { ok: false, error: 'تعذر الاتصال بالخادم. تحقق من الاتصال وحاول مجددًا.' }
          }
          if (!result) {
            // الإجراء أعاد التوجيه (redirect) دون نتيجة
            resolve({ ok: true, data: undefined as TOutput })
            return
          }
          if (result.ok) {
            const msg =
              typeof options?.successMessage === 'function'
                ? options.successMessage(result.data)
                : (options?.successMessage ?? result.message)
            if (msg) toast.success(msg)
            options?.onSuccess?.(result.data)
            if (options?.refresh !== false) router.refresh()
          } else {
            setError(result.error)
            setFieldErrors(result.fieldErrors ?? {})
            toast.error(result.error)
          }
          resolve(result)
        })
      }),
    [action, options, router],
  )

  return { run, pending, fieldErrors, error, setFieldErrors }
}

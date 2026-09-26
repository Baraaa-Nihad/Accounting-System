'use client'

import * as React from 'react'
import { PERMISSION_GROUPS, PERMISSIONS, type Permission } from '@/lib/permissions'
import { cn } from '@/lib/utils'

/**
 * مصفوفة الصلاحيات مجمعة حسب الأقسام. تُستخدم لتعديل الدور (اختيار مباشر)
 * ولتخصيص مستخدم (الأساس من الدور مع إضافة أو حجب صلاحيات بعينها).
 */
export function PermissionMatrix({
  isOn,
  onToggle,
  tag,
  disabled,
}: {
  isOn: (p: Permission) => boolean
  onToggle: (p: Permission, on: boolean) => void
  tag?: (p: Permission) => { label: string; tone: 'add' | 'remove' } | null
  disabled?: boolean
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {PERMISSION_GROUPS.map((g) => {
        const count = g.permissions.filter(isOn).length
        const all = count === g.permissions.length
        return (
          <fieldset key={g.label} className="rounded-xl border border-slate-200" disabled={disabled}>
            <legend className="sr-only">{g.label}</legend>
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-3 py-2">
              <span className="text-sm font-semibold text-slate-800">
                {g.label}{' '}
                <span className="num text-xs font-normal text-slate-400">
                  {count}/{g.permissions.length}
                </span>
              </span>
              <button
                type="button"
                className="text-xs font-medium text-brand-700 hover:underline disabled:text-slate-400 disabled:no-underline"
                disabled={disabled}
                onClick={() => g.permissions.forEach((p) => onToggle(p, !all))}
              >
                {all ? 'إلغاء الكل' : 'تحديد الكل'}
              </button>
            </div>
            <ul className="space-y-1 p-2">
              {g.permissions.map((p) => {
                const t = tag?.(p)
                return (
                  <li key={p}>
                    <label className={cn('flex cursor-pointer items-start gap-2 rounded-lg px-1.5 py-1 hover:bg-slate-50', disabled && 'cursor-default hover:bg-transparent')}>
                      <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-brand-600" checked={isOn(p)} onChange={(e) => onToggle(p, e.target.checked)} />
                      <span className="text-sm leading-5 text-slate-700">
                        {PERMISSIONS[p]}
                        {t ? (
                          <span className={cn('ms-1.5 rounded px-1 text-[11px] font-medium', t.tone === 'add' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700')}>{t.label}</span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </fieldset>
        )
      })}
    </div>
  )
}

/** كلمة مرور مؤقتة عشوائية (أحرف وأرقام) تُسلّم للمستخدم ليغيرها عند أول دخول. */
export function randomPassword() {
  const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ'
  const digits = '23456789'
  const buf = new Uint32Array(10)
  crypto.getRandomValues(buf)
  const pick = (s: string, n: number) => s[n % s.length]
  return `${pick(letters, buf[0])}${pick(letters, buf[1])}${pick(letters, buf[2])}${pick(letters, buf[3])}-${pick(digits, buf[4])}${pick(digits, buf[5])}${pick(digits, buf[6])}${pick(digits, buf[7])}-${pick(letters, buf[8])}${pick(letters, buf[9])}`
}

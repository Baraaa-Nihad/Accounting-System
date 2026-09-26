'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input'
import { Field, FormSection } from '@/components/ui/field'
import { MoneyInput } from '@/components/forms/money-input'
import { useAction } from '@/lib/use-action'
import { createEmployeeAction, updateEmployeeAction } from '@/app/(app)/employees/actions'

export interface EmployeeFormValue {
  fullName: string
  phone: string
  jobTitle: string
  department: string
  isTeacher: boolean
  gender: string
  nationalId: string
  hireDate: string
  salaryType: 'MONTHLY' | 'DAILY' | 'HOURLY'
  baseSalary: string
  overtimeRate: string
  bankName: string
  bankAccount: string
  iban: string
  address: string
  notes: string
}

export const EMPTY_EMPLOYEE: EmployeeFormValue = {
  fullName: '',
  phone: '',
  jobTitle: '',
  department: '',
  isTeacher: false,
  gender: '',
  nationalId: '',
  hireDate: '',
  salaryType: 'MONTHLY',
  baseSalary: '',
  overtimeRate: '',
  bankName: '',
  bankAccount: '',
  iban: '',
  address: '',
  notes: '',
}

const SALARY_LABEL = { MONTHLY: 'الراتب الشهري', DAILY: 'الأجر اليومي', HOURLY: 'أجر الساعة' }

export function EmployeeForm({
  employeeId,
  initial,
  departments,
  canSeeSalary,
}: {
  employeeId?: number
  initial?: EmployeeFormValue
  departments: string[]
  canSeeSalary: boolean
}) {
  const router = useRouter()
  const [v, setV] = React.useState<EmployeeFormValue>(initial ?? EMPTY_EMPLOYEE)
  const create = useAction(createEmployeeAction, { onSuccess: (d) => router.push(`/employees/${d.id}`) })
  const update = useAction(updateEmployeeAction, { onSuccess: (d) => router.push(`/employees/${d.id}`) })
  const { pending, fieldErrors } = employeeId ? update : create
  const set = (k: keyof EmployeeFormValue) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setV((p) => ({ ...p, [k]: e.target.value }))

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const data = { ...v, baseSalary: v.baseSalary || '0', overtimeRate: v.overtimeRate || null, hireDate: v.hireDate || null }
    if (employeeId) update.run({ id: employeeId, data })
    else create.run(data)
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <FormSection title="بيانات الموظف">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="الاسم الكامل" required error={fieldErrors.fullName} className="sm:col-span-2">
            <Input value={v.fullName} onChange={set('fullName')} autoFocus={!employeeId} />
          </Field>
          <Field label="النوع" className="flex">
            <Checkbox
              className="mt-2"
              checked={v.isTeacher}
              onChange={(e) => setV((p) => ({ ...p, isTeacher: e.target.checked }))}
              label="معلم / معلمة"
              description="لتمييز الهيئة التدريسية عن الإداريين في التقارير"
            />
          </Field>
          <Field label="المسمى الوظيفي">
            <Input value={v.jobTitle} onChange={set('jobTitle')} placeholder="مثال: معلمة رياضيات" />
          </Field>
          <Field label="القسم">
            <Input value={v.department} onChange={set('department')} list="departments" placeholder="مثال: المرحلة الأساسية" />
            <datalist id="departments">
              {departments.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </Field>
          <Field label="الجنس">
            <Select value={v.gender} onChange={set('gender')}>
              <option value="">—</option>
              <option value="MALE">ذكر</option>
              <option value="FEMALE">أنثى</option>
            </Select>
          </Field>
          <Field label="رقم الهاتف" error={fieldErrors.phone}>
            <Input value={v.phone} onChange={set('phone')} dir="ltr" className="text-start" inputMode="tel" />
          </Field>
          <Field label="رقم الهوية">
            <Input value={v.nationalId} onChange={set('nationalId')} dir="ltr" className="text-start" />
          </Field>
          <Field label="تاريخ التعيين" error={fieldErrors.hireDate}>
            <Input type="date" value={v.hireDate} onChange={set('hireDate')} />
          </Field>
          <Field label="العنوان" className="sm:col-span-2 lg:col-span-3">
            <Input value={v.address} onChange={set('address')} />
          </Field>
        </div>
      </FormSection>

      {canSeeSalary ? (
        <FormSection title="الراتب" description="يُستخدم في احتساب مسير الرواتب الشهري. تغيير الراتب يُسجل في سجل النشاط.">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="نوع الراتب" required>
              <Select value={v.salaryType} onChange={(e) => setV((p) => ({ ...p, salaryType: e.target.value as EmployeeFormValue['salaryType'] }))}>
                <option value="MONTHLY">شهري</option>
                <option value="DAILY">يومي</option>
                <option value="HOURLY">بالساعة</option>
              </Select>
            </Field>
            <Field label={SALARY_LABEL[v.salaryType]} required error={fieldErrors.baseSalary}>
              <MoneyInput value={v.baseSalary} onChange={(x) => setV((p) => ({ ...p, baseSalary: x }))} />
            </Field>
            <Field label="سعر ساعة الإضافي" error={fieldErrors.overtimeRate} hint="اتركه فارغًا ليُحسب من الراتب تلقائيًا">
              <MoneyInput value={v.overtimeRate} onChange={(x) => setV((p) => ({ ...p, overtimeRate: x }))} />
            </Field>
          </div>
        </FormSection>
      ) : null}

      <FormSection title="الحساب البنكي" description="لتحويل الراتب (اختياري)">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="البنك">
            <Input value={v.bankName} onChange={set('bankName')} />
          </Field>
          <Field label="رقم الحساب">
            <Input value={v.bankAccount} onChange={set('bankAccount')} dir="ltr" className="text-start" />
          </Field>
          <Field label="IBAN">
            <Input value={v.iban} onChange={set('iban')} dir="ltr" className="text-start" />
          </Field>
        </div>
      </FormSection>

      <FormSection title="ملاحظات">
        <Textarea value={v.notes} onChange={set('notes')} rows={3} />
      </FormSection>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => router.back()}>
          إلغاء
        </Button>
        <Button type="submit" size="lg" loading={pending}>
          {!pending ? <Save /> : null}
          {employeeId ? 'حفظ التعديلات' : 'حفظ الموظف'}
        </Button>
      </div>
    </form>
  )
}

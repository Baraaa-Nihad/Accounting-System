'use client'

import { useRouter } from 'next/navigation'
import { ChargeForm, type ChargeTypeOption, type DiscountTypeOption } from './charge-form'
import type { PickedStudent } from '@/components/forms/student-picker'

export function NewChargePageForm(props: {
  student: PickedStudent | null
  chargeTypes: ChargeTypeOption[]
  discountTypes: DiscountTypeOption[]
  years: { id: number; name: string; status: string }[]
  defaultYearId: number | null
  canDiscount: boolean
}) {
  const router = useRouter()
  return (
    <div className="card p-5 sm:p-6">
      <ChargeForm
        fixedStudent={props.student}
        chargeTypes={props.chargeTypes}
        discountTypes={props.discountTypes}
        years={props.years}
        defaultYearId={props.defaultYearId}
        canDiscount={props.canDiscount}
        onDone={(id) => router.push(`/charges/${id}`)}
        onCancel={() => router.back()}
      />
    </div>
  )
}

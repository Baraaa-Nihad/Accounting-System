'use client'

import * as React from 'react'
import { FilePlus2 } from 'lucide-react'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ChargeForm, type ChargeTypeOption, type DiscountTypeOption } from './charge-form'
import type { PickedStudent } from '@/components/forms/student-picker'

export function AddChargeDialog({
  student,
  chargeTypes,
  discountTypes,
  years,
  defaultYearId,
  canDiscount,
}: {
  student: PickedStudent
  chargeTypes: ChargeTypeOption[]
  discountTypes: DiscountTypeOption[]
  years: { id: number; name: string; status: string }[]
  defaultYearId: number | null
  canDiscount: boolean
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <FilePlus2 />
          إضافة ذمة
        </Button>
      </DialogTrigger>
      <DialogContent title={`إضافة ذمة للطالب: ${student.fullName}`} description="الذمة = مبلغ مطلوب من الطالب (رسوم، كتب، زي، باص...)" size="2xl">
        <ChargeForm
          fixedStudent={student}
          chargeTypes={chargeTypes}
          discountTypes={discountTypes}
          years={years}
          defaultYearId={defaultYearId}
          canDiscount={canDiscount}
          onDone={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

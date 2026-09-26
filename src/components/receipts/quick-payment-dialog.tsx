'use client'

import * as React from 'react'
import { HandCoins } from 'lucide-react'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { PaymentForm } from './payment-form'

/** زر «تسجيل دفعة» الكبير في ملف الطالب. */
export function QuickPaymentDialog({ student }: { student: { id: number; fullName: string } }) {
  const [open, setOpen] = React.useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg">
          <HandCoins />
          تسجيل دفعة
        </Button>
      </DialogTrigger>
      <DialogContent title={`تسجيل دفعة — ${student.fullName}`} description="أدخل المبلغ، وسيوزعه النظام على الأقدم استحقاقًا ويمكنك تعديل التوزيع." size="xl">
        {open ? <PaymentForm studentId={student.id} onClose={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  )
}

/** زر «تسجيل دفعة عائلية» في حساب ولي الأمر. */
export function FamilyPaymentDialog({ guardian }: { guardian: { id: number; name: string } }) {
  const [open, setOpen] = React.useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg">
          <HandCoins />
          تسجيل دفعة عائلية
        </Button>
      </DialogTrigger>
      <DialogContent title={`دفعة عائلية — ${guardian.name}`} description="سند قبض واحد يوزع على أكثر من طالب من الأبناء." size="xl">
        {open ? <PaymentForm guardianId={guardian.id} onClose={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  )
}

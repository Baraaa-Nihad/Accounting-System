'use client'

import * as React from 'react'
import Link from 'next/link'
import { Table, TableWrap, TD, TH, THead, TR, TFootRow } from '@/components/ui/table'
import { Badge, StatusBadge } from '@/components/ui/badge'
import { ChargeActions } from '@/components/charges/charge-actions'
import { DiscountDialog, type DiscountChargeOption } from '@/components/charges/discount-dialog'
import type { DiscountTypeOption } from '@/components/charges/charge-form'
import { useFormat } from '@/components/providers/app-provider'
import { PAYMENT_STATUS } from '@/lib/labels'
import { D, sum } from '@/lib/money'

export interface ChargeRow {
  id: number
  typeName: string
  description: string | null
  yearName: string
  academicYearId: number
  chargeTypeId: number
  date: string
  gross: string
  discount: string
  net: string
  paid: string
  status: string
  paymentStatus: string
  installmentCount: number
  cancelReason: string | null
}

export function StudentChargesTable({
  studentId,
  rows,
  discountTypes,
  years,
  defaultYearId,
}: {
  studentId: number
  rows: ChargeRow[]
  discountTypes: DiscountTypeOption[]
  years: { id: number; name: string; status: string }[]
  defaultYearId: number | null
}) {
  const f = useFormat()
  const [discountFor, setDiscountFor] = React.useState<number | null>(null)
  const active = rows.filter((r) => r.status === 'ACTIVE')
  const options: DiscountChargeOption[] = active.map((r) => ({
    id: r.id,
    label: `${r.typeName}${r.description ? ` — ${r.description}` : ''} (${r.yearName})`,
    chargeTypeId: r.chargeTypeId,
    chargeTypeName: r.typeName,
    academicYearId: r.academicYearId,
    gross: r.gross,
    net: r.net,
    paid: r.paid,
  }))
  return (
    <>
      <TableWrap>
        <Table>
          <THead>
            <tr>
              <TH>التاريخ</TH>
              <TH>نوع الذمة</TH>
              <TH>السنة</TH>
              <TH numeric>المبلغ</TH>
              <TH numeric>الخصم</TH>
              <TH numeric>بعد الخصم</TH>
              <TH numeric>المدفوع</TH>
              <TH numeric>المتبقي</TH>
              <TH>الحالة</TH>
              <TH />
            </tr>
          </THead>
          <tbody>
            {rows.map((r) => {
              const remaining = D(r.net).minus(D(r.paid))
              const cancelled = r.status === 'CANCELLED'
              return (
                <TR key={r.id} className={cancelled ? 'opacity-60' : undefined}>
                  <TD>{f.date(r.date)}</TD>
                  <TD>
                    <Link href={`/charges/${r.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                      {r.typeName}
                    </Link>
                    {r.description ? <span className="block text-xs text-slate-500">{r.description}</span> : null}
                    {r.installmentCount > 1 ? <span className="block text-xs text-slate-500">{r.installmentCount} أقساط</span> : null}
                  </TD>
                  <TD className="text-slate-500">
                    <bdi className="ltr num">{r.yearName}</bdi>
                  </TD>
                  <TD numeric>{f.money(r.gross)}</TD>
                  <TD numeric className="text-emerald-700">
                    {f.money(r.discount, { hideZero: true })}
                  </TD>
                  <TD numeric>{f.money(r.net)}</TD>
                  <TD numeric>{f.money(r.paid, { hideZero: true })}</TD>
                  <TD numeric className="font-semibold">
                    {cancelled ? '—' : f.money(remaining, { hideZero: true })}
                  </TD>
                  <TD>
                    {cancelled ? (
                      <Badge tone="gray" dot>
                        ملغاة
                      </Badge>
                    ) : (
                      <StatusBadge map={PAYMENT_STATUS} value={r.paymentStatus} />
                    )}
                  </TD>
                  <TD>
                    <ChargeActions
                      chargeId={r.id}
                      remaining={remaining.toString()}
                      paid={r.paid}
                      cancelled={cancelled}
                      onDiscount={() => setDiscountFor(r.id)}
                    />
                  </TD>
                </TR>
              )
            })}
          </tbody>
          <tfoot>
            <TFootRow>
              <TD colSpan={3}>الإجمالي (الذمم الفعالة)</TD>
              <TD numeric>{f.money(sum(active.map((r) => r.gross)))}</TD>
              <TD numeric>{f.money(sum(active.map((r) => r.discount)))}</TD>
              <TD numeric>{f.money(sum(active.map((r) => r.net)))}</TD>
              <TD numeric>{f.money(sum(active.map((r) => r.paid)))}</TD>
              <TD numeric>{f.money(sum(active.map((r) => D(r.net).minus(D(r.paid)))))}</TD>
              <TD colSpan={2} />
            </TFootRow>
          </tfoot>
        </Table>
      </TableWrap>
      {discountFor !== null ? (
        <DiscountDialog
          key={discountFor}
          studentId={studentId}
          charges={options}
          discountTypes={discountTypes}
          years={years}
          defaultYearId={defaultYearId}
          presetChargeId={discountFor}
          open
          onOpenChange={(o) => {
            if (!o) setDiscountFor(null)
          }}
        />
      ) : null}
    </>
  )
}

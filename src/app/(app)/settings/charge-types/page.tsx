import { requirePermission } from '@/server/auth/guard'
import { db } from '@/server/db'
import { chargeTypesList } from '@/server/services/charges'
import { getFormatConfig } from '@/server/settings'
import { makeFormatters } from '@/lib/format-jsx'
import { PageHeader } from '@/components/ui/page-header'
import { SettingsLayout } from '@/components/settings/settings-nav'
import { Table, TableWrap, TD, TH, THead, TR } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { ChargeTypeDialog } from '@/components/settings/types-client'

export const metadata = { title: 'تصنيفات الذمم' }

export default async function ChargeTypesPage() {
  await requirePermission('revenues.manage')
  const [types, fmt] = await Promise.all([chargeTypesList(db, false), getFormatConfig()])
  const f = makeFormatters(fmt)
  const counts = await db.charge.groupBy({ by: ['chargeTypeId'], _count: true })
  return (
    <>
      <PageHeader title="تصنيفات الذمم" description="أنواع المبالغ التي تُضاف على الطلاب. كل تصنيف مرتبط بحساب إيراد خاص به." actions={<ChargeTypeDialog />} />
      <SettingsLayout active="charge-types">
        <div className="card overflow-hidden">
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>التصنيف</TH>
                  <TH>حساب الإيراد</TH>
                  <TH numeric>المبلغ الافتراضي</TH>
                  <TH>التقسيط</TH>
                  <TH numeric>عدد الذمم</TH>
                  <TH>الحالة</TH>
                  <TH />
                </tr>
              </THead>
              <tbody>
                {types.map((t) => (
                  <TR key={t.id}>
                    <TD className="font-medium">
                      {t.name}
                      {t.systemKey ? <Badge className="ms-2">نظامي</Badge> : null}
                    </TD>
                    <TD className="text-slate-500">
                      <bdi className="ltr num">{t.revenueAccount.code}</bdi> {t.revenueAccount.name}
                    </TD>
                    <TD numeric>{t.defaultAmount ? f.money(t.defaultAmount) : '—'}</TD>
                    <TD>{t.allowInstallments ? 'نعم' : '—'}</TD>
                    <TD numeric>{counts.find((c) => c.chargeTypeId === t.id)?._count ?? 0}</TD>
                    <TD>{t.isActive ? <Badge tone="green">فعال</Badge> : <Badge>معطل</Badge>}</TD>
                    <TD>
                      <ChargeTypeDialog
                        initial={{
                          id: t.id,
                          name: t.name,
                          defaultAmount: t.defaultAmount?.toString() ?? '',
                          allowInstallments: t.allowInstallments,
                          isActive: t.isActive,
                          description: t.description ?? '',
                          system: !!t.systemKey,
                        }}
                      />
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </div>
      </SettingsLayout>
    </>
  )
}

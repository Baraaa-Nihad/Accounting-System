import { requirePermission } from '@/server/auth/guard'
import { db } from '@/server/db'
import { discountTypesList } from '@/server/services/charges'
import { PageHeader } from '@/components/ui/page-header'
import { SettingsLayout } from '@/components/settings/settings-nav'
import { Table, TableWrap, TD, TH, THead, TR } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { DiscountTypeDialog } from '@/components/settings/types-client'
import { DISCOUNT_METHOD } from '@/lib/labels'

export const metadata = { title: 'أنواع الخصم' }

export default async function DiscountTypesPage() {
  await requirePermission('revenues.manage')
  const types = await discountTypesList(db, false)
  const counts = await db.discount.groupBy({ by: ['discountTypeId'], _count: true })
  return (
    <>
      <PageHeader title="أنواع الخصم" description="خصم إخوة، موظفين، تفوق، خاص، من الإدارة... تظهر في نافذة الخصم ويُستخدم نوعها في التقارير." actions={<DiscountTypeDialog />} />
      <SettingsLayout active="discount-types">
        <div className="card overflow-hidden">
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>النوع</TH>
                  <TH>الطريقة الافتراضية</TH>
                  <TH>القيمة الافتراضية</TH>
                  <TH numeric>مرات الاستخدام</TH>
                  <TH>الحالة</TH>
                  <TH />
                </tr>
              </THead>
              <tbody>
                {types.map((t) => (
                  <TR key={t.id}>
                    <TD className="font-medium">{t.name}</TD>
                    <TD>{t.defaultMethod ? DISCOUNT_METHOD[t.defaultMethod] : '—'}</TD>
                    <TD className="num">{t.defaultValue ? `${t.defaultValue.toString()}${t.defaultMethod === 'PERCENT' ? '%' : ''}` : '—'}</TD>
                    <TD numeric>{counts.find((c) => c.discountTypeId === t.id)?._count ?? 0}</TD>
                    <TD>{t.isActive ? <Badge tone="green">فعال</Badge> : <Badge>معطل</Badge>}</TD>
                    <TD>
                      <DiscountTypeDialog
                        initial={{
                          id: t.id,
                          name: t.name,
                          defaultMethod: t.defaultMethod ?? '',
                          defaultValue: t.defaultValue?.toString() ?? '',
                          isActive: t.isActive,
                          description: t.description ?? '',
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

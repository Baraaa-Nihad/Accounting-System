import type { Formatters } from '@/lib/format-jsx'
import { GENDER, PAYMENT_METHOD, SALARY_TYPE, STUDENT_STATUS } from '@/lib/labels'
import type { FieldKind } from '@/server/import/types'

/** عرض قيمة حقل بعد التنظيف (ما سيُحفظ فعلًا)، أو القيمة الأصلية المرفوضة بلون التحذير. */
export function ImportCellValue({ kind, value, raw, f }: { kind: FieldKind; value: unknown; raw: unknown; f: Formatters }) {
  if (value === null || value === undefined) {
    const text = raw === null || raw === undefined ? '' : String(raw).trim()
    return text ? <bdi className="text-rose-600 line-through decoration-rose-300">{text}</bdi> : <span className="text-slate-300">—</span>
  }
  switch (kind) {
    case 'amount':
    case 'signedAmount':
      return f.money(String(value), { symbol: false })
    case 'integer':
      return f.number(Number(value))
    case 'date':
      return f.date(String(value))
    case 'phone':
      return <bdi className="ltr num">{String(value)}</bdi>
    case 'bool':
      return <>{value ? 'نعم' : 'لا'}</>
    case 'gender':
      return <>{GENDER[String(value)] ?? String(value)}</>
    case 'studentStatus':
      return <>{STUDENT_STATUS[String(value)]?.label ?? String(value)}</>
    case 'salaryType':
      return <>{SALARY_TYPE[String(value)] ?? String(value)}</>
    case 'paymentMethod':
      return <>{PAYMENT_METHOD[String(value)] ?? String(value)}</>
    case 'discount': {
      const d = value as { method: string; value: string }
      return d.method === 'PERCENT' ? <bdi className="ltr num">{d.value}%</bdi> : f.money(d.value, { symbol: false })
    }
    default:
      return <bdi>{String(value)}</bdi>
  }
}

import 'server-only'
import ExcelJS from 'exceljs'
import { db } from '../db'
import type { ImportTypeDef } from './types'
import { KIND_HELP } from './kind-help'


/** ExcelJS يدعم القوائم المنسدلة لكن تعريفات الأنواع لا تتضمنها. */
type WithValidations = { dataValidations: { add: (range: string, validation: object) => void } }
const addValidation = (ws: ExcelJS.Worksheet, range: string, validation: object) => (ws as unknown as WithValidations).dataValidations.add(range, validation)

const LISTS: Record<string, string[]> = {
  gender: ['ذكر', 'أنثى'],
  studentStatus: ['فعال', 'منسحب', 'متخرج', 'موقوف'],
  salaryType: ['شهري', 'يومي', 'بالساعة'],
  paymentMethod: ['نقدي', 'تحويل بنكي', 'بطاقة', 'إلكتروني', 'أخرى'],
  bool: ['نعم', 'لا'],
}

/** قالب Excel جاهز: ورقة البيانات (عناوين عربية + صف مثال + قوائم منسدلة)، ورقة التعليمات، وورقة القوائم المرجعية. */
export async function buildTemplate(def: ImportTypeDef): Promise<Buffer> {
  const [grades, chargeTypes, categories, cash] = await Promise.all([
    db.grade.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], include: { sections: { orderBy: { name: 'asc' } } } }),
    db.chargeType.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
    db.account.findMany({ where: { type: 'EXPENSE', isGroup: false, isActive: true }, orderBy: { code: 'asc' } }),
    db.cashAccount.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
  ])
  const wb = new ExcelJS.Workbook()
  wb.creator = 'School Accounting'
  const data = wb.addWorksheet('البيانات', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] })
  const lists = wb.addWorksheet('القوائم', { views: [{ rightToLeft: true }] })
  const help = wb.addWorksheet('التعليمات', { views: [{ rightToLeft: true }] })

  // القوائم المرجعية
  const refColumns: { title: string; values: string[]; field?: string }[] = [
    { title: 'الصفوف', values: grades.map((g) => g.name), field: 'grade' },
    { title: 'الشعب', values: [...new Set(grades.flatMap((g) => g.sections.map((s) => s.name)))], field: 'section' },
    { title: 'أنواع الذمم', values: chargeTypes.map((t) => t.name), field: 'chargeType' },
    { title: 'تصنيفات المصروفات', values: categories.map((c) => c.name), field: 'category' },
    { title: 'الصناديق والبنوك', values: cash.map((c) => c.name), field: 'cashAccount' },
  ]
  refColumns.forEach((col, i) => {
    const c = i + 1
    lists.getCell(1, c).value = col.title
    lists.getCell(1, c).font = { bold: true }
    col.values.forEach((val, j) => (lists.getCell(j + 2, c).value = val))
    lists.getColumn(c).width = 24
  })

  // ورقة البيانات
  def.fields.forEach((f, i) => {
    const cell = data.getCell(1, i + 1)
    cell.value = f.label
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: f.required ? 'FF0E7D73' : 'FF64748B' } }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    // المثال في ملاحظة العنوان وورقة التعليمات، لا كصف بيانات (حتى لا يُستورد بالخطأ)
    cell.note = [f.required ? 'إجباري' : 'اختياري', KIND_HELP[f.kind], f.hint, f.example !== undefined ? `مثال: ${f.example}` : null].filter(Boolean).join('\n')
    data.getColumn(i + 1).width = Math.max(14, f.label.length + 6)
    if (f.kind === 'date') data.getColumn(i + 1).numFmt = 'dd/mm/yyyy'
    if (f.kind === 'phone' || f.key.toLowerCase().includes('number')) data.getColumn(i + 1).numFmt = '@'
    // قوائم منسدلة (للإرشاد فقط؛ النظام يقبل أيضًا القيم المكتوبة يدويًا)
    const ref = refColumns.findIndex((col) => col.field === f.key && col.values.length > 0)
    const letter = data.getColumn(i + 1).letter
    if (ref >= 0) {
      const colLetter = lists.getColumn(ref + 1).letter
      addValidation(data, `${letter}2:${letter}5000`, {
        type: 'list',
        allowBlank: true,
        showErrorMessage: false,
        formulae: [`'القوائم'!$${colLetter}$2:$${colLetter}$${refColumns[ref].values.length + 1}`],
      })
    } else if (LISTS[f.kind]) {
      addValidation(data, `${letter}2:${letter}5000`, { type: 'list', allowBlank: true, showErrorMessage: false, formulae: [`"${LISTS[f.kind].join(',')}"`] })
    }
  })
  data.getRow(1).height = 22

  // التعليمات
  help.getColumn(1).width = 26
  help.getColumn(2).width = 10
  help.getColumn(3).width = 46
  help.getColumn(4).width = 60
  help.getColumn(5).width = 20
  help.getCell(1, 1).value = `استيراد: ${def.label}`
  help.getCell(1, 1).font = { bold: true, size: 14 }
  help.getCell(2, 1).value = def.description
  const general = [
    'املأ ورقة «البيانات» بدءًا من الصف 2. الأعمدة الخضراء إجبارية، ومرّر المؤشر على عنوان أي عمود لرؤية مثال.',
    'لا تغيّر أسماء الأعمدة؛ وإن اختلفت يمكنك ربطها يدويًا عند الرفع.',
    'القيم تُنظّف تلقائيًا: الأرقام العربية والفواصل، التواريخ بصيغ مختلفة، أرقام الهواتف بالمفتاح الدولي.',
    'لا يُستورد أي شيء قبل المعاينة والضغط على «تأكيد الاستيراد»، ويُستورد الكل في عملية واحدة.',
    ...(def.instructions ?? []),
  ]
  general.forEach((line, i) => (help.getCell(4 + i, 1).value = `• ${line}`))
  const start = 6 + general.length
  ;['العمود', 'إجباري', 'الصيغة المقبولة', 'ملاحظات', 'مثال'].forEach((h, i) => {
    const c = help.getCell(start, i + 1)
    c.value = h
    c.font = { bold: true }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }
  })
  def.fields.forEach((f, i) => {
    help.getCell(start + 1 + i, 1).value = f.label
    help.getCell(start + 1 + i, 2).value = f.required ? 'نعم' : 'لا'
    help.getCell(start + 1 + i, 3).value = KIND_HELP[f.kind] ?? ''
    help.getCell(start + 1 + i, 4).value = f.hint ?? ''
    help.getCell(start + 1 + i, 5).value = f.example ?? ''
  })
  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf)
}

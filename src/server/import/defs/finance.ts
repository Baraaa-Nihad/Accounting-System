import 'server-only'
import { db } from '../../db'
import { createCharge } from '../../services/charges'
import { applyStudentCredit, createOpeningCredit, createStudentReceipt } from '../../services/receipts'
import { createVoucher } from '../../services/vouchers'
import { accountsTotals } from '../../ledger/balances'
import { D } from '@/lib/money'
import type { DateOnly } from '@/lib/dates'
import { findCashAccount, findChargeType, findExpenseAccount, findStudent, openYearFor } from '../lookups'
import type { CommitResult, ImportEnv, ImportField, ImportTypeDef, NormalizedRow, ValidatedRow } from '../types'
import { atRow } from '../row'

/** استيراد أرصدة الطلاب، الذمم، الأقساط، سندات القبض، المصروفات، وسندات الصرف. */

const v = <T = string>(r: { values: Record<string, unknown> }, k: string) => (r.values[k] ?? null) as T | null

function base(r: NormalizedRow): ValidatedRow {
  return { rowNumber: r.rowNumber, status: r.errors.length ? 'error' : 'valid', messages: [...r.errors], values: { ...r.values } }
}

function fail(out: ValidatedRow, message: string) {
  out.status = 'error'
  out.messages.push(message)
  return out
}

const studentField: ImportField = {
  key: 'student',
  label: 'الطالب',
  kind: 'text',
  required: true,
  synonyms: ['رقم الطالب', 'اسم الطالب', 'الرقم المدرسي', 'student', 'student number', 'student name'],
  hint: 'رقم الطالب أو الرقم المدرسي أو الاسم الكامل (إن كان فريدًا)',
  example: '00125',
}

function resolveStudent(out: ValidatedRow, env: ImportEnv) {
  const s = findStudent(env.lookups, String(out.values.student))
  if ('error' in s) return fail(out, s.error)
  out.values.studentId = s.student.id
  out.values.studentName = s.student.fullName
  return out
}

/** تاريخ داخل السنة المختارة (أو بدايتها إن لم يُحدد). */
function dateInYear(out: ValidatedRow, env: ImportEnv, key: string) {
  const year = env.lookups.years.find((y) => y.id === env.options.yearId)
  if (!year) return fail(out, 'اختر السنة الدراسية')
  const d = v<DateOnly>(out, key)
  if (!d) {
    const def = env.today >= year.startDate && env.today <= year.endDate ? env.today : year.startDate
    out.values[key] = def
    return out
  }
  if (d < year.startDate || d > year.endDate) return fail(out, `التاريخ ${d} خارج السنة الدراسية ${year.name}`)
  return out
}

function dateInOpenYear(out: ValidatedRow, env: ImportEnv) {
  const d = v<DateOnly>(out, 'date')
  if (d && d > env.today) return fail(out, `التاريخ ${d} في المستقبل`)
  if (d && !openYearFor(env.lookups, d)) return fail(out, `التاريخ ${d} لا يقع في سنة دراسية مفتوحة`)
  return out
}

// ---------------------------------------------------------------------
// أرصدة الطلاب الافتتاحية
// ---------------------------------------------------------------------

export const balancesImport: ImportTypeDef = {
  key: 'balances',
  label: 'أرصدة الطلاب',
  description: 'الأرصدة السابقة: الموجب = مبلغ مستحق على الطالب (ذمة «رصيد سابق»)، والسالب = رصيد دائن له.',
  permissions: ['charges.create'],
  needsYear: true,
  fields: [
    studentField,
    { key: 'balance', label: 'الرصيد', kind: 'signedAmount', required: true, synonyms: ['الرصيد السابق', 'المبلغ', 'balance', 'amount'], hint: 'موجب = على الطالب، سالب = له', example: 1200 },
    { key: 'date', label: 'التاريخ', kind: 'date', synonyms: ['date'], hint: 'الافتراضي بداية السنة المختارة' },
    { key: 'notes', label: 'ملاحظات', kind: 'text', synonyms: ['notes', 'البيان'] },
  ],
  async validate(rows, env) {
    const [charges, credits] = await Promise.all([
      db.charge.findMany({ where: { status: 'ACTIVE', chargeType: { systemKey: 'OPENING_BALANCE' } }, select: { studentId: true } }),
      db.receipt.findMany({ where: { status: 'ACTIVE', kind: 'OPENING_CREDIT' }, select: { studentId: true } }),
    ])
    const has = new Set([...charges.map((c) => c.studentId), ...credits.map((c) => c.studentId)])
    const seen = new Map<number, number>()
    return rows.map((r) => {
      const out = base(r)
      if (out.status === 'error') return out
      if (resolveStudent(out, env).status === 'error') return out
      const date = env.lookups.years.find((y) => y.id === env.options.yearId)?.startDate
      if (!v(out, 'date') && date) out.values.date = date
      if (dateInYear(out, env, 'date').status === 'error') return out
      const sid = Number(out.values.studentId)
      if (seen.has(sid)) return fail(out, `الطالب مكرر في الملف (الصف ${seen.get(sid)})`)
      seen.set(sid, r.rowNumber)
      if (has.has(sid)) {
        out.status = 'duplicate'
        out.messages.push('للطالب رصيد افتتاحي مسجل مسبقًا')
      }
      return out
    })
  },
  async commit(tx, ctx, rows, env) {
    const res: CommitResult = { created: 0, updated: 0, skipped: 0, notes: [] }
    const type = await tx.chargeType.findUniqueOrThrow({ where: { systemKey: 'OPENING_BALANCE' } })
    for (const r of rows) {
      if (r.status !== 'valid') {
        res.skipped++
        continue
      }
      const amount = D(String(r.values.balance))
      if (amount.greaterThan(0)) {
        await atRow(r.rowNumber, () => createCharge(tx, ctx, {
          studentId: Number(r.values.studentId),
          chargeTypeId: type.id,
          academicYearId: env.options.yearId!,
          date: String(r.values.date),
          grossAmount: amount.toString(),
          description: 'رصيد سابق (استيراد)',
          notes: v(r, 'notes'),
          importBatchId: env.batchId,
        }))
      } else {
        await atRow(r.rowNumber, () => createOpeningCredit(tx, ctx, { studentId: Number(r.values.studentId), date: String(r.values.date), amount: amount.abs().toString(), notes: v(r, 'notes'), importBatchId: env.batchId }))
      }
      res.created++
    }
    return res
  },
}

// ---------------------------------------------------------------------
// الذمم
// ---------------------------------------------------------------------

const chargeTypeField: ImportField = { key: 'chargeType', label: 'نوع الذمة', kind: 'text', required: true, synonyms: ['نوع الرسوم', 'البند', 'charge type', 'fee type', 'type'], example: 'القسط الدراسي' }

function resolveChargeType(out: ValidatedRow, env: ImportEnv) {
  const t = findChargeType(env.lookups, String(out.values.chargeType))
  if (!t) return fail(out, `نوع الذمة «${out.values.chargeType}» غير موجود`)
  if (!t.isActive) return fail(out, `نوع الذمة «${t.name}» معطّل`)
  out.values.chargeTypeId = t.id
  out.values.allowInstallments = t.allowInstallments || t.systemKey === 'OPENING_BALANCE'
  return out
}

export const chargesImport: ImportTypeDef = {
  key: 'charges',
  label: 'الذمم',
  description: 'ذمة لكل صف مع خصمها (مبلغ أو نسبة) وتقسيطها التلقائي إلى أقساط متساوية.',
  permissions: ['charges.create'],
  needsYear: true,
  fields: [
    studentField,
    chargeTypeField,
    { key: 'amount', label: 'المبلغ', kind: 'amount', required: true, synonyms: ['القيمة', 'amount', 'value'], example: 5000 },
    { key: 'date', label: 'التاريخ', kind: 'date', synonyms: ['date', 'تاريخ الذمة'] },
    { key: 'discount', label: 'الخصم', kind: 'discount', synonyms: ['discount', 'قيمة الخصم'], hint: 'مبلغ (500) أو نسبة (10%)', example: '10%' },
    { key: 'installments', label: 'عدد الأقساط', kind: 'integer', synonyms: ['الأقساط', 'installments'], example: 8 },
    { key: 'firstDueDate', label: 'تاريخ أول قسط', kind: 'date', synonyms: ['أول قسط', 'first due date'] },
    { key: 'description', label: 'البيان', kind: 'text', synonyms: ['description', 'الوصف'] },
    { key: 'notes', label: 'ملاحظات', kind: 'text', synonyms: ['notes'] },
  ],
  async validate(rows, env) {
    const existing = await db.charge.findMany({ where: { status: 'ACTIVE', academicYearId: env.options.yearId ?? -1 }, select: { studentId: true, chargeTypeId: true, grossAmount: true } })
    const keys = new Set(existing.map((c) => `${c.studentId}|${c.chargeTypeId}|${D(c.grossAmount).toString()}`))
    const seen = new Map<string, number>()
    return rows.map((r) => {
      const out = base(r)
      if (out.status === 'error') return out
      if (resolveStudent(out, env).status === 'error' || resolveChargeType(out, env).status === 'error') return out
      if (dateInYear(out, env, 'date').status === 'error') return out
      const count = v<number>(out, 'installments') ?? 1
      if (count < 1 || count > 36) return fail(out, 'عدد الأقساط بين 1 و 36')
      if (count > 1 && !out.values.allowInstallments) return fail(out, `نوع الذمة «${out.values.chargeType}» لا يقبل التقسيط`)
      const discount = v<{ method: string; value: string }>(out, 'discount')
      if (discount?.method === 'FIXED' && D(discount.value).greaterThan(D(String(out.values.amount)))) return fail(out, 'الخصم أكبر من مبلغ الذمة')
      const key = `${out.values.studentId}|${out.values.chargeTypeId}|${D(String(out.values.amount)).toString()}`
      if (seen.has(`${key}|${out.values.date}`)) {
        out.status = 'duplicate'
        out.messages.push(`مكرر داخل الملف (الصف ${seen.get(`${key}|${out.values.date}`)})`)
        return out
      }
      seen.set(`${key}|${out.values.date}`, r.rowNumber)
      if (keys.has(key)) {
        out.status = 'duplicate'
        out.messages.push('للطالب ذمة من نفس النوع وبنفس المبلغ في هذه السنة')
      }
      return out
    })
  },
  async commit(tx, ctx, rows, env) {
    const res: CommitResult = { created: 0, updated: 0, skipped: 0, notes: [] }
    for (const r of rows) {
      if (r.status !== 'valid') {
        res.skipped++
        continue
      }
      const count = v<number>(r, 'installments') ?? 1
      const discount = v<{ method: 'PERCENT' | 'FIXED'; value: string }>(r, 'discount')
      await atRow(r.rowNumber, () => createCharge(tx, ctx, {
        studentId: Number(r.values.studentId),
        chargeTypeId: Number(r.values.chargeTypeId),
        academicYearId: env.options.yearId!,
        date: String(r.values.date),
        grossAmount: String(r.values.amount),
        description: v(r, 'description'),
        notes: v(r, 'notes'),
        discount: discount && D(discount.value).greaterThan(0) ? { method: discount.method, value: discount.value, reason: 'خصم مستورد من Excel' } : null,
        installments: count > 1 ? { count, firstDueDate: v<string>(r, 'firstDueDate') ?? String(r.values.date) } : null,
        applyRules: false,
        importBatchId: env.batchId,
      }))
      res.created++
    }
    return res
  },
}

// ---------------------------------------------------------------------
// الأقساط (جدول أقساط جاهز من النظام القديم)
// ---------------------------------------------------------------------

export const installmentsImport: ImportTypeDef = {
  key: 'installments',
  label: 'الأقساط',
  description: 'صف لكل قسط: صفوف نفس الطالب ونفس نوع الذمة تُجمع في ذمة واحدة بجدول أقساطها، مع المدفوع مسبقًا.',
  permissions: ['charges.create'],
  needsYear: true,
  fields: [
    studentField,
    chargeTypeField,
    { key: 'number', label: 'رقم القسط', kind: 'integer', required: true, synonyms: ['القسط', 'installment', 'installment number', 'no'], example: 1 },
    { key: 'dueDate', label: 'تاريخ الاستحقاق', kind: 'date', required: true, synonyms: ['الاستحقاق', 'due date', 'تاريخ القسط'], example: '01/10/2026' },
    { key: 'amount', label: 'المبلغ', kind: 'amount', required: true, synonyms: ['قيمة القسط', 'amount'], example: 600 },
    { key: 'paid', label: 'المدفوع مسبقًا', kind: 'amount', synonyms: ['المدفوع', 'paid', 'paid before'], hint: 'ما دُفع من هذا القسط قبل بدء النظام' },
  ],
  instructions: ['كل ذمة تُنشأ بمجموع أقساطها. المدفوع مسبقًا يُسجل كرصيد افتتاحي ويُوزع على الأقساط نفسها (بدون حركة صندوق).'],
  async validate(rows, env) {
    const out = rows.map((r) => {
      const o = base(r)
      if (o.status === 'error') return o
      if (resolveStudent(o, env).status === 'error' || resolveChargeType(o, env).status === 'error') return o
      const paid = v(o, 'paid')
      if (paid && D(paid).greaterThan(D(String(o.values.amount)))) return fail(o, 'المدفوع أكبر من مبلغ القسط')
      const year = env.lookups.years.find((y) => y.id === env.options.yearId)
      if (!year) return fail(o, 'اختر السنة الدراسية')
      o.groupKey = `${o.values.studentId}|${o.values.chargeTypeId}`
      return o
    })
    // فحوص على مستوى الذمة (المجموعة)
    const existing = await db.charge.findMany({ where: { status: 'ACTIVE', academicYearId: env.options.yearId ?? -1 }, select: { studentId: true, chargeTypeId: true, grossAmount: true } })
    const groups = new Map<string, ValidatedRow[]>()
    for (const o of out) if (o.groupKey) groups.set(o.groupKey, [...(groups.get(o.groupKey) ?? []), o])
    for (const [key, list] of groups) {
      const numbers = new Map<number, number>()
      for (const o of list) {
        const n = Number(o.values.number)
        if (numbers.has(n)) fail(o, `رقم القسط ${n} مكرر لنفس الذمة (الصف ${numbers.get(n)})`)
        else numbers.set(n, o.rowNumber)
      }
      if (list.length > 1 && list[0].values.allowInstallments === false) for (const o of list) fail(o, `نوع الذمة «${o.values.chargeType}» لا يقبل التقسيط`)
      const bad = list.find((o) => o.status === 'error')
      if (bad) {
        for (const o of list) if (o.status !== 'error') fail(o, `خطأ في قسط آخر لنفس الذمة (الصف ${bad.rowNumber})`)
        continue
      }
      const total = list.reduce((a, o) => a.plus(D(String(o.values.amount))), D(0))
      const [sid, tid] = key.split('|').map(Number)
      if (existing.some((c) => c.studentId === sid && c.chargeTypeId === tid && D(c.grossAmount).equals(total))) {
        for (const o of list) {
          o.status = 'duplicate'
          o.messages.push('للطالب ذمة من نفس النوع بنفس المجموع في هذه السنة')
        }
      }
    }
    // الصفوف ذات الأخطاء المبكرة (بلا مجموعة) تبقى كما هي
    return out.map((o) => ({ ...o }))
  },
  async commit(tx, ctx, rows, env) {
    const res: CommitResult = { created: 0, updated: 0, skipped: 0, notes: [] }
    const groups = new Map<string, ValidatedRow[]>()
    for (const r of rows) {
      if (r.status !== 'valid' || !r.groupKey) {
        res.skipped++
        continue
      }
      groups.set(r.groupKey, [...(groups.get(r.groupKey) ?? []), r])
    }
    for (const list of groups.values()) {
      const sorted = [...list].sort((a, b) => Number(a.values.number) - Number(b.values.number))
      const total = sorted.reduce((a, o) => a.plus(D(String(o.values.amount))), D(0))
      const first = sorted.reduce((m, o) => (String(o.values.dueDate) < m ? String(o.values.dueDate) : m), String(sorted[0].values.dueDate))
      const year = env.lookups.years.find((y) => y.id === env.options.yearId)!
      // تاريخ الذمة: أول استحقاق، دون أن يسبق بداية السنة أو يتجاوز اليوم (أو نهاية السنة)
      const latest = env.today < year.startDate ? year.startDate : env.today > year.endDate ? year.endDate : env.today
      const date = first < year.startDate ? year.startDate : first > latest ? latest : first
      const charge = await atRow(sorted[0].rowNumber, () => createCharge(tx, ctx, {
        studentId: Number(sorted[0].values.studentId),
        chargeTypeId: Number(sorted[0].values.chargeTypeId),
        academicYearId: year.id,
        date,
        grossAmount: total.toString(),
        description: 'مستورد من النظام السابق',
        installments: sorted.length > 1 ? { count: sorted.length, firstDueDate: first, schedule: sorted.map((o) => ({ dueDate: String(o.values.dueDate), amount: String(o.values.amount) })) } : null,
        dueDate: sorted.length === 1 ? String(sorted[0].values.dueDate) : null,
        applyRules: false,
        importBatchId: env.batchId,
      }))
      const prepaid = sorted.reduce((a, o) => a.plus(D(v(o, 'paid') ?? '0')), D(0))
      if (prepaid.greaterThan(0)) {
        await createOpeningCredit(tx, ctx, { studentId: charge.studentId, date, amount: prepaid.toString(), notes: 'مدفوعات سابقة على أقساط مستوردة', importBatchId: env.batchId })
        const insts = await tx.installment.findMany({ where: { chargeId: charge.id }, orderBy: { number: 'asc' } })
        const allocations = sorted
          .map((o, i) => ({ installmentId: insts[i]?.id, amount: v(o, 'paid') ?? '0' }))
          .filter((a): a is { installmentId: number; amount: string } => !!a.installmentId && D(a.amount).greaterThan(0))
        await applyStudentCredit(tx, ctx, charge.studentId, allocations)
      }
      res.created++
      res.notes.push(`ذمة ${sorted[0].values.studentName}: ${sorted.length} قسط`)
    }
    if (res.notes.length > 20) res.notes = [...res.notes.slice(0, 20), `... و${res.notes.length - 20} ذمة أخرى`]
    return res
  },
}

// ---------------------------------------------------------------------
// سندات القبض
// ---------------------------------------------------------------------

const cashField: ImportField = { key: 'cashAccount', label: 'الصندوق', kind: 'text', synonyms: ['الصندوق / البنك', 'الحساب', 'cash account', 'account'], hint: 'اسم الصندوق أو البنك كما في النظام (الافتراضي من الخيارات)' }
const methodField: ImportField = { key: 'method', label: 'طريقة الدفع', kind: 'paymentMethod', synonyms: ['الطريقة', 'payment method', 'method'], hint: 'نقدي، تحويل بنكي، بطاقة، إلكتروني (الافتراضي نقدي)' }
const oldNumberField: ImportField = { key: 'oldNumber', label: 'الرقم القديم', kind: 'text', synonyms: ['رقم السند', 'رقم السند القديم', 'old number', 'reference', 'المرجع'] }

function resolveCash(out: ValidatedRow, env: ImportEnv) {
  const name = v(out, 'cashAccount')
  const ca = findCashAccount(env.lookups, name, env.options.cashAccountId)
  if (!ca) return fail(out, name ? `الصندوق «${name}» غير موجود` : 'اختر الصندوق الافتراضي من الخيارات')
  out.values.cashAccountId = ca.id
  if (v(out, 'method') === 'CHEQUE') return fail(out, 'الشيكات تُسجل من شاشة السندات مع بياناتها')
  return out
}

export const receiptsImport: ImportTypeDef = {
  key: 'receipts',
  label: 'سندات القبض',
  description: 'دفعات الطلاب: كل سند يُوزع تلقائيًا على أقدم مستحقات الطالب، والزائد رصيد دائن له.',
  permissions: ['receipts.create'],
  needsCashAccount: true,
  fields: [
    { key: 'date', label: 'التاريخ', kind: 'date', required: true, synonyms: ['date', 'تاريخ السند'], example: '15/09/2026' },
    studentField,
    { key: 'amount', label: 'المبلغ', kind: 'amount', required: true, synonyms: ['amount', 'القيمة', 'المدفوع'], example: 1000 },
    methodField,
    oldNumberField,
    { key: 'description', label: 'البيان', kind: 'text', synonyms: ['description', 'الوصف'] },
    cashField,
  ],
  async validate(rows, env) {
    const olds = await db.receipt.findMany({ where: { referenceNumber: { not: null } }, select: { referenceNumber: true } })
    const existing = new Set(olds.map((o) => o.referenceNumber!))
    const seen = new Map<string, number>()
    return rows.map((r) => {
      const out = base(r)
      if (out.status === 'error') return out
      if (resolveStudent(out, env).status === 'error' || resolveCash(out, env).status === 'error' || dateInOpenYear(out, env).status === 'error') return out
      const old = v(out, 'oldNumber')
      if (old) {
        if (seen.has(old)) {
          out.status = 'duplicate'
          out.messages.push(`الرقم القديم مكرر في الملف (الصف ${seen.get(old)})`)
          return out
        }
        seen.set(old, r.rowNumber)
        if (existing.has(old)) {
          out.status = 'duplicate'
          out.messages.push(`سند بالرقم القديم ${old} مستورد مسبقًا`)
        }
      }
      return out
    })
  },
  async commit(tx, ctx, rows, env) {
    const res: CommitResult = { created: 0, updated: 0, skipped: 0, notes: [] }
    for (const r of rows) {
      if (r.status !== 'valid') {
        res.skipped++
        continue
      }
      await atRow(r.rowNumber, () => createStudentReceipt(tx, ctx, {
        kind: 'STUDENT',
        studentId: Number(r.values.studentId),
        date: String(r.values.date),
        amount: String(r.values.amount),
        paymentMethod: (v(r, 'method') as 'CASH') ?? 'CASH',
        cashAccountId: Number(r.values.cashAccountId),
        referenceNumber: v(r, 'oldNumber'),
        description: v(r, 'description'),
        confirmCredit: true,
        importBatchId: env.batchId,
      }))
      res.created++
    }
    return res
  },
}

// ---------------------------------------------------------------------
// المصروفات وسندات الصرف
// ---------------------------------------------------------------------

async function validateSpending(rows: NormalizedRow[], env: ImportEnv, withOldNumber: boolean): Promise<ValidatedRow[]> {
  const olds = withOldNumber ? await db.paymentVoucher.findMany({ where: { referenceNumber: { not: null } }, select: { referenceNumber: true } }) : []
  const existing = new Set(olds.map((o) => o.referenceNumber!))
  const seen = new Map<string, number>()
  const balances = await accountsTotals(db, env.lookups.cashAccounts.map((c) => c.glAccountId))
  const running = new Map(env.lookups.cashAccounts.map((c) => [c.id, balances.get(c.glAccountId)?.net ?? D(0)]))
  return rows.map((r) => {
    const out = base(r)
    if (out.status === 'error') return out
    const cat = findExpenseAccount(env.lookups, String(out.values.category))
    if (!cat) return fail(out, `تصنيف المصروف «${out.values.category}» غير موجود — أضفه من صفحة المصروفات`)
    out.values.expenseAccountId = cat.id
    if (resolveCash(out, env).status === 'error' || dateInOpenYear(out, env).status === 'error') return out
    const old = withOldNumber ? v(out, 'oldNumber') : null
    if (old) {
      if (seen.has(old)) {
        out.status = 'duplicate'
        out.messages.push(`الرقم القديم مكرر في الملف (الصف ${seen.get(old)})`)
        return out
      }
      seen.set(old, r.rowNumber)
      if (existing.has(old)) {
        out.status = 'duplicate'
        out.messages.push(`سند بالرقم القديم ${old} مستورد مسبقًا`)
        return out
      }
    }
    if (!env.settings.finance.allowNegativeCash) {
      const id = Number(out.values.cashAccountId)
      const left = running.get(id)!.minus(D(String(out.values.amount)))
      if (left.isNegative()) return fail(out, 'رصيد الصندوق لا يكفي لهذا المبلغ (مع الصفوف السابقة في الملف)')
      running.set(id, left)
    }
    return out
  })
}

async function commitSpending(tx: Parameters<ImportTypeDef['commit']>[0], ctx: Parameters<ImportTypeDef['commit']>[1], rows: ValidatedRow[], env: ImportEnv & { batchId: number }) {
  const res: CommitResult = { created: 0, updated: 0, skipped: 0, notes: [] }
  for (const r of rows) {
    if (r.status !== 'valid') {
      res.skipped++
      continue
    }
    const category = env.lookups.expenseAccounts.find((a) => a.id === Number(r.values.expenseAccountId))
    await atRow(r.rowNumber, () => createVoucher(tx, ctx, {
      kind: 'EXPENSE',
      date: String(r.values.date),
      amount: String(r.values.amount),
      paymentMethod: (v(r, 'method') as 'CASH') ?? 'CASH',
      cashAccountId: Number(r.values.cashAccountId),
      expenseAccountId: Number(r.values.expenseAccountId),
      payeeName: v(r, 'payee') ?? v(r, 'description') ?? category?.name ?? 'مصروف مستورد',
      description: v(r, 'description'),
      referenceNumber: v(r, 'oldNumber'),
      importBatchId: env.batchId,
    }))
    res.created++
  }
  return res
}

const categoryField: ImportField = { key: 'category', label: 'التصنيف', kind: 'text', required: true, synonyms: ['نوع المصروف', 'البند', 'category', 'expense type'], example: 'الكهرباء' }

export const expensesImport: ImportTypeDef = {
  key: 'expenses',
  label: 'المصروفات',
  description: 'كل صف يصبح سند صرف من نوع «مصروف» على التصنيف المحدد، ويُخصم من الصندوق.',
  permissions: ['vouchers.create'],
  needsCashAccount: true,
  fields: [
    { key: 'date', label: 'التاريخ', kind: 'date', required: true, synonyms: ['date'], example: '20/09/2026' },
    categoryField,
    { key: 'amount', label: 'المبلغ', kind: 'amount', required: true, synonyms: ['amount', 'القيمة'], example: 350 },
    { key: 'payee', label: 'المستفيد', kind: 'text', synonyms: ['الجهة', 'payee', 'اسم المستفيد'] },
    { key: 'description', label: 'البيان', kind: 'text', synonyms: ['description', 'الوصف'] },
    methodField,
    cashField,
  ],
  validate: (rows, env) => validateSpending(rows, env, false),
  commit: commitSpending,
}

export const vouchersImport: ImportTypeDef = {
  key: 'vouchers',
  label: 'سندات الصرف',
  description: 'سندات صرف من النظام السابق مع أرقامها القديمة (تُحفظ كمرجع) على تصنيفات المصروفات.',
  permissions: ['vouchers.create'],
  needsCashAccount: true,
  fields: [
    { key: 'date', label: 'التاريخ', kind: 'date', required: true, synonyms: ['date'], example: '20/09/2026' },
    { key: 'payee', label: 'المستفيد', kind: 'text', required: true, synonyms: ['الجهة', 'payee', 'اسم المستفيد'], example: 'شركة الكهرباء' },
    categoryField,
    { key: 'amount', label: 'المبلغ', kind: 'amount', required: true, synonyms: ['amount', 'القيمة'], example: 350 },
    methodField,
    oldNumberField,
    { key: 'description', label: 'البيان', kind: 'text', synonyms: ['description', 'الوصف'] },
    cashField,
  ],
  validate: (rows, env) => validateSpending(rows, env, true),
  commit: commitSpending,
}

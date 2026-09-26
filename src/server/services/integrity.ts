import 'server-only'
import type { DbOrTx } from '../db'
import { accountIdByKey } from '../ledger/accounts'
import { getSettings } from '../settings'
import { D } from '@/lib/money'

/**
 * فحص سلامة البيانات (docs/13-accounting.md §13.5): مطابقة الأرصدة المخزنة
 * والمستندات مع الأستاذ العام. للقراءة فقط؛ لا يصلح شيئًا تلقائيًا.
 */

export interface IntegrityIssue {
  label: string
  expected?: string
  actual?: string
  href?: string
}

export interface IntegrityCheck {
  key: string
  title: string
  description: string
  ok: boolean
  /** عدد المخالفات الكلي (قد يُعرض جزء منها فقط) */
  count: number
  issues: IntegrityIssue[]
}

const LIMIT = 20
const dec = (v: unknown) => D(String(v ?? 0))
const fmt = (v: unknown) => dec(v).toFixed(3)

function check(key: string, title: string, description: string, rows: IntegrityIssue[]): IntegrityCheck {
  return { key, title, description, ok: rows.length === 0, count: rows.length, issues: rows.slice(0, LIMIT) }
}

export async function runIntegrityChecks(client: DbOrTx): Promise<IntegrityCheck[]> {
  const [ar, ap, apc, sal, adv, cashGroup, bankGroup] = await Promise.all([
    accountIdByKey(client, 'AR_STUDENTS'),
    accountIdByKey(client, 'AP_SUPPLIERS'),
    accountIdByKey(client, 'AP_CONTRACTORS'),
    accountIdByKey(client, 'SALARIES_PAYABLE'),
    accountIdByKey(client, 'EMPLOYEE_ADVANCES'),
    accountIdByKey(client, 'CASH_GROUP'),
    accountIdByKey(client, 'BANK_GROUP'),
  ])
  const settings = await getSettings(client)

  const [
    unbalanced,
    totals,
    arNoStudent,
    students,
    charges,
    installments,
    receipts,
    employeesSal,
    salaryPaid,
    earlySalary,
    employeesAdv,
    suppliers,
    contractors,
    jobs,
    cash,
    numbering,
  ] = await Promise.all([
    client.$queryRaw<{ id: number; number: string; d: string; c: string }[]>`
      SELECT je."id", je."number", SUM(jl."debit")::text AS d, SUM(jl."credit")::text AS c
      FROM "journal_entries" je JOIN "journal_lines" jl ON jl."entryId" = je."id"
      GROUP BY je."id" HAVING SUM(jl."debit") <> SUM(jl."credit") ORDER BY je."id" LIMIT 100`,
    client.$queryRaw<{ d: string; c: string }[]>`SELECT COALESCE(SUM("debit"), 0)::text AS d, COALESCE(SUM("credit"), 0)::text AS c FROM "journal_lines"`,
    client.$queryRaw<{ cnt: number }[]>`SELECT COUNT(*)::int AS cnt FROM "journal_lines" WHERE "accountId" = ${ar} AND "studentId" IS NULL`,
    // رصيد الطالب في 1130 = (صافي الذمم الفعالة − المدفوع منها) − الرصيد الدائن غير المستخدم
    client.$queryRaw<{ id: number; name: string; ledger: string; docs: string }[]>`
      WITH l AS (SELECT "studentId" AS sid, SUM("debit" - "credit") AS bal FROM "journal_lines" WHERE "accountId" = ${ar} AND "studentId" IS NOT NULL GROUP BY 1),
           d AS (SELECT "studentId" AS sid, SUM("netAmount" - "paidAmount") AS due FROM "charges" WHERE "status" = 'ACTIVE' GROUP BY 1),
           cr AS (SELECT pa."studentId" AS sid, SUM(pa."amount") AS credit FROM "payment_allocations" pa JOIN "receipts" r ON r."id" = pa."receiptId"
                  WHERE r."status" = 'ACTIVE' AND pa."installmentId" IS NULL AND pa."refundVoucherId" IS NULL GROUP BY 1)
      SELECT s."id", s."fullName" AS name, COALESCE(l.bal, 0)::text AS ledger, (COALESCE(d.due, 0) - COALESCE(cr.credit, 0))::text AS docs
      FROM "students" s LEFT JOIN l ON l.sid = s."id" LEFT JOIN d ON d.sid = s."id" LEFT JOIN cr ON cr.sid = s."id"
      WHERE COALESCE(l.bal, 0) <> COALESCE(d.due, 0) - COALESCE(cr.credit, 0)
      ORDER BY s."id" LIMIT 100`,
    // الذمة: مجموع الأقساط = الصافي، والمدفوع = مجموع مدفوع الأقساط
    client.$queryRaw<{ id: number; net: string; inst: string; paid: string; ipaid: string }[]>`
      SELECT c."id", c."netAmount"::text AS net, COALESCE(SUM(i."amount"), 0)::text AS inst, c."paidAmount"::text AS paid, COALESCE(SUM(i."paidAmount"), 0)::text AS ipaid
      FROM "charges" c LEFT JOIN "installments" i ON i."chargeId" = c."id" AND i."status" <> 'CANCELLED'
      WHERE c."status" = 'ACTIVE'
      GROUP BY c."id" HAVING c."netAmount" <> COALESCE(SUM(i."amount"), 0) OR c."paidAmount" <> COALESCE(SUM(i."paidAmount"), 0)
      ORDER BY c."id" LIMIT 100`,
    // القسط: المدفوع = مجموع التوزيعات من سندات فعالة
    client.$queryRaw<{ id: number; chargeId: number; paid: string; alloc: string }[]>`
      SELECT i."id", i."chargeId" AS "chargeId", i."paidAmount"::text AS paid, COALESCE(SUM(pa."amount") FILTER (WHERE r."status" = 'ACTIVE'), 0)::text AS alloc
      FROM "installments" i LEFT JOIN "payment_allocations" pa ON pa."installmentId" = i."id" LEFT JOIN "receipts" r ON r."id" = pa."receiptId"
      WHERE i."status" <> 'CANCELLED'
      GROUP BY i."id" HAVING i."paidAmount" <> COALESCE(SUM(pa."amount") FILTER (WHERE r."status" = 'ACTIVE'), 0)
      ORDER BY i."id" LIMIT 100`,
    // سند القبض: مجموع توزيعاته = مبلغه
    client.$queryRaw<{ id: number; number: string; amount: string; alloc: string }[]>`
      SELECT r."id", r."number", r."amount"::text AS amount, COALESCE(SUM(pa."amount"), 0)::text AS alloc
      FROM "receipts" r LEFT JOIN "payment_allocations" pa ON pa."receiptId" = r."id"
      WHERE r."status" = 'ACTIVE' AND r."kind" IN ('STUDENT', 'FAMILY', 'OPENING_CREDIT')
      GROUP BY r."id" HAVING r."amount" <> COALESCE(SUM(pa."amount"), 0)
      ORDER BY r."id" LIMIT 100`,
    // الموظف: رصيد 2130 = صافي الرواتب المعتمدة − المصروف
    client.$queryRaw<{ id: number; name: string; ledger: string; docs: string }[]>`
      WITH l AS (SELECT "employeeId" AS eid, SUM("credit" - "debit") AS bal FROM "journal_lines" WHERE "accountId" = ${sal} AND "employeeId" IS NOT NULL GROUP BY 1),
           d AS (SELECT pi."employeeId" AS eid, SUM(pi."netPay" - pi."paidAmount") AS due FROM "payroll_items" pi JOIN "payroll_runs" pr ON pr."id" = pi."payrollRunId" WHERE pr."status" = 'APPROVED' GROUP BY 1)
      SELECT e."id", e."fullName" AS name, COALESCE(l.bal, 0)::text AS ledger, COALESCE(d.due, 0)::text AS docs
      FROM "employees" e LEFT JOIN l ON l.eid = e."id" LEFT JOIN d ON d.eid = e."id"
      WHERE COALESCE(l.bal, 0) <> COALESCE(d.due, 0) ORDER BY e."id" LIMIT 100`,
    // بند الراتب: المصروف = مجموع سندات الصرف الفعالة له
    client.$queryRaw<{ id: number; runId: number; paid: string; vouchers: string }[]>`
      SELECT pi."id", pi."payrollRunId" AS "runId", pi."paidAmount"::text AS paid, COALESCE(SUM(v."amount") FILTER (WHERE v."status" = 'ACTIVE'), 0)::text AS vouchers
      FROM "payroll_items" pi LEFT JOIN "payment_vouchers" v ON v."payrollItemId" = pi."id"
      GROUP BY pi."id" HAVING pi."paidAmount" <> COALESCE(SUM(v."amount") FILTER (WHERE v."status" = 'ACTIVE'), 0)
      ORDER BY pi."id" LIMIT 100`,
    // سند صرف الراتب لا يسبق تاريخ قيد استحقاق الرواتب (وإلا تظهر الرواتب المستحقة سالبة في الفترة بينهما)
    client.$queryRaw<{ id: number; number: string; date: Date; posting: Date }[]>`
      SELECT v."id", v."number", v."date", pr."postingDate" AS posting
      FROM "payment_vouchers" v JOIN "payroll_items" pi ON pi."id" = v."payrollItemId" JOIN "payroll_runs" pr ON pr."id" = pi."payrollRunId"
      WHERE v."status" = 'ACTIVE' AND pr."status" = 'APPROVED' AND v."date" < pr."postingDate"
      ORDER BY v."id" LIMIT 100`,
    // الموظف: رصيد 1150 = السلف المصروفة − الأقساط المخصومة
    client.$queryRaw<{ id: number; name: string; ledger: string; docs: string }[]>`
      WITH l AS (SELECT "employeeId" AS eid, SUM("debit" - "credit") AS bal FROM "journal_lines" WHERE "accountId" = ${adv} AND "employeeId" IS NOT NULL GROUP BY 1),
           d AS (SELECT a."employeeId" AS eid, SUM(a."amount" - a."deductedAmount") AS due FROM "employee_advances" a JOIN "payment_vouchers" v ON v."advanceId" = a."id" AND v."status" = 'ACTIVE' GROUP BY 1)
      SELECT e."id", e."fullName" AS name, COALESCE(l.bal, 0)::text AS ledger, COALESCE(d.due, 0)::text AS docs
      FROM "employees" e LEFT JOIN l ON l.eid = e."id" LEFT JOIN d ON d.eid = e."id"
      WHERE COALESCE(l.bal, 0) <> COALESCE(d.due, 0) ORDER BY e."id" LIMIT 100`,
    // المورد: رصيد 2110 = الفواتير − الدفعات
    client.$queryRaw<{ id: number; name: string; ledger: string; docs: string }[]>`
      WITH l AS (SELECT "supplierId" AS sid, SUM("credit" - "debit") AS bal FROM "journal_lines" WHERE "accountId" = ${ap} AND "supplierId" IS NOT NULL GROUP BY 1),
           b AS (SELECT "supplierId" AS sid, SUM("amount") AS t FROM "supplier_bills" WHERE "status" = 'ACTIVE' GROUP BY 1),
           p AS (SELECT "supplierId" AS sid, SUM("amount") AS t FROM "payment_vouchers" WHERE "status" = 'ACTIVE' AND "kind" = 'SUPPLIER_PAYMENT' GROUP BY 1)
      SELECT s."id", s."name", COALESCE(l.bal, 0)::text AS ledger, (COALESCE(b.t, 0) - COALESCE(p.t, 0))::text AS docs
      FROM "suppliers" s LEFT JOIN l ON l.sid = s."id" LEFT JOIN b ON b.sid = s."id" LEFT JOIN p ON p.sid = s."id"
      WHERE COALESCE(l.bal, 0) <> COALESCE(b.t, 0) - COALESCE(p.t, 0) ORDER BY s."id" LIMIT 100`,
    // المقاول: رصيد 2120 = قيم الاتفاقات − الدفعات
    client.$queryRaw<{ id: number; name: string; ledger: string; docs: string }[]>`
      WITH l AS (SELECT "contractorId" AS cid, SUM("credit" - "debit") AS bal FROM "journal_lines" WHERE "accountId" = ${apc} AND "contractorId" IS NOT NULL GROUP BY 1),
           -- العمل الملغى يبقى بقيمة الجزء المدفوع منه (يُلغى غير المدفوع فقط)
           j AS (SELECT "contractorId" AS cid, SUM("agreedAmount") AS t FROM "contractor_jobs" GROUP BY 1),
           p AS (SELECT "contractorId" AS cid, SUM("amount") AS t FROM "payment_vouchers" WHERE "status" = 'ACTIVE' AND "kind" = 'CONTRACTOR_PAYMENT' GROUP BY 1)
      SELECT c."id", c."name", COALESCE(l.bal, 0)::text AS ledger, (COALESCE(j.t, 0) - COALESCE(p.t, 0))::text AS docs
      FROM "contractors" c LEFT JOIN l ON l.cid = c."id" LEFT JOIN j ON j.cid = c."id" LEFT JOIN p ON p.cid = c."id"
      WHERE COALESCE(l.bal, 0) <> COALESCE(j.t, 0) - COALESCE(p.t, 0) ORDER BY c."id" LIMIT 100`,
    // العمل: المدفوع = مجموع الدفعات الفعالة
    client.$queryRaw<{ id: number; paid: string; vouchers: string }[]>`
      SELECT j."id", j."paidAmount"::text AS paid, COALESCE(SUM(v."amount") FILTER (WHERE v."status" = 'ACTIVE'), 0)::text AS vouchers
      FROM "contractor_jobs" j LEFT JOIN "payment_vouchers" v ON v."contractorJobId" = j."id"
      GROUP BY j."id" HAVING j."paidAmount" <> COALESCE(SUM(v."amount") FILTER (WHERE v."status" = 'ACTIVE'), 0)
      ORDER BY j."id" LIMIT 100`,
    // الصناديق: الحساب المرتبط موجود تحت مجموعة النقدية، والرصيد غير سالب (إن لم يُسمح بالسالب)
    client.$queryRaw<{ id: number; name: string; parentId: number | null; balance: string }[]>`
      SELECT ca."id", ca."name", a."parentId" AS "parentId", COALESCE(SUM(jl."debit" - jl."credit"), 0)::text AS balance
      FROM "cash_accounts" ca JOIN "accounts" a ON a."id" = ca."glAccountId" LEFT JOIN "journal_lines" jl ON jl."accountId" = ca."glAccountId"
      GROUP BY ca."id", a."parentId" ORDER BY ca."id"`,
    // تسلسل الأرقام بلا فجوات لكل نوع وسنة
    client.$queryRaw<{ doc: string; year: string; cnt: number; mx: number }[]>`
      SELECT doc, year, COUNT(*)::int AS cnt, MAX(seq)::int AS mx FROM (
        SELECT CASE WHEN "kind" = 'OPENING_CREDIT' THEN 'opening' ELSE 'receipt' END AS doc, (regexp_match("number", '(\\d{4})-(\\d+)$'))[1] AS year, ((regexp_match("number", '(\\d{4})-(\\d+)$'))[2])::int AS seq FROM "receipts"
        UNION ALL SELECT 'voucher', (regexp_match("number", '(\\d{4})-(\\d+)$'))[1], ((regexp_match("number", '(\\d{4})-(\\d+)$'))[2])::int FROM "payment_vouchers"
        UNION ALL SELECT 'journal', (regexp_match("number", '(\\d{4})-(\\d+)$'))[1], ((regexp_match("number", '(\\d{4})-(\\d+)$'))[2])::int FROM "journal_entries"
      ) t WHERE year IS NOT NULL GROUP BY doc, year ORDER BY doc, year`,
  ])

  const docLabel: Record<string, string> = { receipt: 'سندات القبض', opening: 'الأرصدة الدائنة الافتتاحية', voucher: 'سندات الصرف', journal: 'القيود' }
  const checks: IntegrityCheck[] = [
    check(
      'balanced',
      'توازن القيود',
      'كل قيد: مجموع المدين = مجموع الدائن.',
      unbalanced.map((u) => ({ label: `القيد ${u.number}`, expected: fmt(u.d), actual: fmt(u.c), href: `/accounting/journal/${u.id}` })),
    ),
    check(
      'trial',
      'ميزان المراجعة',
      'مجموع كل الأطراف المدينة = مجموع الأطراف الدائنة.',
      dec(totals[0]?.d).equals(dec(totals[0]?.c)) ? [] : [{ label: 'إجمالي الأستاذ', expected: fmt(totals[0]?.d), actual: fmt(totals[0]?.c) }],
    ),
    check(
      'students',
      'أرصدة الطلاب',
      'رصيد كل طالب في ذمم الطلاب = الذمم الفعالة − المدفوع − الخصومات − الرصيد الدائن.',
      [
        ...(arNoStudent[0]?.cnt ? [{ label: `${arNoStudent[0].cnt} طرف قيد على ذمم الطلاب بدون طالب` }] : []),
        ...students.map((s) => ({ label: s.name, expected: fmt(s.docs), actual: fmt(s.ledger), href: `/students/${s.id}` })),
      ],
    ),
    check(
      'charges',
      'الذمم والأقساط',
      'مجموع أقساط كل ذمة = صافيها، ومدفوع الذمة = مجموع مدفوع أقساطها، ومدفوع القسط = توزيعات السندات الفعالة عليه.',
      [
        ...charges.map((c) => ({ label: `ذمة رقم ${c.id}`, expected: `${fmt(c.net)} / ${fmt(c.paid)}`, actual: `${fmt(c.inst)} / ${fmt(c.ipaid)}`, href: `/charges/${c.id}` })),
        ...installments.map((i) => ({ label: `قسط رقم ${i.id}`, expected: fmt(i.alloc), actual: fmt(i.paid), href: `/charges/${i.chargeId}` })),
      ],
    ),
    check(
      'receipts',
      'توزيع سندات القبض',
      'مجموع توزيعات كل سند قبض (على الأقساط والرصيد الدائن) = مبلغ السند.',
      receipts.map((r) => ({ label: `سند ${r.number}`, expected: fmt(r.amount), actual: fmt(r.alloc), href: `/receipts/${r.id}` })),
    ),
    check(
      'salaries',
      'الرواتب المستحقة',
      'رصيد كل موظف في الرواتب المستحقة = صافي رواتبه المعتمدة − المصروف له، ومصروف كل بند = سنداته الفعالة، ولا يُصرف راتب بتاريخ يسبق قيد استحقاقه.',
      [
        ...employeesSal.map((e) => ({ label: e.name, expected: fmt(e.docs), actual: fmt(e.ledger), href: `/employees/${e.id}` })),
        ...salaryPaid.map((p) => ({ label: `بند راتب رقم ${p.id}`, expected: fmt(p.vouchers), actual: fmt(p.paid), href: `/payroll/${p.runId}` })),
        ...earlySalary.map((v) => ({
          label: `سند ${v.number} مؤرخ قبل قيد استحقاق الرواتب`,
          expected: `≥ ${v.posting.toISOString().slice(0, 10)}`,
          actual: v.date.toISOString().slice(0, 10),
          href: `/vouchers/${v.id}`,
        })),
      ],
    ),
    check(
      'advances',
      'سلف الموظفين',
      'رصيد كل موظف في السلف = السلف المصروفة − الأقساط المخصومة من الرواتب المعتمدة.',
      employeesAdv.map((e) => ({ label: e.name, expected: fmt(e.docs), actual: fmt(e.ledger), href: `/employees/${e.id}` })),
    ),
    check(
      'suppliers',
      'أرصدة الموردين',
      'رصيد كل مورد = فواتيره الفعالة − الدفعات له.',
      suppliers.map((s) => ({ label: s.name, expected: fmt(s.docs), actual: fmt(s.ledger), href: `/suppliers/${s.id}` })),
    ),
    check(
      'contractors',
      'أرصدة المقاولين',
      'رصيد كل مقاول = قيم اتفاقاته − الدفعات له، ومدفوع كل اتفاق = دفعاته الفعالة.',
      [
        ...contractors.map((c) => ({ label: c.name, expected: fmt(c.docs), actual: fmt(c.ledger), href: `/contractors/${c.id}` })),
        ...jobs.map((j) => ({ label: `اتفاق رقم ${j.id}`, expected: fmt(j.vouchers), actual: fmt(j.paid), href: `/contractors/jobs/${j.id}` })),
      ],
    ),
    check(
      'cash',
      'الصناديق والبنوك',
      `كل صندوق/بنك مرتبط بحساب تحت مجموعة النقدية${settings.finance.allowNegativeCash ? '' : '، ورصيده غير سالب'}.`,
      cash
        .filter((c) => (c.parentId !== cashGroup && c.parentId !== bankGroup) || (!settings.finance.allowNegativeCash && dec(c.balance).isNegative()))
        .map((c) => ({ label: c.name, expected: '≥ 0', actual: fmt(c.balance), href: `/treasury/${c.id}` })),
    ),
    check(
      'numbering',
      'تسلسل أرقام المستندات',
      'أرقام السندات والقيود متسلسلة بلا فجوات لكل سنة (المستندات الملغاة تبقى بأرقامها).',
      numbering.filter((n) => n.cnt !== n.mx).map((n) => ({ label: `${docLabel[n.doc] ?? n.doc} ${n.year}`, expected: `${n.mx} رقم`, actual: `${n.cnt} مستند` })),
    ),
  ]
  return checks
}

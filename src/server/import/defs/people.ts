import 'server-only'
import { createStudent } from '../../services/students'
import { createEmployee, updateEmployee } from '../../services/employees'
import { saveSupplier, createSupplierBill } from '../../services/parties'
import { audit } from '../../audit'
import { nameKey } from '@/lib/import-normalize'
import { fromDateOnly } from '@/lib/dates'
import { D } from '@/lib/money'
import { matchGrade, type LGrade } from '../lookups'
import type { CommitResult, ImportTypeDef, NormalizedRow, ValidatedRow } from '../types'
import { atRow } from '../row'

/** استيراد الطلاب، الموظفين/المعلمات، والموردين. */

const v = <T = string>(r: { values: Record<string, unknown> }, k: string) => (r.values[k] ?? null) as T | null

function base(r: NormalizedRow): ValidatedRow {
  return { rowNumber: r.rowNumber, status: r.errors.length ? 'error' : 'valid', messages: [...r.errors], values: { ...r.values } }
}

const phoneTail = (p: string | null) => (p ?? '').replace(/\D/g, '').slice(-9)

// ---------------------------------------------------------------------
// الطلاب
// ---------------------------------------------------------------------

export const studentsImport: ImportTypeDef = {
  key: 'students',
  label: 'الطلاب',
  description: 'طالب + ولي أمر (أو ربطه بولي أمر موجود بنفس الهاتف) + تسجيله في السنة المختارة.',
  permissions: ['students.create'],
  supportsUpdate: true,
  supportsCreateMissing: true,
  needsYear: true,
  fields: [
    { key: 'fullName', label: 'اسم الطالب', kind: 'text', required: true, synonyms: ['الاسم', 'اسم الطالب الكامل', 'الطالب', 'student name', 'name', 'student'], example: 'محمد أحمد علي' },
    { key: 'grade', label: 'الصف', kind: 'text', required: true, synonyms: ['الصف الدراسي', 'grade', 'class', 'المستوى'], example: 'الصف الخامس', hint: 'اسم الصف كما في النظام، أو رقمه (5)، أو «خامس»' },
    { key: 'section', label: 'الشعبة', kind: 'text', synonyms: ['section', 'شعبة', 'الفصل'], example: 'أ' },
    { key: 'guardianName', label: 'اسم ولي الأمر', kind: 'text', required: true, synonyms: ['ولي الأمر', 'اسم الأب', 'الأب', 'guardian', 'parent', 'parent name', 'father'], example: 'أحمد علي' },
    { key: 'guardianPhone', label: 'هاتف ولي الأمر', kind: 'phone', required: true, synonyms: ['الهاتف', 'رقم الهاتف', 'الجوال', 'رقم الجوال', 'هاتف', 'phone', 'mobile'], example: '0599123456' },
    { key: 'phone2', label: 'هاتف 2', kind: 'phone', synonyms: ['هاتف آخر', 'هاتف اخر', 'هاتف الأم', 'phone 2', 'phone2'] },
    { key: 'schoolNumber', label: 'الرقم المدرسي', kind: 'text', synonyms: ['رقم مدرسي', 'school number', 'school no'] },
    { key: 'studentNumber', label: 'رقم الطالب', kind: 'text', synonyms: ['student number', 'student id', 'الرقم'], hint: 'اتركه فارغًا ليُرقّم تلقائيًا' },
    { key: 'gender', label: 'الجنس', kind: 'gender', synonyms: ['gender', 'sex', 'النوع'], example: 'ذكر' },
    { key: 'birthDate', label: 'تاريخ الميلاد', kind: 'date', synonyms: ['الميلاد', 'birth date', 'dob', 'date of birth'], example: '15/03/2015' },
    { key: 'nationalId', label: 'الرقم الوطني', kind: 'text', synonyms: ['رقم الهوية', 'الهوية', 'national id', 'id number'] },
    { key: 'address', label: 'العنوان', kind: 'text', synonyms: ['address', 'السكن', 'مكان السكن'] },
    { key: 'status', label: 'الحالة', kind: 'studentStatus', synonyms: ['status', 'حالة الطالب'], hint: 'فعال، منسحب، متخرج، موقوف (الافتراضي فعال)' },
    { key: 'notes', label: 'ملاحظات', kind: 'text', synonyms: ['notes', 'ملاحظة', 'remarks'] },
  ],
  instructions: [
    'الإخوة يُربطون تلقائيًا بنفس ولي الأمر إذا تطابق رقم الهاتف.',
    'الطالب المكرر = نفس الرقم المدرسي، أو نفس الاسم ونفس هاتف ولي الأمر.',
  ],
  async validate(rows, env) {
    const l = env.lookups
    const seen = new Map<string, number>()
    const seenSchool = new Map<string, number>()
    const seenNumber = new Map<string, number>()
    return rows.map((r) => {
      const out = base(r)
      const name = v(r, 'fullName')
      const phone = v(r, 'guardianPhone')
      const gradeName = v(r, 'grade')
      if (gradeName) {
        const g = matchGrade(l, gradeName)
        if (g) {
          out.values.gradeId = g.id
          const section = v(r, 'section')
          if (section) {
            const s = g.sections.find((x) => x.key === nameKey(section))
            if (s) out.values.sectionId = s.id
            else if (env.options.createMissing) out.messages.push(`ستُنشأ الشعبة «${section}» في ${g.name}`)
            else {
              out.status = 'error'
              out.messages.push(`الشعبة «${section}» غير موجودة في ${g.name}`)
            }
          }
        } else if (env.options.createMissing) out.messages.push(`سيُنشأ صف جديد باسم «${gradeName}»`)
        else {
          out.status = 'error'
          out.messages.push(`الصف «${gradeName}» غير موجود`)
        }
      }
      if (out.status === 'error' || !name) return out
      // التكرار داخل الملف
      const key = `${nameKey(name)}|${phoneTail(phone)}`
      if (seen.has(key)) {
        out.status = 'duplicate'
        out.messages.push(`مكرر داخل الملف (نفس الطالب في الصف ${seen.get(key)})`)
        return out
      }
      seen.set(key, r.rowNumber)
      const school = v(r, 'schoolNumber')
      if (school) {
        if (seenSchool.has(school)) {
          out.status = 'error'
          out.messages.push(`الرقم المدرسي مكرر في الملف (الصف ${seenSchool.get(school)})`)
          return out
        }
        seenSchool.set(school, r.rowNumber)
      }
      const number = v(r, 'studentNumber')
      if (number) {
        if (seenNumber.has(number)) {
          out.status = 'error'
          out.messages.push(`رقم الطالب مكرر في الملف (الصف ${seenNumber.get(number)})`)
          return out
        }
        seenNumber.set(number, r.rowNumber)
      }
      // التكرار مع النظام
      const existing =
        (school ? l.bySchoolNumber.get(school) : undefined) ??
        (l.byStudentName.get(nameKey(name)) ?? []).find((s) => phone && s.phones.includes(phoneTail(phone)))
      if (existing) {
        out.status = 'duplicate'
        out.existingId = existing.id
        out.messages.push(`موجود مسبقًا: ${existing.fullName} (رقم ${existing.studentNumber})`)
        return out
      }
      if (number && l.byStudentNumber.has(number)) {
        out.status = 'error'
        out.messages.push(`رقم الطالب ${number} مستخدم للطالب ${l.byStudentNumber.get(number)!.fullName}`)
      }
      return out
    })
  },
  async commit(tx, ctx, rows, env) {
    const res: CommitResult = { created: 0, updated: 0, skipped: 0, notes: [] }
    const yearId = env.options.yearId!
    const gradeCache = new Map<string, LGrade>()
    const resolveGrade = async (name: string) => {
      const found = matchGrade(env.lookups, name) ?? gradeCache.get(nameKey(name))
      if (found) return found
      const created = await tx.grade.create({ data: { name: name.trim(), sortOrder: 100 + gradeCache.size } })
      const g: LGrade = { id: created.id, name: created.name, key: nameKey(created.name), sortOrder: created.sortOrder, sections: [] }
      gradeCache.set(g.key, g)
      env.lookups.grades.push(g)
      res.notes.push(`أُنشئ صف جديد: ${created.name}`)
      return g
    }
    const resolveSection = async (g: LGrade, name: string | null) => {
      if (!name) return null
      const s = g.sections.find((x) => x.key === nameKey(name))
      if (s) return s.id
      const created = await tx.section.create({ data: { gradeId: g.id, name: name.trim() } })
      g.sections.push({ id: created.id, name: created.name, key: nameKey(created.name) })
      res.notes.push(`أُنشئت شعبة جديدة: ${g.name} - ${created.name}`)
      return created.id
    }
    for (const r of rows) {
      if (r.status === 'duplicate' && (env.options.duplicates !== 'update' || !r.existingId)) {
        res.skipped++
        continue
      }
      const g = await resolveGrade(String(r.values.grade))
      const sectionId = await resolveSection(g, v(r, 'section'))
      if (r.status === 'duplicate' && r.existingId) {
        const before = await tx.student.findUniqueOrThrow({ where: { id: r.existingId } })
        const data = {
          ...(v(r, 'schoolNumber') ? { schoolNumber: v(r, 'schoolNumber') } : {}),
          ...(v(r, 'gender') ? { gender: v<'MALE' | 'FEMALE'>(r, 'gender') } : {}),
          ...(v(r, 'birthDate') ? { birthDate: fromDateOnly(String(r.values.birthDate)) } : {}),
          ...(v(r, 'nationalId') ? { nationalId: v(r, 'nationalId') } : {}),
          ...(v(r, 'address') ? { address: v(r, 'address') } : {}),
          ...(v(r, 'notes') ? { notes: v(r, 'notes') } : {}),
        }
        const after = await tx.student.update({ where: { id: before.id }, data })
        await tx.enrollment.upsert({
          where: { studentId_academicYearId: { studentId: before.id, academicYearId: yearId } },
          create: { studentId: before.id, academicYearId: yearId, gradeId: g.id, sectionId },
          update: { gradeId: g.id, sectionId },
        })
        await audit(tx, ctx, { action: 'update', entityType: 'Student', entityId: before.id, entityLabel: before.fullName, summary: `تحديث من الاستيراد (دفعة ${env.batchId})`, before, after })
        res.updated++
        continue
      }
      const student = await atRow(r.rowNumber, () => createStudent(
        tx,
        ctx,
        {
          fullName: String(r.values.fullName),
          schoolNumber: v(r, 'schoolNumber'),
          gender: v<'MALE' | 'FEMALE'>(r, 'gender'),
          birthDate: v(r, 'birthDate'),
          nationalId: v(r, 'nationalId'),
          joinDate: null,
          address: v(r, 'address'),
          notes: v(r, 'notes'),
          guardianId: null,
          guardian: {
            name: String(r.values.guardianName),
            phone: String(r.values.guardianPhone),
            phone2: v(r, 'phone2'),
            relation: null,
            nationalId: null,
            email: null,
            address: null,
            notes: null,
          },
          academicYearId: yearId,
          gradeId: g.id,
          sectionId,
          confirmDuplicate: true,
        },
        { studentNumber: v(r, 'studentNumber'), importBatchId: env.batchId },
      ))
      const status = v<'ACTIVE' | 'WITHDRAWN' | 'GRADUATED' | 'SUSPENDED'>(r, 'status')
      if (status && status !== 'ACTIVE') await tx.student.update({ where: { id: student.id }, data: { status } })
      res.created++
    }
    return res
  },
}

// ---------------------------------------------------------------------
// الموظفون والمعلمات
// ---------------------------------------------------------------------

function staffImport(teachers: boolean): ImportTypeDef {
  return {
    key: teachers ? 'teachers' : 'employees',
    label: teachers ? 'المعلمات والمعلمون' : 'الموظفون',
    description: teachers ? 'معلمون يُعلَّمون كهيئة تدريسية تلقائيًا، مع رواتبهم.' : 'موظفون إداريون وخدمات، مع رواتبهم.',
    permissions: ['employees.manage'],
    supportsUpdate: true,
    fields: [
      { key: 'fullName', label: 'الاسم', kind: 'text', required: true, synonyms: ['اسم الموظف', 'اسم المعلم', 'اسم المعلمة', 'الاسم الكامل', 'name', 'full name'], example: teachers ? 'سارة محمود' : 'خالد يوسف' },
      { key: 'employeeNumber', label: 'الرقم الوظيفي', kind: 'text', synonyms: ['رقم الموظف', 'employee number', 'employee id'], hint: 'اتركه فارغًا ليُرقّم تلقائيًا' },
      { key: 'phone', label: 'الهاتف', kind: 'phone', synonyms: ['رقم الهاتف', 'الجوال', 'phone', 'mobile'] },
      { key: 'jobTitle', label: 'الوظيفة', kind: 'text', synonyms: ['المسمى الوظيفي', 'job title', 'position', 'المادة'], example: teachers ? 'معلمة رياضيات' : 'محاسب' },
      { key: 'department', label: 'القسم', kind: 'text', synonyms: ['department', 'المرحلة'] },
      { key: 'hireDate', label: 'تاريخ التوظيف', kind: 'date', synonyms: ['تاريخ التعيين', 'hire date', 'start date'] },
      { key: 'salaryType', label: 'نوع الراتب', kind: 'salaryType', synonyms: ['salary type'], hint: 'شهري، يومي، بالساعة (الافتراضي شهري)' },
      { key: 'baseSalary', label: 'الراتب الأساسي', kind: 'amount', synonyms: ['الراتب', 'salary', 'basic salary', 'الأجر'], example: 3000 },
      { key: 'overtimeRate', label: 'سعر الساعة الإضافية', kind: 'amount', synonyms: ['سعر الإضافي', 'overtime rate'] },
      { key: 'bankName', label: 'البنك', kind: 'text', synonyms: ['bank', 'اسم البنك'] },
      { key: 'bankAccount', label: 'رقم الحساب', kind: 'text', synonyms: ['رقم الحساب البنكي', 'account number', 'iban'] },
      { key: 'nationalId', label: 'رقم الهوية', kind: 'text', synonyms: ['الرقم الوطني', 'national id'] },
      { key: 'notes', label: 'ملاحظات', kind: 'text', synonyms: ['notes'] },
    ],
    async validate(rows, env) {
      const l = env.lookups
      const seen = new Map<string, number>()
      return rows.map((r) => {
        const out = base(r)
        if (out.status === 'error') return out
        const name = String(r.values.fullName)
        const number = v(r, 'employeeNumber')
        const key = `${nameKey(name)}|${phoneTail(v(r, 'phone'))}`
        if (seen.has(key)) {
          out.status = 'duplicate'
          out.messages.push(`مكرر داخل الملف (الصف ${seen.get(key)})`)
          return out
        }
        seen.set(key, r.rowNumber)
        const byNumber = number ? l.employeesByNumber.get(number) : undefined
        const byName = (l.employeesByName.get(nameKey(name)) ?? []).find((e) => !v(r, 'phone') || phoneTail(e.phone) === phoneTail(v(r, 'phone')))
        const existing = byNumber ?? byName
        if (existing) {
          out.status = 'duplicate'
          out.existingId = existing.id
          out.messages.push(`موجود مسبقًا: ${existing.fullName}`)
        }
        return out
      })
    },
    async commit(tx, ctx, rows, env) {
      const res: CommitResult = { created: 0, updated: 0, skipped: 0, notes: [] }
      for (const r of rows) {
        const input = {
          fullName: String(r.values.fullName),
          phone: v(r, 'phone'),
          jobTitle: v(r, 'jobTitle'),
          department: v(r, 'department'),
          isTeacher: teachers,
          nationalId: v(r, 'nationalId'),
          hireDate: v(r, 'hireDate'),
          salaryType: v<'MONTHLY' | 'DAILY' | 'HOURLY'>(r, 'salaryType') ?? 'MONTHLY',
          baseSalary: v(r, 'baseSalary') ?? '0',
          overtimeRate: v(r, 'overtimeRate'),
          bankName: v(r, 'bankName'),
          bankAccount: v(r, 'bankAccount'),
          notes: v(r, 'notes'),
          importBatchId: env.batchId,
        }
        if (r.status === 'duplicate') {
          if (env.options.duplicates !== 'update' || !r.existingId) {
            res.skipped++
            continue
          }
          const current = await tx.employee.findUniqueOrThrow({ where: { id: r.existingId } })
          await atRow(r.rowNumber, () => updateEmployee(tx, ctx, current.id, {
            ...input,
            phone: input.phone ?? current.phone,
            jobTitle: input.jobTitle ?? current.jobTitle,
            department: input.department ?? current.department,
            isTeacher: teachers || current.isTeacher,
            nationalId: input.nationalId ?? current.nationalId,
            hireDate: input.hireDate ?? (current.hireDate ? current.hireDate.toISOString().slice(0, 10) : null),
            salaryType: v(r, 'salaryType') ? input.salaryType : current.salaryType,
            baseSalary: v(r, 'baseSalary') ?? current.baseSalary.toString(),
            overtimeRate: input.overtimeRate ?? current.overtimeRate?.toString() ?? null,
            bankName: input.bankName ?? current.bankName,
            bankAccount: input.bankAccount ?? current.bankAccount,
            notes: input.notes ?? current.notes,
          }))
          res.updated++
          continue
        }
        await atRow(r.rowNumber, () => createEmployee(tx, ctx, input, { employeeNumber: v(r, 'employeeNumber') }))
        res.created++
      }
      return res
    },
  }
}

export const teachersImport = staffImport(true)
export const employeesImport = staffImport(false)

// ---------------------------------------------------------------------
// الموردون
// ---------------------------------------------------------------------

export const suppliersImport: ImportTypeDef = {
  key: 'suppliers',
  label: 'الموردون',
  description: 'موردون مع رصيدهم الافتتاحي (المبلغ المستحق لهم قبل بدء استخدام النظام).',
  permissions: ['suppliers.manage'],
  supportsUpdate: true,
  needsYear: true,
  fields: [
    { key: 'name', label: 'اسم المورد', kind: 'text', required: true, synonyms: ['المورد', 'الاسم', 'supplier', 'name', 'vendor'], example: 'مكتبة النور' },
    { key: 'category', label: 'النوع', kind: 'text', synonyms: ['التصنيف', 'category', 'type'], example: 'قرطاسية' },
    { key: 'phone', label: 'الهاتف', kind: 'phone', synonyms: ['رقم الهاتف', 'phone', 'mobile'] },
    { key: 'contactPerson', label: 'مسؤول التواصل', kind: 'text', synonyms: ['الشخص المسؤول', 'contact', 'contact person'] },
    { key: 'address', label: 'العنوان', kind: 'text', synonyms: ['address'] },
    { key: 'openingBalance', label: 'الرصيد الافتتاحي', kind: 'amount', synonyms: ['الرصيد', 'المستحق', 'opening balance', 'balance'], hint: 'المبلغ المستحق للمورد عند بدء النظام' },
    { key: 'notes', label: 'ملاحظات', kind: 'text', synonyms: ['notes'] },
  ],
  async validate(rows, env) {
    const seen = new Map<string, number>()
    return rows.map((r) => {
      const out = base(r)
      if (out.status === 'error') return out
      const key = nameKey(String(r.values.name))
      if (seen.has(key)) {
        out.status = 'error'
        out.messages.push(`المورد مكرر داخل الملف (الصف ${seen.get(key)})`)
        return out
      }
      seen.set(key, r.rowNumber)
      const existing = env.lookups.suppliers.get(key)
      if (existing) {
        out.status = 'duplicate'
        out.existingId = existing.id
        out.messages.push(`المورد موجود مسبقًا: ${existing.name}${v(r, 'openingBalance') ? ' — الرصيد الافتتاحي لن يُضاف مرة أخرى' : ''}`)
      }
      return out
    })
  },
  async commit(tx, ctx, rows, env) {
    const res: CommitResult = { created: 0, updated: 0, skipped: 0, notes: [] }
    const year = env.lookups.years.find((y) => y.id === env.options.yearId)!
    for (const r of rows) {
      const input = {
        name: String(r.values.name),
        category: v(r, 'category'),
        phone: v(r, 'phone'),
        contactPerson: v(r, 'contactPerson'),
        address: v(r, 'address'),
        notes: v(r, 'notes'),
      }
      if (r.status === 'duplicate') {
        if (env.options.duplicates !== 'update' || !r.existingId) {
          res.skipped++
          continue
        }
        const current = await tx.supplier.findUniqueOrThrow({ where: { id: r.existingId } })
        await saveSupplier(tx, ctx, {
          id: current.id,
          name: current.name,
          category: input.category ?? current.category,
          phone: input.phone ?? current.phone,
          contactPerson: input.contactPerson ?? current.contactPerson,
          address: input.address ?? current.address,
          notes: input.notes ?? current.notes,
          email: current.email,
          taxNumber: current.taxNumber,
          isActive: current.isActive,
        })
        res.updated++
        continue
      }
      const s = await atRow(r.rowNumber, () => saveSupplier(tx, ctx, { ...input, importBatchId: env.batchId }))
      const opening = v(r, 'openingBalance')
      if (opening && D(opening).greaterThan(0)) {
        await createSupplierBill(tx, ctx, { supplierId: s.id, date: year.startDate, amount: opening, isOpening: true, description: 'رصيد افتتاحي (استيراد)' })
      }
      res.created++
    }
    return res
  },
}


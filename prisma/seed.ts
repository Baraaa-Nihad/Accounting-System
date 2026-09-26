/**
 * البيانات الأساسية للنظام (آمن للتشغيل أكثر من مرة):
 * الأدوار، المستخدم المدير، دليل الحسابات، تصنيفات الذمم، أنواع الخصم،
 * المراحل والصفوف والشعب، السنوات الدراسية، الصندوق الرئيسي، الإعدادات.
 *
 * التشغيل: npx prisma db seed
 */
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'
import { SYSTEM_ROLES } from '../src/lib/permissions'
import {
  DEFAULT_CHART,
  DEFAULT_CHARGE_TYPES,
  DEFAULT_DISCOUNT_TYPES,
  OPENING_BALANCE_CHARGE_TYPE,
  type ChartNode,
} from '../src/server/ledger/chart'
import { hashPassword } from '../src/server/auth/password'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })

async function seedRoles() {
  for (const role of SYSTEM_ROLES) {
    await prisma.role.upsert({
      where: { key: role.key },
      create: {
        key: role.key,
        name: role.name,
        description: role.description,
        permissions: role.permissions,
        isSystem: true,
      },
      update: role.key === 'admin' ? { permissions: role.permissions, isSystem: true } : { isSystem: true },
    })
  }
}

async function seedAdmin() {
  const count = await prisma.user.count()
  if (count > 0) return
  const admin = await prisma.role.findUniqueOrThrow({ where: { key: 'admin' } })
  const password = process.env.ADMIN_PASSWORD || 'Admin@12345'
  await prisma.user.create({
    data: {
      username: process.env.ADMIN_USERNAME || 'admin',
      fullName: 'مدير النظام',
      passwordHash: await hashPassword(password),
      roleId: admin.id,
      mustChangePassword: true,
    },
  })
  console.log(`✔ تم إنشاء المستخدم المدير: ${process.env.ADMIN_USERNAME || 'admin'} / ${password} (يجب تغييرها عند أول دخول)`)
}

async function seedChart(nodes: ChartNode[], parentId: number | null) {
  for (const node of nodes) {
    const existing = await prisma.account.findUnique({ where: { code: node.code } })
    const acc =
      existing ??
      (await prisma.account.create({
        data: {
          code: node.code,
          name: node.name,
          type: node.type,
          parentId,
          isGroup: !!node.group,
          systemKey: node.key ?? null,
          isSystem: !!node.key || !!node.group,
        },
      }))
    if (existing && node.key && !existing.systemKey) {
      await prisma.account.update({ where: { id: existing.id }, data: { systemKey: node.key, isSystem: true } })
    }
    if (node.children) await seedChart(node.children, acc.id)
  }
}

async function seedChargeTypes() {
  const group = await prisma.account.findUniqueOrThrow({ where: { systemKey: 'STUDENT_REVENUE_GROUP' } })
  let i = 0
  for (const ct of DEFAULT_CHARGE_TYPES) {
    i++
    const exists = await prisma.chargeType.findUnique({ where: { name: ct.name } })
    if (exists) continue
    const code = `${group.code}${String(i).padStart(2, '0')}`
    const account =
      (await prisma.account.findUnique({ where: { code } })) ??
      (await prisma.account.create({
        data: { code, name: ct.revenueName, type: 'REVENUE', parentId: group.id },
      }))
    await prisma.chargeType.create({
      data: { name: ct.name, revenueAccountId: account.id, allowInstallments: ct.installments, sortOrder: i },
    })
  }
  const opening = await prisma.account.findUniqueOrThrow({ where: { systemKey: 'OPENING_BALANCE' } })
  await prisma.chargeType.upsert({
    where: { systemKey: OPENING_BALANCE_CHARGE_TYPE.systemKey },
    create: {
      name: OPENING_BALANCE_CHARGE_TYPE.name,
      systemKey: OPENING_BALANCE_CHARGE_TYPE.systemKey,
      revenueAccountId: opening.id,
      allowInstallments: true,
      sortOrder: 99,
      description: 'مبالغ مستحقة على الطالب من سنوات أو أنظمة سابقة',
    },
    update: {},
  })
}

async function seedDiscountTypes() {
  let i = 0
  for (const dt of DEFAULT_DISCOUNT_TYPES) {
    i++
    await prisma.discountType.upsert({
      where: { name: dt.name },
      create: { name: dt.name, defaultMethod: dt.method ?? null, defaultValue: dt.value ?? null, sortOrder: i },
      update: {},
    })
  }
}

async function seedSchoolStructure() {
  if ((await prisma.grade.count()) > 0) return
  const structure: { stage: string; grades: string[] }[] = [
    { stage: 'رياض الأطفال', grades: ['البستان', 'التمهيدي'] },
    {
      stage: 'المرحلة الأساسية',
      grades: [
        'الصف الأول',
        'الصف الثاني',
        'الصف الثالث',
        'الصف الرابع',
        'الصف الخامس',
        'الصف السادس',
        'الصف السابع',
        'الصف الثامن',
        'الصف التاسع',
        'الصف العاشر',
      ],
    },
    { stage: 'المرحلة الثانوية', grades: ['الصف الحادي عشر', 'الصف الثاني عشر'] },
  ]
  let order = 0
  const created: number[] = []
  for (let s = 0; s < structure.length; s++) {
    const stage = await prisma.stage.create({ data: { name: structure[s].stage, sortOrder: s + 1 } })
    for (const name of structure[s].grades) {
      order++
      const grade = await prisma.grade.create({ data: { name, stageId: stage.id, sortOrder: order } })
      await prisma.section.createMany({ data: [{ gradeId: grade.id, name: 'أ' }, { gradeId: grade.id, name: 'ب' }] })
      created.push(grade.id)
    }
  }
  // سلسلة الترحيل: كل صف ← الصف التالي (الأخير بلا تالٍ = تخرج)
  for (let i = 0; i < created.length - 1; i++) {
    await prisma.grade.update({ where: { id: created[i] }, data: { nextGradeId: created[i + 1] } })
  }
}

async function seedYears() {
  if ((await prisma.academicYear.count()) > 0) return
  const now = new Date()
  const y = now.getUTCMonth() + 1 >= 9 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
  const d = (s: string) => new Date(`${s}T00:00:00.000Z`)
  await prisma.academicYear.create({
    data: { name: `${y - 1}/${y}`, startDate: d(`${y - 1}-09-01`), endDate: d(`${y}-08-31`), status: 'OPEN' },
  })
  await prisma.academicYear.create({
    data: { name: `${y}/${y + 1}`, startDate: d(`${y}-09-01`), endDate: d(`${y + 1}-08-31`), isCurrent: true },
  })
}

async function seedCashbox() {
  if ((await prisma.cashAccount.count()) > 0) return
  const group = await prisma.account.findUniqueOrThrow({ where: { systemKey: 'CASH_GROUP' } })
  const code = `${group.code}01`
  const gl =
    (await prisma.account.findUnique({ where: { code } })) ??
    (await prisma.account.create({ data: { code, name: 'الصندوق الرئيسي', type: 'ASSET', parentId: group.id } }))
  await prisma.cashAccount.create({
    data: { name: 'الصندوق الرئيسي', type: 'CASHBOX', glAccountId: gl.id, isDefault: true, lowBalanceAlert: 500 },
  })
}

async function main() {
  await seedRoles()
  await seedChart(DEFAULT_CHART, null)
  await seedChargeTypes()
  await seedDiscountTypes()
  await seedSchoolStructure()
  await seedYears()
  await seedCashbox()
  await seedAdmin()
  console.log('✔ اكتملت البيانات الأساسية')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

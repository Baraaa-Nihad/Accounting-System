-- Extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "StudentStatus" AS ENUM ('ACTIVE', 'WITHDRAWN', 'GRADUATED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'PROMOTED', 'REPEATED', 'GRADUATED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "YearStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "DocStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID');

-- CreateEnum
CREATE TYPE "InstallmentStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DiscountMethod" AS ENUM ('PERCENT', 'FIXED');

-- CreateEnum
CREATE TYPE "DiscountScope" AS ENUM ('CHARGE', 'CHARGE_TYPE', 'ACCOUNT');

-- CreateEnum
CREATE TYPE "DiscountDistribution" AS ENUM ('EVEN', 'FROM_LAST');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CHEQUE', 'BANK_TRANSFER', 'CARD', 'ELECTRONIC', 'OTHER');

-- CreateEnum
CREATE TYPE "ReceiptKind" AS ENUM ('STUDENT', 'FAMILY', 'OTHER_REVENUE', 'PARTNER_CAPITAL', 'OPENING_CREDIT');

-- CreateEnum
CREATE TYPE "VoucherKind" AS ENUM ('EXPENSE', 'SUPPLIER_PAYMENT', 'CONTRACTOR_PAYMENT', 'SALARY', 'ADVANCE', 'STUDENT_REFUND', 'PARTNER_WITHDRAWAL', 'OTHER');

-- CreateEnum
CREATE TYPE "CashAccountType" AS ENUM ('CASHBOX', 'BANK');

-- CreateEnum
CREATE TYPE "ChequeDirection" AS ENUM ('INCOMING', 'OUTGOING');

-- CreateEnum
CREATE TYPE "ChequeStatus" AS ENUM ('IN_PORTFOLIO', 'CLEARED', 'BOUNCED', 'ISSUED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SalaryType" AS ENUM ('MONTHLY', 'DAILY', 'HOURLY');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT', 'APPROVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AdvanceStatus" AS ENUM ('ACTIVE', 'SETTLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OvertimeStatus" AS ENUM ('PENDING', 'INCLUDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "JournalStatus" AS ENUM ('POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "roles" (
    "id" SERIAL NOT NULL,
    "key" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "roleId" INTEGER NOT NULL,
    "extraPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "revokedPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "lastLoginIp" TEXT,
    "passwordChangedAt" TIMESTAMP(3),
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_attempts" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "userId" INTEGER,
    "success" BOOLEAN NOT NULL,
    "reason" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "userName" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "entityLabel" TEXT,
    "summary" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partners" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "ownershipPercent" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "userId" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "joinDate" DATE,
    "notes" TEXT,
    "capitalAccountId" INTEGER,
    "drawingsAccountId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "number_sequences" (
    "key" TEXT NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "number_sequences_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "academic_years" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "YearStatus" NOT NULL DEFAULT 'OPEN',
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "closedAt" TIMESTAMP(3),
    "closedById" INTEGER,
    "closingEntryId" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "academic_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stages" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grades" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "stageId" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "nextGradeId" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "grades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sections" (
    "id" SERIAL NOT NULL,
    "gradeId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardians" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "phone2" TEXT,
    "relation" TEXT,
    "nationalId" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "searchText" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guardians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" SERIAL NOT NULL,
    "studentNumber" TEXT NOT NULL,
    "schoolNumber" TEXT,
    "fullName" TEXT NOT NULL,
    "gender" "Gender",
    "birthDate" DATE,
    "nationalId" TEXT,
    "guardianId" INTEGER,
    "status" "StudentStatus" NOT NULL DEFAULT 'ACTIVE',
    "statusChangedAt" TIMESTAMP(3),
    "statusReason" TEXT,
    "joinDate" DATE,
    "address" TEXT,
    "notes" TEXT,
    "searchText" TEXT NOT NULL DEFAULT '',
    "importBatchId" INTEGER,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" SERIAL NOT NULL,
    "studentId" INTEGER NOT NULL,
    "academicYearId" INTEGER NOT NULL,
    "gradeId" INTEGER NOT NULL,
    "sectionId" INTEGER,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charge_types" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "revenueAccountId" INTEGER NOT NULL,
    "defaultAmount" DECIMAL(15,3),
    "allowInstallments" BOOLEAN NOT NULL DEFAULT false,
    "systemKey" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "charge_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_plans" (
    "id" SERIAL NOT NULL,
    "academicYearId" INTEGER NOT NULL,
    "gradeId" INTEGER NOT NULL,
    "chargeTypeId" INTEGER NOT NULL,
    "amount" DECIMAL(15,3) NOT NULL,
    "installmentsCount" INTEGER NOT NULL DEFAULT 1,
    "firstDueDate" DATE,
    "dueDay" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fee_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charges" (
    "id" SERIAL NOT NULL,
    "studentId" INTEGER NOT NULL,
    "chargeTypeId" INTEGER NOT NULL,
    "academicYearId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT,
    "notes" TEXT,
    "grossAmount" DECIMAL(15,3) NOT NULL,
    "discountAmount" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(15,3) NOT NULL,
    "paidAmount" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "isInstallment" BOOLEAN NOT NULL DEFAULT false,
    "installmentCount" INTEGER NOT NULL DEFAULT 1,
    "status" "DocStatus" NOT NULL DEFAULT 'ACTIVE',
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" INTEGER,
    "cancelReason" TEXT,
    "bulkBatchId" TEXT,
    "journalEntryId" INTEGER,
    "importBatchId" INTEGER,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installments" (
    "id" SERIAL NOT NULL,
    "chargeId" INTEGER NOT NULL,
    "studentId" INTEGER NOT NULL,
    "academicYearId" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "amount" DECIMAL(15,3) NOT NULL,
    "paidAmount" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "status" "InstallmentStatus" NOT NULL DEFAULT 'UNPAID',
    "paidAt" DATE,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_types" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "defaultMethod" "DiscountMethod",
    "defaultValue" DECIMAL(15,3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "discount_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discounts" (
    "id" SERIAL NOT NULL,
    "studentId" INTEGER NOT NULL,
    "discountTypeId" INTEGER,
    "academicYearId" INTEGER NOT NULL,
    "scope" "DiscountScope" NOT NULL,
    "chargeId" INTEGER,
    "chargeTypeId" INTEGER,
    "method" "DiscountMethod" NOT NULL,
    "value" DECIMAL(15,3) NOT NULL,
    "distribution" "DiscountDistribution" NOT NULL DEFAULT 'EVEN',
    "baseAmount" DECIMAL(15,3) NOT NULL,
    "amount" DECIMAL(15,3) NOT NULL,
    "netAmount" DECIMAL(15,3) NOT NULL,
    "reason" TEXT NOT NULL,
    "approvedBy" TEXT,
    "ruleId" INTEGER,
    "date" DATE NOT NULL,
    "status" "DocStatus" NOT NULL DEFAULT 'ACTIVE',
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" INTEGER,
    "cancelReason" TEXT,
    "journalEntryId" INTEGER,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_applications" (
    "id" SERIAL NOT NULL,
    "discountId" INTEGER NOT NULL,
    "chargeId" INTEGER NOT NULL,
    "baseAmount" DECIMAL(15,3) NOT NULL,
    "amount" DECIMAL(15,3) NOT NULL,

    CONSTRAINT "discount_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_discount_rules" (
    "id" SERIAL NOT NULL,
    "studentId" INTEGER NOT NULL,
    "discountTypeId" INTEGER,
    "chargeTypeId" INTEGER,
    "academicYearId" INTEGER,
    "method" "DiscountMethod" NOT NULL,
    "value" DECIMAL(15,3) NOT NULL,
    "reason" TEXT NOT NULL,
    "approvedBy" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_discount_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_accounts" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CashAccountType" NOT NULL,
    "bankName" TEXT,
    "accountNumber" TEXT,
    "iban" TEXT,
    "glAccountId" INTEGER NOT NULL,
    "lowBalanceAlert" DECIMAL(15,3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cash_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "kind" "ReceiptKind" NOT NULL,
    "date" DATE NOT NULL,
    "academicYearId" INTEGER NOT NULL,
    "payerName" TEXT NOT NULL,
    "studentId" INTEGER,
    "guardianId" INTEGER,
    "partnerId" INTEGER,
    "amount" DECIMAL(15,3) NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "cashAccountId" INTEGER,
    "revenueAccountId" INTEGER,
    "referenceNumber" TEXT,
    "description" TEXT,
    "notes" TEXT,
    "status" "DocStatus" NOT NULL DEFAULT 'ACTIVE',
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" INTEGER,
    "cancelReason" TEXT,
    "journalEntryId" INTEGER,
    "reversalEntryId" INTEGER,
    "importBatchId" INTEGER,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" SERIAL NOT NULL,
    "receiptId" INTEGER NOT NULL,
    "studentId" INTEGER NOT NULL,
    "chargeId" INTEGER,
    "installmentId" INTEGER,
    "refundVoucherId" INTEGER,
    "amount" DECIMAL(15,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cheques" (
    "id" SERIAL NOT NULL,
    "direction" "ChequeDirection" NOT NULL,
    "number" TEXT NOT NULL,
    "bankName" TEXT,
    "dueDate" DATE NOT NULL,
    "amount" DECIMAL(15,3) NOT NULL,
    "partyName" TEXT,
    "status" "ChequeStatus" NOT NULL,
    "receiptId" INTEGER,
    "voucherId" INTEGER,
    "depositAccountId" INTEGER,
    "clearedAt" DATE,
    "bouncedAt" DATE,
    "bounceReason" TEXT,
    "clearingEntryId" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cheques_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_vouchers" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "kind" "VoucherKind" NOT NULL,
    "date" DATE NOT NULL,
    "academicYearId" INTEGER NOT NULL,
    "payeeName" TEXT NOT NULL,
    "amount" DECIMAL(15,3) NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "cashAccountId" INTEGER NOT NULL,
    "expenseAccountId" INTEGER,
    "supplierId" INTEGER,
    "contractorId" INTEGER,
    "contractorJobId" INTEGER,
    "employeeId" INTEGER,
    "payrollItemId" INTEGER,
    "advanceId" INTEGER,
    "studentId" INTEGER,
    "partnerId" INTEGER,
    "referenceNumber" TEXT,
    "description" TEXT,
    "notes" TEXT,
    "status" "DocStatus" NOT NULL DEFAULT 'ACTIVE',
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" INTEGER,
    "cancelReason" TEXT,
    "journalEntryId" INTEGER,
    "reversalEntryId" INTEGER,
    "importBatchId" INTEGER,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_transfers" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "academicYearId" INTEGER NOT NULL,
    "fromAccountId" INTEGER NOT NULL,
    "toAccountId" INTEGER NOT NULL,
    "amount" DECIMAL(15,3) NOT NULL,
    "description" TEXT,
    "notes" TEXT,
    "status" "DocStatus" NOT NULL DEFAULT 'ACTIVE',
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" INTEGER,
    "cancelReason" TEXT,
    "journalEntryId" INTEGER,
    "reversalEntryId" INTEGER,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "contactPerson" TEXT,
    "address" TEXT,
    "taxNumber" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "searchText" TEXT NOT NULL DEFAULT '',
    "importBatchId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_bills" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "supplierInvoiceNo" TEXT,
    "supplierId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "dueDate" DATE,
    "academicYearId" INTEGER NOT NULL,
    "expenseAccountId" INTEGER NOT NULL,
    "amount" DECIMAL(15,3) NOT NULL,
    "description" TEXT,
    "notes" TEXT,
    "isOpening" BOOLEAN NOT NULL DEFAULT false,
    "status" "DocStatus" NOT NULL DEFAULT 'ACTIVE',
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" INTEGER,
    "cancelReason" TEXT,
    "journalEntryId" INTEGER,
    "reversalEntryId" INTEGER,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contractors" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "specialty" TEXT,
    "phone" TEXT,
    "nationalId" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "searchText" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contractors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contractor_jobs" (
    "id" SERIAL NOT NULL,
    "contractorId" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "agreedAmount" DECIMAL(15,3) NOT NULL,
    "paidAmount" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "academicYearId" INTEGER NOT NULL,
    "expenseAccountId" INTEGER NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "journalEntryId" INTEGER,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contractor_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" SERIAL NOT NULL,
    "employeeNumber" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "jobTitle" TEXT,
    "department" TEXT,
    "isTeacher" BOOLEAN NOT NULL DEFAULT false,
    "gender" "Gender",
    "nationalId" TEXT,
    "hireDate" DATE,
    "salaryType" "SalaryType" NOT NULL DEFAULT 'MONTHLY',
    "baseSalary" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "overtimeRate" DECIMAL(15,3),
    "bankName" TEXT,
    "bankAccount" TEXT,
    "iban" TEXT,
    "address" TEXT,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "endDate" DATE,
    "notes" TEXT,
    "searchText" TEXT NOT NULL DEFAULT '',
    "importBatchId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "overtime_entries" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "hours" DECIMAL(8,2) NOT NULL,
    "rate" DECIMAL(15,3) NOT NULL,
    "amount" DECIMAL(15,3) NOT NULL,
    "reason" TEXT,
    "notes" TEXT,
    "status" "OvertimeStatus" NOT NULL DEFAULT 'PENDING',
    "payrollItemId" INTEGER,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "overtime_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_advances" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(15,3) NOT NULL,
    "installmentsCount" INTEGER NOT NULL DEFAULT 1,
    "monthlyDeduction" DECIMAL(15,3) NOT NULL,
    "startYear" INTEGER NOT NULL,
    "startMonth" INTEGER NOT NULL,
    "deductedAmount" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "status" "AdvanceStatus" NOT NULL DEFAULT 'ACTIVE',
    "reason" TEXT,
    "notes" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_advances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advance_deductions" (
    "id" SERIAL NOT NULL,
    "advanceId" INTEGER NOT NULL,
    "payrollItemId" INTEGER NOT NULL,
    "amount" DECIMAL(15,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "advance_deductions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" SERIAL NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "academicYearId" INTEGER NOT NULL,
    "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "postingDate" DATE NOT NULL,
    "totalGross" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "totalDeductions" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "totalNet" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "totalPaid" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "approvedAt" TIMESTAMP(3),
    "approvedById" INTEGER,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" INTEGER,
    "cancelReason" TEXT,
    "journalEntryId" INTEGER,
    "reversalEntryId" INTEGER,
    "notes" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_items" (
    "id" SERIAL NOT NULL,
    "payrollRunId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "salaryType" "SalaryType" NOT NULL,
    "rate" DECIMAL(15,3) NOT NULL,
    "workDays" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "workHours" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "basicPay" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "absenceDays" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "absenceDeduction" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "lateHours" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "lateDeduction" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "overtimeHours" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "overtimeAmount" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "bonuses" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "allowances" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "otherDeductions" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "withholdings" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "advanceDeduction" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "grossPay" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "totalDeductions" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "netPay" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "parentId" INTEGER,
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "systemKey" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "academicYearId" INTEGER,
    "description" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" INTEGER,
    "status" "JournalStatus" NOT NULL DEFAULT 'POSTED',
    "reversalOfId" INTEGER,
    "totalAmount" DECIMAL(15,3) NOT NULL,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" SERIAL NOT NULL,
    "entryId" INTEGER NOT NULL,
    "accountId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "debit" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "credit" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "description" TEXT,
    "lineOrder" INTEGER NOT NULL DEFAULT 0,
    "studentId" INTEGER,
    "employeeId" INTEGER,
    "supplierId" INTEGER,
    "contractorId" INTEGER,
    "partnerId" INTEGER,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" SERIAL NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "description" TEXT,
    "uploadedById" INTEGER,
    "deletedAt" TIMESTAMP(3),
    "deletedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "headers" JSONB,
    "rows" JSONB,
    "mapping" JSONB,
    "options" JSONB,
    "result" JSONB,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "importedRows" INTEGER NOT NULL DEFAULT 0,
    "skippedRows" INTEGER NOT NULL DEFAULT 0,
    "errorRows" INTEGER NOT NULL DEFAULT 0,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "login_attempts_username_createdAt_idx" ON "login_attempts"("username", "createdAt");

-- CreateIndex
CREATE INDEX "login_attempts_ip_createdAt_idx" ON "login_attempts"("ip", "createdAt");

-- CreateIndex
CREATE INDEX "login_attempts_createdAt_idx" ON "login_attempts"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_userId_createdAt_idx" ON "audit_logs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE UNIQUE INDEX "partners_userId_key" ON "partners"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "partners_capitalAccountId_key" ON "partners"("capitalAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "partners_drawingsAccountId_key" ON "partners"("drawingsAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "academic_years_name_key" ON "academic_years"("name");

-- CreateIndex
CREATE UNIQUE INDEX "stages_name_key" ON "stages"("name");

-- CreateIndex
CREATE UNIQUE INDEX "grades_name_key" ON "grades"("name");

-- CreateIndex
CREATE UNIQUE INDEX "sections_gradeId_name_key" ON "sections"("gradeId", "name");

-- CreateIndex
CREATE INDEX "guardians_phone_idx" ON "guardians"("phone");

-- CreateIndex
CREATE INDEX "guardians_searchText_idx" ON "guardians" USING GIN ("searchText" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "students_studentNumber_key" ON "students"("studentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "students_schoolNumber_key" ON "students"("schoolNumber");

-- CreateIndex
CREATE INDEX "students_guardianId_idx" ON "students"("guardianId");

-- CreateIndex
CREATE INDEX "students_status_idx" ON "students"("status");

-- CreateIndex
CREATE INDEX "students_searchText_idx" ON "students" USING GIN ("searchText" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "enrollments_academicYearId_gradeId_idx" ON "enrollments"("academicYearId", "gradeId");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_studentId_academicYearId_key" ON "enrollments"("studentId", "academicYearId");

-- CreateIndex
CREATE UNIQUE INDEX "charge_types_name_key" ON "charge_types"("name");

-- CreateIndex
CREATE UNIQUE INDEX "charge_types_systemKey_key" ON "charge_types"("systemKey");

-- CreateIndex
CREATE UNIQUE INDEX "fee_plans_academicYearId_gradeId_chargeTypeId_key" ON "fee_plans"("academicYearId", "gradeId", "chargeTypeId");

-- CreateIndex
CREATE INDEX "charges_studentId_academicYearId_idx" ON "charges"("studentId", "academicYearId");

-- CreateIndex
CREATE INDEX "charges_chargeTypeId_idx" ON "charges"("chargeTypeId");

-- CreateIndex
CREATE INDEX "charges_academicYearId_status_idx" ON "charges"("academicYearId", "status");

-- CreateIndex
CREATE INDEX "charges_bulkBatchId_idx" ON "charges"("bulkBatchId");

-- CreateIndex
CREATE INDEX "installments_dueDate_status_idx" ON "installments"("dueDate", "status");

-- CreateIndex
CREATE INDEX "installments_studentId_status_idx" ON "installments"("studentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "installments_chargeId_number_key" ON "installments"("chargeId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "discount_types_name_key" ON "discount_types"("name");

-- CreateIndex
CREATE INDEX "discounts_studentId_idx" ON "discounts"("studentId");

-- CreateIndex
CREATE INDEX "discounts_date_idx" ON "discounts"("date");

-- CreateIndex
CREATE INDEX "discount_applications_chargeId_idx" ON "discount_applications"("chargeId");

-- CreateIndex
CREATE INDEX "discount_applications_discountId_idx" ON "discount_applications"("discountId");

-- CreateIndex
CREATE INDEX "student_discount_rules_studentId_idx" ON "student_discount_rules"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "cash_accounts_name_key" ON "cash_accounts"("name");

-- CreateIndex
CREATE UNIQUE INDEX "cash_accounts_glAccountId_key" ON "cash_accounts"("glAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_number_key" ON "receipts"("number");

-- CreateIndex
CREATE INDEX "receipts_date_idx" ON "receipts"("date");

-- CreateIndex
CREATE INDEX "receipts_studentId_idx" ON "receipts"("studentId");

-- CreateIndex
CREATE INDEX "receipts_guardianId_idx" ON "receipts"("guardianId");

-- CreateIndex
CREATE INDEX "receipts_status_date_idx" ON "receipts"("status", "date");

-- CreateIndex
CREATE INDEX "payment_allocations_receiptId_idx" ON "payment_allocations"("receiptId");

-- CreateIndex
CREATE INDEX "payment_allocations_studentId_idx" ON "payment_allocations"("studentId");

-- CreateIndex
CREATE INDEX "payment_allocations_installmentId_idx" ON "payment_allocations"("installmentId");

-- CreateIndex
CREATE INDEX "payment_allocations_chargeId_idx" ON "payment_allocations"("chargeId");

-- CreateIndex
CREATE INDEX "payment_allocations_refundVoucherId_idx" ON "payment_allocations"("refundVoucherId");

-- CreateIndex
CREATE UNIQUE INDEX "cheques_receiptId_key" ON "cheques"("receiptId");

-- CreateIndex
CREATE UNIQUE INDEX "cheques_voucherId_key" ON "cheques"("voucherId");

-- CreateIndex
CREATE INDEX "cheques_status_dueDate_idx" ON "cheques"("status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "payment_vouchers_number_key" ON "payment_vouchers"("number");

-- CreateIndex
CREATE UNIQUE INDEX "payment_vouchers_advanceId_key" ON "payment_vouchers"("advanceId");

-- CreateIndex
CREATE INDEX "payment_vouchers_date_idx" ON "payment_vouchers"("date");

-- CreateIndex
CREATE INDEX "payment_vouchers_kind_date_idx" ON "payment_vouchers"("kind", "date");

-- CreateIndex
CREATE INDEX "payment_vouchers_status_date_idx" ON "payment_vouchers"("status", "date");

-- CreateIndex
CREATE INDEX "payment_vouchers_supplierId_idx" ON "payment_vouchers"("supplierId");

-- CreateIndex
CREATE INDEX "payment_vouchers_employeeId_idx" ON "payment_vouchers"("employeeId");

-- CreateIndex
CREATE INDEX "payment_vouchers_contractorId_idx" ON "payment_vouchers"("contractorId");

-- CreateIndex
CREATE UNIQUE INDEX "cash_transfers_number_key" ON "cash_transfers"("number");

-- CreateIndex
CREATE INDEX "cash_transfers_date_idx" ON "cash_transfers"("date");

-- CreateIndex
CREATE INDEX "suppliers_searchText_idx" ON "suppliers" USING GIN ("searchText" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "supplier_bills_number_key" ON "supplier_bills"("number");

-- CreateIndex
CREATE INDEX "supplier_bills_supplierId_idx" ON "supplier_bills"("supplierId");

-- CreateIndex
CREATE INDEX "supplier_bills_date_idx" ON "supplier_bills"("date");

-- CreateIndex
CREATE INDEX "contractors_searchText_idx" ON "contractors" USING GIN ("searchText" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "contractor_jobs_contractorId_idx" ON "contractor_jobs"("contractorId");

-- CreateIndex
CREATE UNIQUE INDEX "employees_employeeNumber_key" ON "employees"("employeeNumber");

-- CreateIndex
CREATE INDEX "employees_status_idx" ON "employees"("status");

-- CreateIndex
CREATE INDEX "employees_searchText_idx" ON "employees" USING GIN ("searchText" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "overtime_entries_employeeId_date_idx" ON "overtime_entries"("employeeId", "date");

-- CreateIndex
CREATE INDEX "overtime_entries_status_idx" ON "overtime_entries"("status");

-- CreateIndex
CREATE INDEX "employee_advances_employeeId_status_idx" ON "employee_advances"("employeeId", "status");

-- CreateIndex
CREATE INDEX "advance_deductions_advanceId_idx" ON "advance_deductions"("advanceId");

-- CreateIndex
CREATE INDEX "advance_deductions_payrollItemId_idx" ON "advance_deductions"("payrollItemId");

-- CreateIndex
CREATE INDEX "payroll_runs_year_month_idx" ON "payroll_runs"("year", "month");

-- CreateIndex
CREATE INDEX "payroll_items_employeeId_idx" ON "payroll_items"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_items_payrollRunId_employeeId_key" ON "payroll_items"("payrollRunId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_code_key" ON "accounts"("code");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_systemKey_key" ON "accounts"("systemKey");

-- CreateIndex
CREATE INDEX "accounts_parentId_idx" ON "accounts"("parentId");

-- CreateIndex
CREATE INDEX "accounts_type_idx" ON "accounts"("type");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_number_key" ON "journal_entries"("number");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_reversalOfId_key" ON "journal_entries"("reversalOfId");

-- CreateIndex
CREATE INDEX "journal_entries_date_idx" ON "journal_entries"("date");

-- CreateIndex
CREATE INDEX "journal_entries_sourceType_sourceId_idx" ON "journal_entries"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "journal_lines_entryId_idx" ON "journal_lines"("entryId");

-- CreateIndex
CREATE INDEX "journal_lines_accountId_date_idx" ON "journal_lines"("accountId", "date");

-- CreateIndex
CREATE INDEX "journal_lines_studentId_date_idx" ON "journal_lines"("studentId", "date");

-- CreateIndex
CREATE INDEX "journal_lines_employeeId_date_idx" ON "journal_lines"("employeeId", "date");

-- CreateIndex
CREATE INDEX "journal_lines_supplierId_date_idx" ON "journal_lines"("supplierId", "date");

-- CreateIndex
CREATE INDEX "journal_lines_contractorId_date_idx" ON "journal_lines"("contractorId", "date");

-- CreateIndex
CREATE INDEX "journal_lines_partnerId_idx" ON "journal_lines"("partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_fileName_key" ON "attachments"("fileName");

-- CreateIndex
CREATE INDEX "attachments_entityType_entityId_idx" ON "attachments"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "import_batches_createdById_createdAt_idx" ON "import_batches"("createdById", "createdAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partners" ADD CONSTRAINT "partners_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partners" ADD CONSTRAINT "partners_capitalAccountId_fkey" FOREIGN KEY ("capitalAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partners" ADD CONSTRAINT "partners_drawingsAccountId_fkey" FOREIGN KEY ("drawingsAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grades" ADD CONSTRAINT "grades_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grades" ADD CONSTRAINT "grades_nextGradeId_fkey" FOREIGN KEY ("nextGradeId") REFERENCES "grades"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "guardians"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_types" ADD CONSTRAINT "charge_types_revenueAccountId_fkey" FOREIGN KEY ("revenueAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_plans" ADD CONSTRAINT "fee_plans_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_plans" ADD CONSTRAINT "fee_plans_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_plans" ADD CONSTRAINT "fee_plans_chargeTypeId_fkey" FOREIGN KEY ("chargeTypeId") REFERENCES "charge_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_chargeTypeId_fkey" FOREIGN KEY ("chargeTypeId") REFERENCES "charge_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installments" ADD CONSTRAINT "installments_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "charges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installments" ADD CONSTRAINT "installments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_discountTypeId_fkey" FOREIGN KEY ("discountTypeId") REFERENCES "discount_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "charges"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_chargeTypeId_fkey" FOREIGN KEY ("chargeTypeId") REFERENCES "charge_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_applications" ADD CONSTRAINT "discount_applications_discountId_fkey" FOREIGN KEY ("discountId") REFERENCES "discounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_applications" ADD CONSTRAINT "discount_applications_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "charges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_discount_rules" ADD CONSTRAINT "student_discount_rules_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_discount_rules" ADD CONSTRAINT "student_discount_rules_discountTypeId_fkey" FOREIGN KEY ("discountTypeId") REFERENCES "discount_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_discount_rules" ADD CONSTRAINT "student_discount_rules_chargeTypeId_fkey" FOREIGN KEY ("chargeTypeId") REFERENCES "charge_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_glAccountId_fkey" FOREIGN KEY ("glAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "guardians"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_revenueAccountId_fkey" FOREIGN KEY ("revenueAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "charges"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_installmentId_fkey" FOREIGN KEY ("installmentId") REFERENCES "installments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_refundVoucherId_fkey" FOREIGN KEY ("refundVoucherId") REFERENCES "payment_vouchers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "payment_vouchers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_depositAccountId_fkey" FOREIGN KEY ("depositAccountId") REFERENCES "cash_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_expenseAccountId_fkey" FOREIGN KEY ("expenseAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "contractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_contractorJobId_fkey" FOREIGN KEY ("contractorJobId") REFERENCES "contractor_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_payrollItemId_fkey" FOREIGN KEY ("payrollItemId") REFERENCES "payroll_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_advanceId_fkey" FOREIGN KEY ("advanceId") REFERENCES "employee_advances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_transfers" ADD CONSTRAINT "cash_transfers_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_transfers" ADD CONSTRAINT "cash_transfers_fromAccountId_fkey" FOREIGN KEY ("fromAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_transfers" ADD CONSTRAINT "cash_transfers_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_transfers" ADD CONSTRAINT "cash_transfers_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_expenseAccountId_fkey" FOREIGN KEY ("expenseAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_jobs" ADD CONSTRAINT "contractor_jobs_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "contractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_jobs" ADD CONSTRAINT "contractor_jobs_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_jobs" ADD CONSTRAINT "contractor_jobs_expenseAccountId_fkey" FOREIGN KEY ("expenseAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "overtime_entries" ADD CONSTRAINT "overtime_entries_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "overtime_entries" ADD CONSTRAINT "overtime_entries_payrollItemId_fkey" FOREIGN KEY ("payrollItemId") REFERENCES "payroll_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advance_deductions" ADD CONSTRAINT "advance_deductions_advanceId_fkey" FOREIGN KEY ("advanceId") REFERENCES "employee_advances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advance_deductions" ADD CONSTRAINT "advance_deductions_payrollItemId_fkey" FOREIGN KEY ("payrollItemId") REFERENCES "payroll_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "contractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =====================================================================
-- Data integrity rules (not expressible in the Prisma schema)
-- See docs/02-database-schema.md §2.4
-- =====================================================================

-- ---- Non-negative amounts and basic invariants ----
ALTER TABLE "charges"
  ADD CONSTRAINT "charges_amounts_chk" CHECK ("grossAmount" >= 0 AND "discountAmount" >= 0 AND "netAmount" >= 0 AND "paidAmount" >= 0),
  ADD CONSTRAINT "charges_net_chk" CHECK ("netAmount" = "grossAmount" - "discountAmount"),
  ADD CONSTRAINT "charges_paid_chk" CHECK ("paidAmount" <= "netAmount"),
  ADD CONSTRAINT "charges_count_chk" CHECK ("installmentCount" >= 1);

ALTER TABLE "installments"
  ADD CONSTRAINT "installments_amounts_chk" CHECK ("amount" >= 0 AND "paidAmount" >= 0),
  ADD CONSTRAINT "installments_paid_chk" CHECK ("paidAmount" <= "amount");

ALTER TABLE "discounts"
  ADD CONSTRAINT "discounts_amounts_chk" CHECK ("value" >= 0 AND "baseAmount" >= 0 AND "amount" >= 0 AND "netAmount" >= 0);
ALTER TABLE "discount_applications"
  ADD CONSTRAINT "discount_applications_amount_chk" CHECK ("amount" >= 0 AND "baseAmount" >= 0);
ALTER TABLE "student_discount_rules"
  ADD CONSTRAINT "student_discount_rules_value_chk" CHECK ("value" >= 0);
ALTER TABLE "fee_plans"
  ADD CONSTRAINT "fee_plans_chk" CHECK ("amount" >= 0 AND "installmentsCount" >= 1);

ALTER TABLE "receipts" ADD CONSTRAINT "receipts_amount_chk" CHECK ("amount" > 0);
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_amount_chk" CHECK ("amount" > 0);
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_amount_chk" CHECK ("amount" > 0);
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_amount_chk" CHECK ("amount" > 0);
ALTER TABLE "cash_transfers"
  ADD CONSTRAINT "cash_transfers_amount_chk" CHECK ("amount" > 0),
  ADD CONSTRAINT "cash_transfers_accounts_chk" CHECK ("fromAccountId" <> "toAccountId");
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_amount_chk" CHECK ("amount" > 0);
ALTER TABLE "contractor_jobs"
  ADD CONSTRAINT "contractor_jobs_amounts_chk" CHECK ("agreedAmount" >= 0 AND "paidAmount" >= 0);
ALTER TABLE "employee_advances"
  ADD CONSTRAINT "employee_advances_chk" CHECK ("amount" > 0 AND "monthlyDeduction" >= 0 AND "deductedAmount" >= 0 AND "deductedAmount" <= "amount" AND "installmentsCount" >= 1);
ALTER TABLE "advance_deductions" ADD CONSTRAINT "advance_deductions_amount_chk" CHECK ("amount" > 0);
ALTER TABLE "overtime_entries"
  ADD CONSTRAINT "overtime_entries_chk" CHECK ("hours" >= 0 AND "rate" >= 0 AND "amount" >= 0);
ALTER TABLE "payroll_items"
  ADD CONSTRAINT "payroll_items_chk" CHECK ("grossPay" >= 0 AND "netPay" >= 0 AND "paidAmount" >= 0 AND "paidAmount" <= "netPay");
ALTER TABLE "partners"
  ADD CONSTRAINT "partners_percent_chk" CHECK ("ownershipPercent" >= 0 AND "ownershipPercent" <= 100);
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_total_chk" CHECK ("totalAmount" >= 0);
ALTER TABLE "journal_lines"
  ADD CONSTRAINT "journal_lines_side_chk" CHECK (
    "debit" >= 0 AND "credit" >= 0
    AND NOT ("debit" > 0 AND "credit" > 0)
    AND ("debit" > 0 OR "credit" > 0)
  );

-- ---- Every journal entry must be balanced (checked at COMMIT) ----
CREATE OR REPLACE FUNCTION check_journal_entry_balanced() RETURNS trigger AS $$
DECLARE
  v_entry_id INTEGER;
  v_debit NUMERIC;
  v_credit NUMERIC;
  v_count INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'journal_lines' THEN
    IF TG_OP = 'DELETE' THEN v_entry_id := OLD."entryId"; ELSE v_entry_id := NEW."entryId"; END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN v_entry_id := OLD."id"; ELSE v_entry_id := NEW."id"; END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM "journal_entries" WHERE "id" = v_entry_id) THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM("debit"), 0), COALESCE(SUM("credit"), 0), COUNT(*)
    INTO v_debit, v_credit, v_count
    FROM "journal_lines" WHERE "entryId" = v_entry_id;

  IF v_count < 2 THEN
    RAISE EXCEPTION 'JOURNAL_UNBALANCED: entry % must have at least two lines', v_entry_id;
  END IF;
  IF v_debit <> v_credit THEN
    RAISE EXCEPTION 'JOURNAL_UNBALANCED: entry % debit % <> credit %', v_entry_id, v_debit, v_credit;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "journal_lines_balanced"
  AFTER INSERT OR UPDATE OR DELETE ON "journal_lines"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_journal_entry_balanced();

CREATE CONSTRAINT TRIGGER "journal_entries_balanced"
  AFTER INSERT ON "journal_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_journal_entry_balanced();

-- ---- The ledger is immutable: lines never change, entries only change status ----
CREATE OR REPLACE FUNCTION prevent_modification() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_RECORD: % on % is not allowed', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "journal_lines_immutable"
  BEFORE UPDATE OR DELETE ON "journal_lines"
  FOR EACH ROW EXECUTE FUNCTION prevent_modification();

CREATE OR REPLACE FUNCTION journal_entry_status_only() RETURNS trigger AS $$
BEGIN
  IF NEW."number" IS DISTINCT FROM OLD."number"
     OR NEW."date" IS DISTINCT FROM OLD."date"
     OR NEW."description" IS DISTINCT FROM OLD."description"
     OR NEW."sourceType" IS DISTINCT FROM OLD."sourceType"
     OR NEW."sourceId" IS DISTINCT FROM OLD."sourceId"
     OR NEW."totalAmount" IS DISTINCT FROM OLD."totalAmount"
     OR NEW."reversalOfId" IS DISTINCT FROM OLD."reversalOfId"
     OR NEW."createdById" IS DISTINCT FROM OLD."createdById"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: only the status of a journal entry can change';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "journal_entries_status_only"
  BEFORE UPDATE ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION journal_entry_status_only();

-- ---- Audit log is append-only ----
CREATE TRIGGER "audit_logs_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION prevent_modification();

-- ---- Financial documents are never deleted (they are cancelled instead) ----
CREATE TRIGGER "receipts_no_delete" BEFORE DELETE ON "receipts" FOR EACH ROW EXECUTE FUNCTION prevent_modification();
CREATE TRIGGER "payment_vouchers_no_delete" BEFORE DELETE ON "payment_vouchers" FOR EACH ROW EXECUTE FUNCTION prevent_modification();
CREATE TRIGGER "cash_transfers_no_delete" BEFORE DELETE ON "cash_transfers" FOR EACH ROW EXECUTE FUNCTION prevent_modification();
CREATE TRIGGER "charges_no_delete" BEFORE DELETE ON "charges" FOR EACH ROW EXECUTE FUNCTION prevent_modification();
CREATE TRIGGER "discounts_no_delete" BEFORE DELETE ON "discounts" FOR EACH ROW EXECUTE FUNCTION prevent_modification();
CREATE TRIGGER "discount_applications_no_delete" BEFORE DELETE ON "discount_applications" FOR EACH ROW EXECUTE FUNCTION prevent_modification();
CREATE TRIGGER "supplier_bills_no_delete" BEFORE DELETE ON "supplier_bills" FOR EACH ROW EXECUTE FUNCTION prevent_modification();
CREATE TRIGGER "journal_entries_no_delete" BEFORE DELETE ON "journal_entries" FOR EACH ROW EXECUTE FUNCTION prevent_modification();
CREATE TRIGGER "cheques_no_delete" BEFORE DELETE ON "cheques" FOR EACH ROW EXECUTE FUNCTION prevent_modification();

-- ---- Document numbers never change after creation ----
CREATE OR REPLACE FUNCTION prevent_number_change() RETURNS trigger AS $$
BEGIN
  IF NEW."number" IS DISTINCT FROM OLD."number" THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: document number cannot be changed (% -> %)', OLD."number", NEW."number";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "receipts_number_fixed" BEFORE UPDATE ON "receipts" FOR EACH ROW EXECUTE FUNCTION prevent_number_change();
CREATE TRIGGER "payment_vouchers_number_fixed" BEFORE UPDATE ON "payment_vouchers" FOR EACH ROW EXECUTE FUNCTION prevent_number_change();
CREATE TRIGGER "cash_transfers_number_fixed" BEFORE UPDATE ON "cash_transfers" FOR EACH ROW EXECUTE FUNCTION prevent_number_change();
CREATE TRIGGER "supplier_bills_number_fixed" BEFORE UPDATE ON "supplier_bills" FOR EACH ROW EXECUTE FUNCTION prevent_number_change();

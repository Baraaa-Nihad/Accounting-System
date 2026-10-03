-- عهدة الصناديق: كل صندوق نقدي يمكن أن يكون في عهدة موظف (مستخدم) أو شريك

-- AlterTable
ALTER TABLE "cash_accounts" ADD COLUMN     "custodianId" INTEGER,
ADD COLUMN     "partnerId" INTEGER;

-- CreateIndex
CREATE INDEX "cash_accounts_custodianId_idx" ON "cash_accounts"("custodianId");

-- CreateIndex
CREATE INDEX "cash_accounts_partnerId_idx" ON "cash_accounts"("partnerId");

-- AddForeignKey
ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_custodianId_fkey" FOREIGN KEY ("custodianId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- العهدة للصناديق النقدية فقط، ولشخص واحد: موظف أو شريك
ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_custody_check"
  CHECK (("custodianId" IS NULL AND "partnerId" IS NULL) OR ("type" = 'CASHBOX' AND ("custodianId" IS NULL OR "partnerId" IS NULL)));

-- المحاسب يستخدم كل الصناديق كما كان (الصلاحية الجديدة ضمن دوره الافتراضي)
UPDATE "roles" SET "permissions" = array_append("permissions", 'treasury.all_boxes')
WHERE "key" = 'accountant' AND NOT ('treasury.all_boxes' = ANY("permissions"));

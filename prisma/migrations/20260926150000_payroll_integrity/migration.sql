-- سلامة بيانات الرواتب (docs/08-edge-cases.md §8.4)

-- مسير واحد فقط لكل شهر (المسيرات الملغاة لا تُحتسب)
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_month_chk" CHECK ("month" BETWEEN 1 AND 12 AND "year" BETWEEN 2000 AND 2200);
CREATE UNIQUE INDEX "payroll_runs_one_per_month" ON "payroll_runs" ("year", "month") WHERE "status" <> 'CANCELLED';

-- المسيرات لا تُحذف (تُلغى)
CREATE TRIGGER "payroll_runs_no_delete" BEFORE DELETE ON "payroll_runs" FOR EACH ROW EXECUTE FUNCTION prevent_modification();

-- بعد اعتماد المسير: مبالغ البنود ثابتة؛ يتغير فقط المدفوع وحالة الدفع والملاحظات
CREATE OR REPLACE FUNCTION payroll_item_guard() RETURNS trigger AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT "status"::text INTO v_status FROM "payroll_runs" WHERE "id" = OLD."payrollRunId";
  IF v_status = 'DRAFT' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: items of an approved or cancelled payroll run cannot be deleted';
  END IF;
  IF NEW."payrollRunId" IS DISTINCT FROM OLD."payrollRunId"
     OR NEW."employeeId" IS DISTINCT FROM OLD."employeeId"
     OR NEW."rate" IS DISTINCT FROM OLD."rate"
     OR NEW."basicPay" IS DISTINCT FROM OLD."basicPay"
     OR NEW."absenceDeduction" IS DISTINCT FROM OLD."absenceDeduction"
     OR NEW."lateDeduction" IS DISTINCT FROM OLD."lateDeduction"
     OR NEW."overtimeAmount" IS DISTINCT FROM OLD."overtimeAmount"
     OR NEW."bonuses" IS DISTINCT FROM OLD."bonuses"
     OR NEW."allowances" IS DISTINCT FROM OLD."allowances"
     OR NEW."otherDeductions" IS DISTINCT FROM OLD."otherDeductions"
     OR NEW."withholdings" IS DISTINCT FROM OLD."withholdings"
     OR NEW."advanceDeduction" IS DISTINCT FROM OLD."advanceDeduction"
     OR NEW."grossPay" IS DISTINCT FROM OLD."grossPay"
     OR NEW."totalDeductions" IS DISTINCT FROM OLD."totalDeductions"
     OR NEW."netPay" IS DISTINCT FROM OLD."netPay" THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: amounts of an approved payroll run cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payroll_items_guard"
  BEFORE UPDATE OR DELETE ON "payroll_items"
  FOR EACH ROW EXECUTE FUNCTION payroll_item_guard();

-- البند: الصافي = الإجمالي − مجموع الخصومات
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_net_chk" CHECK ("netPay" = "grossPay" - "totalDeductions");

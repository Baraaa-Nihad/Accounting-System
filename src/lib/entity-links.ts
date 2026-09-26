/** رابط صفحة الكيان من سجل النشاط (إن وُجدت صفحة له). */
const ROUTES: Record<string, (id: string) => string> = {
  Student: (id) => `/students/${id}`,
  Guardian: (id) => `/families/${id}`,
  Charge: (id) => `/charges/${id}`,
  Receipt: (id) => `/receipts/${id}`,
  PaymentVoucher: (id) => `/vouchers/${id}`,
  Employee: (id) => `/employees/${id}`,
  PayrollRun: (id) => `/payroll/${id}`,
  Supplier: (id) => `/suppliers/${id}`,
  SupplierBill: (id) => `/suppliers/bills/${id}`,
  Contractor: (id) => `/contractors/${id}`,
  ContractorJob: (id) => `/contractors/jobs/${id}`,
  CashAccount: (id) => `/treasury/${id}`,
  Partner: (id) => `/partners/${id}`,
  User: (id) => `/users/${id}`,
  ImportBatch: (id) => `/import/${id}`,
  JournalEntry: (id) => `/accounting/journal/${id}`,
  Report: (id) => `/reports/${id}`,
}

export function entityHref(entityType: string, entityId: string | null | undefined): string | null {
  if (!entityId) return null
  const route = ROUTES[entityType]
  if (!route) return null
  if (entityType !== 'Report' && !/^\d+$/.test(entityId)) return null
  return route(entityId)
}

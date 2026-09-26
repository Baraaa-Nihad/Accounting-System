import { systemCtx, type Ctx } from '@/server/context'

export function testCtx(name = 'اختبار'): Ctx {
  return systemCtx(name)
}

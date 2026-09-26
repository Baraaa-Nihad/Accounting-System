'use client'

import * as React from 'react'
import { Direction } from 'radix-ui'
import type { FormatConfig } from '@/lib/format'
import { makeFormatters } from '@/lib/format-jsx'
import type { Permission } from '@/lib/permissions'

export interface AppContextValue {
  format: FormatConfig
  user: { id: number; fullName: string; username: string; roleName: string } | null
  permissions: Permission[]
  currentYear: { id: number; name: string } | null
  selectedYear: { id: number; name: string } | null
  years: { id: number; name: string; status: string; isCurrent: boolean }[]
  today: string
  schoolName: string
}

const AppContext = React.createContext<AppContextValue | null>(null)

export function AppProvider({ value, children }: { value: AppContextValue; children: React.ReactNode }) {
  return (
    <AppContext.Provider value={value}>
      <Direction.Provider dir="rtl">{children}</Direction.Provider>
    </AppContext.Provider>
  )
}

export function useApp(): AppContextValue {
  const ctx = React.useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}

export function useFormat() {
  const { format } = useApp()
  return React.useMemo(() => makeFormatters(format), [format])
}

export function useCan() {
  const { permissions } = useApp()
  return React.useCallback((p: Permission) => permissions.includes(p), [permissions])
}

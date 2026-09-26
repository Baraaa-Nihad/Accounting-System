'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Command } from 'cmdk'
import { Dialog as D } from 'radix-ui'
import { Search, GraduationCap, Users, ArrowDownToLine, ArrowUpFromLine, UserRound, Truck, Hammer, Loader2, FileText, ArrowLeftRight } from 'lucide-react'

interface SearchResult {
  type: 'student' | 'guardian' | 'receipt' | 'voucher' | 'bill' | 'transfer' | 'employee' | 'supplier' | 'contractor'
  id: number
  title: string
  subtitle?: string
  href: string
}

const GROUPS: Record<SearchResult['type'], { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  student: { label: 'الطلاب', icon: GraduationCap },
  guardian: { label: 'أولياء الأمور', icon: Users },
  receipt: { label: 'سندات القبض', icon: ArrowDownToLine },
  voucher: { label: 'سندات الصرف', icon: ArrowUpFromLine },
  bill: { label: 'فواتير الموردين', icon: FileText },
  transfer: { label: 'التحويلات', icon: ArrowLeftRight },
  employee: { label: 'الموظفون', icon: UserRound },
  supplier: { label: 'الموردون', icon: Truck },
  contractor: { label: 'العمال والمقاولون', icon: Hammer },
}

export function GlobalSearch() {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<SearchResult[]>([])
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'ك')) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  React.useEffect(() => {
    const q = query.trim()
    if (!q) return
    const controller = new AbortController()
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        if (res.ok) setResults((await res.json()).results)
      } catch {
        /* تم الإلغاء */
      } finally {
        setLoading(false)
      }
    }, 180)
    return () => {
      clearTimeout(t)
      controller.abort()
    }
  }, [query])

  const hasQuery = query.trim().length > 0
  const grouped = React.useMemo(() => {
    const map = new Map<SearchResult['type'], SearchResult[]>()
    if (!hasQuery) return map
    for (const r of results) map.set(r.type, [...(map.get(r.type) ?? []), r])
    return map
  }, [results, hasQuery])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-10 w-full max-w-md items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500 hover:border-slate-300 hover:bg-white"
      >
        <Search className="size-4" />
        <span className="flex-1 truncate text-start">ابحث عن طالب، رقم هاتف، رقم سند...</span>
        <kbd className="hidden rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-400 sm:inline" dir="ltr">
          Ctrl K
        </kbd>
      </button>
      <D.Root open={open} onOpenChange={setOpen}>
        <D.Portal>
          <D.Overlay className="fixed inset-0 z-50 bg-slate-900/40" />
          <D.Content dir="rtl" className="fixed left-1/2 top-[12vh] z-50 w-[calc(100%-1.5rem)] max-w-2xl -translate-x-1/2 overflow-hidden rounded-2xl bg-white shadow-2xl">
            <D.Title className="sr-only">البحث السريع</D.Title>
            <D.Description className="sr-only">ابحث في الطلاب والسندات والموظفين والموردين</D.Description>
            <Command shouldFilter={false} label="البحث السريع">
              <div className="flex items-center gap-2 border-b border-slate-100 px-4">
                <Search className="size-5 text-slate-400" />
                <Command.Input
                  value={query}
                  onValueChange={setQuery}
                  placeholder="اسم الطالب، رقم الطالب، هاتف ولي الأمر، REC-2026-000123..."
                  className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-slate-400"
                />
                {loading ? <Loader2 className="size-4 animate-spin text-slate-400" /> : null}
              </div>
              <Command.List className="scroll-thin max-h-[60vh] overflow-y-auto p-2">
                {query.trim() && !loading ? (
                  <Command.Empty className="px-3 py-10 text-center text-sm text-slate-500">لا توجد نتائج مطابقة</Command.Empty>
                ) : null}
                {!query.trim() ? (
                  <p className="px-3 py-8 text-center text-sm text-slate-400">اكتب للبحث في كل النظام</p>
                ) : null}
                {Array.from(grouped.entries()).map(([type, items]) => {
                  const G = GROUPS[type]
                  return (
                    <Command.Group
                      key={type}
                      heading={G.label}
                      className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-slate-400"
                    >
                      {items.map((r) => (
                        <Command.Item
                          key={`${r.type}-${r.id}`}
                          value={`${r.type}-${r.id}`}
                          onSelect={() => {
                            setOpen(false)
                            setQuery('')
                            router.push(r.href)
                          }}
                          className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 data-[selected=true]:bg-brand-50"
                        >
                          <G.icon className="size-4 text-slate-400" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium text-slate-800">{r.title}</span>
                            {r.subtitle ? <span className="block truncate text-xs text-slate-500">{r.subtitle}</span> : null}
                          </span>
                        </Command.Item>
                      ))}
                    </Command.Group>
                  )
                })}
              </Command.List>
            </Command>
          </D.Content>
        </D.Portal>
      </D.Root>
    </>
  )
}

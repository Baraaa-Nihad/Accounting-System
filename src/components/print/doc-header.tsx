import type { Settings } from '@/server/settings'

/** ترويسة المستندات الرسمية: الشعار واسم المدرسة وبياناتها. */
export function DocHeader({ school, print, title, meta }: { school: Settings['school']; print: Settings['print']; title: string; meta?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 border-b-2 border-slate-800 pb-4">
      <div className="flex items-center gap-4">
        {print.showLogo && school.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/api/logo" alt="" className="size-16 object-contain" />
        ) : null}
        <div>
          <p className="text-xl font-bold text-slate-900">{school.name}</p>
          {school.nameEn ? <p className="text-sm text-slate-600" dir="ltr">{school.nameEn}</p> : null}
          <p className="mt-0.5 text-xs text-slate-600">
            {[school.address, school.phone ? `هاتف: ${school.phone}` : null, school.email].filter(Boolean).join(' — ')}
          </p>
          {print.headerNote ? <p className="text-xs text-slate-500">{print.headerNote}</p> : null}
        </div>
      </div>
      <div className="text-end">
        <p className="text-2xl font-bold text-slate-900">{title}</p>
        {meta}
      </div>
    </div>
  )
}

export function Signatures({ labels }: { labels: string[] }) {
  if (!labels.length) return null
  return (
    <div className="mt-10 grid gap-8" style={{ gridTemplateColumns: `repeat(${labels.length}, minmax(0, 1fr))` }}>
      {labels.map((l) => (
        <div key={l} className="text-center">
          <div className="mx-auto mb-1 h-10 w-40 border-b border-dotted border-slate-500" />
          <p className="text-sm text-slate-700">{l}</p>
        </div>
      ))}
    </div>
  )
}

export function CancelledStamp({ reason }: { reason?: string | null }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="-rotate-12 rounded-2xl border-8 border-rose-500/70 px-10 py-4 text-center text-rose-600/80">
        <p className="text-6xl font-black">ملغي</p>
        {reason ? <p className="mt-1 max-w-sm text-sm font-bold">{reason}</p> : null}
      </div>
    </div>
  )
}

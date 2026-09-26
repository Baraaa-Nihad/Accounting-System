import * as React from 'react'
import { Inbox } from 'lucide-react'

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  icon?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 [&_svg]:size-6">
        {icon ?? <Inbox />}
      </div>
      <p className="text-base font-semibold text-slate-800">{title}</p>
      {description ? <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p> : null}
      {action ? <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  )
}

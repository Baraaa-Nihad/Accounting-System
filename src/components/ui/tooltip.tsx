'use client'

import * as React from 'react'
import { Tooltip as T } from 'radix-ui'
import { Info } from 'lucide-react'

export function Hint({ children, content }: { children?: React.ReactNode; content: React.ReactNode }) {
  return (
    <T.Provider delayDuration={150}>
      <T.Root>
        <T.Trigger asChild>
          {children ?? (
            <button type="button" className="inline-flex text-slate-400 hover:text-slate-600" aria-label="شرح">
              <Info className="size-4" />
            </button>
          )}
        </T.Trigger>
        <T.Portal>
          <T.Content
            sideOffset={6}
            className="z-50 max-w-xs rounded-lg bg-slate-900 px-3 py-2 text-xs leading-relaxed text-white shadow-lg"
          >
            {content}
            <T.Arrow className="fill-slate-900" />
          </T.Content>
        </T.Portal>
      </T.Root>
    </T.Provider>
  )
}

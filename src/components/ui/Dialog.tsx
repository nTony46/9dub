import * as D from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** Right-hand sheet for previews and detail; keeps the draft board visible. */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  width = 560,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  width?: number
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <D.Content
          style={{ width: `min(${width}px, 100vw)` }}
          className="anim-sheet fixed inset-y-0 right-0 z-50 flex flex-col border-l border-seam-strong bg-floor shadow-pop outline-none"
        >
          <div className="flex items-start justify-between gap-3 border-b border-seam px-5 py-3.5">
            <div className="min-w-0">
              <D.Title className="truncate font-display text-[22px] font-semibold leading-tight tracking-tight">{title}</D.Title>
              {description ? (
                <D.Description asChild>
                  <div className="mt-0.5 text-[12px] text-chalk-3">{description}</div>
                </D.Description>
              ) : (
                <D.Description className="sr-only">Details</D.Description>
              )}
            </div>
            <D.Close className="-mr-1 rounded-md p-1.5 text-chalk-3 hover:bg-stand hover:text-chalk" aria-label="Close">
              <X size={16} />
            </D.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <D.Content
          className={cn(
            'anim-pop fixed left-1/2 top-[8vh] z-50 flex max-h-[84vh] w-[min(720px,calc(100vw-32px))] -translate-x-1/2 flex-col rounded-xl border border-seam-strong bg-floor shadow-pop outline-none',
            className,
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-seam px-5 py-3">
            <div>
              <D.Title className="font-display text-[19px] font-semibold tracking-tight">{title}</D.Title>
              {description ? <D.Description className="mt-0.5 text-[12px] text-chalk-3">{description}</D.Description> : <D.Description className="sr-only">Dialog</D.Description>}
            </div>
            <D.Close className="-mr-1 rounded-md p-1.5 text-chalk-3 hover:bg-stand hover:text-chalk" aria-label="Close">
              <X size={16} />
            </D.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}

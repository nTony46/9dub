import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export function Panel({
  title,
  actions,
  children,
  className,
  bodyClassName,
  subtitle,
}: {
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={cn('rounded-lg border border-seam bg-floor', className)}>
      {title || actions ? (
        <header className="flex items-center justify-between gap-2 px-4 pb-2 pt-3.5">
          <div className="min-w-0">
            {title ? <h2 className="label-caps">{title}</h2> : null}
            {subtitle ? <div className="mt-1 text-[12.5px] leading-snug text-chalk-3">{subtitle}</div> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cn('px-4 pb-4', !title && !actions && 'pt-4', bodyClassName)}>{children}</div>
    </section>
  )
}

export function Empty({ title, children, icon }: { title: ReactNode; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 px-6 py-8 text-center">
      {icon ? <div className="mb-1 text-chalk-4">{icon}</div> : null}
      <div className="text-[14px] font-medium text-chalk-2">{title}</div>
      {children ? <div className="max-w-[360px] text-[13px] leading-relaxed text-chalk-3 text-pretty">{children}</div> : null}
    </div>
  )
}

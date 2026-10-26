import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

/** Segmented control (single choice). Arrow keys move between options. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'sm',
  label,
  className,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode; title?: string }[]
  size?: 'xs' | 'sm'
  label: string
  className?: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('inline-flex items-center rounded-md border border-seam bg-well p-0.5', className)}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
        const i = options.findIndex((o) => o.value === value)
        const n = options[(i + (e.key === 'ArrowRight' ? 1 : options.length - 1)) % options.length]
        onChange(n.value)
        e.preventDefault()
      }}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              'whitespace-nowrap rounded-[5px] font-medium transition-colors duration-100',
              size === 'xs' ? 'h-6 px-2 text-[12px]' : 'h-7 px-3 text-[13px]',
              active ? 'bg-stand text-chalk shadow-[0_0_0_1px_var(--seam-strong)]' : 'text-chalk-3 hover:text-chalk',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        'h-8 w-full rounded-md border border-seam bg-well px-2.5 text-[13px] text-chalk placeholder:text-chalk-4 focus:border-clock-line focus:outline-none',
        className,
      )}
      {...rest}
    />
  )
})

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-8 rounded-md border border-seam bg-well px-2 pr-7 text-[12.5px] text-chalk focus:border-clock-line focus:outline-none',
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  )
}

export function Switch({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; id?: string }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn('relative h-[18px] w-8 shrink-0 rounded-full border transition-colors', checked ? 'border-clock-line bg-clock' : 'border-seam-strong bg-well')}
    >
      <span
        className={cn(
          'absolute top-[2px] h-3 w-3 rounded-full transition-transform duration-150',
          checked ? 'translate-x-[15px] bg-clock-ink' : 'translate-x-[2px] bg-chalk-3',
        )}
      />
    </button>
  )
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cn('inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-[4px] border border-seam-strong bg-stand px-1 font-mono text-[10px] text-chalk-3', className)}>
      {children}
    </kbd>
  )
}

export function Field({ label, hint, children, htmlFor }: { label: ReactNode; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-[12px] font-medium text-chalk-2">
        {label}
      </label>
      {children}
      {hint ? <div className="text-[11.5px] leading-snug text-chalk-3">{hint}</div> : null}
    </div>
  )
}

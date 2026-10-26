import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'default' | 'ghost' | 'danger' | 'subtle'
type Size = 'xs' | 'sm' | 'md'

const VARIANT: Record<Variant, string> = {
  primary: 'bg-clock text-clock-ink hover:brightness-110 font-semibold',
  default: 'bg-stand text-chalk border border-seam-strong hover:bg-booth',
  subtle: 'bg-transparent text-chalk-2 border border-seam hover:bg-stand hover:text-chalk',
  ghost: 'bg-transparent text-chalk-2 hover:bg-stand hover:text-chalk',
  danger: 'bg-transparent text-bad border border-seam hover:bg-bad/10',
}
const SIZE: Record<Size, string> = {
  xs: 'h-6 px-2 text-[12px] gap-1 rounded-[5px]',
  sm: 'h-7 px-3 text-[13px] gap-1.5 rounded-md',
  md: 'h-9 px-3.5 text-[13.5px] gap-2 rounded-md',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'sm', className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-[background-color,color,filter,transform] duration-100 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    />
  )
})

export function IconButton({ label, className, size = 'sm', ...rest }: ButtonProps & { label: string }) {
  return (
    <Button
      aria-label={label}
      title={label}
      variant="ghost"
      size={size}
      className={cn(size === 'xs' ? 'w-6 px-0' : 'w-7 px-0', className)}
      {...rest}
    />
  )
}

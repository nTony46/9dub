import * as T from '@radix-ui/react-tooltip'
import { isValidElement, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export const TooltipProvider = T.Provider

export function Tip({
  content,
  children,
  side = 'top',
  className,
  delay,
}: {
  content: ReactNode
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  className?: string
  delay?: number
}) {
  if (content == null || content === '') return <>{children}</>
  return (
    <T.Root delayDuration={delay}>
      <T.Trigger asChild>{isValidElement(children) ? children : <span>{children}</span>}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className={cn(
            'anim-pop z-50 max-w-[300px] rounded-md bg-booth px-2.5 py-2 text-[12px] leading-snug text-chalk-2 shadow-pop',
            className,
          )}
        >
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  )
}

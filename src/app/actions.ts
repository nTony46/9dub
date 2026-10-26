import { toast } from 'sonner'
import { useApp } from '@/store/appStore'

/** Draft a player with toast feedback and one-click undo. Shared by every draft entry point. */
export function draftWithToast(playerId: string, opts?: { overall?: number; teamIndex?: number }): boolean {
  const res = useApp.getState().draftPlayer(playerId, opts)
  if (!res.ok) {
    toast.error(res.error)
    return false
  }
  toast.success(res.message, {
    id: 'draft-pick',
    duration: 4000,
    action: { label: 'Undo', onClick: () => undoWithToast() },
  })
  return true
}

export function undoWithToast(): void {
  const msg = useApp.getState().undo()
  if (msg) toast(msg, { id: 'draft-undo', duration: 1800 })
  else toast('Nothing to undo', { id: 'draft-undo', duration: 1500 })
}

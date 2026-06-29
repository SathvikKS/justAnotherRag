import { toast } from "sonner"

type ToastOptions = {
  description?: string
  duration?: number
}

export function showSuccessToast(message: string, options?: ToastOptions) {
  toast.success(message, options)
}

export function showErrorToast(message: string, options?: ToastOptions) {
  toast.error(message, options)
}

export function showWarningToast(message: string, options?: ToastOptions) {
  toast.warning(message, options)
}

export function showInfoToast(message: string, options?: ToastOptions) {
  toast.info(message, options)
}

"use client"

import { Toaster } from "sonner"

export function ToastProvider() {
  return (
    <Toaster
      position="top-right"
      expand={false}
      richColors
      closeButton
      duration={5000}
      toastOptions={{
        style: {
          background: 'white',
          border: '1px solid #e2e8f0',
          padding: '16px',
          boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
        },
      }}
    />
  )
}

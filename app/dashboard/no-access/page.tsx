"use client"

import { AccessDenied } from '@/components/AccessDenied'

export default function NoAccessPage() {
  return <AccessDenied title="Restricted NJSS Area" message="Your current role does not include permission to open this page or function." />
}

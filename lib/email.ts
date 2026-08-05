// Email Service Integration (Placeholder)
// To enable: Set RESEND_API_KEY in environment variables and implement templates

export type EmailTemplate =
  | 'ff3_submitted'
  | 'ff3_approved'
  | 'ff3_rejected'
  | 'ff4_submitted'
  | 'ff4_paid'
  | 'budget_low'
  | 'budget_exceeded'
  | 'commitment_expiring'
  | 'password_reset'
  | 'welcome'

export type EmailOptions = {
  to: string | string[]
  subject: string
  template: EmailTemplate
  data: Record<string, unknown>
}

// Placeholder - logs email instead of sending
export async function sendEmail(options: EmailOptions): Promise<{ success: boolean; error?: string }> {
  console.log('📧 Email notification (not sent - email service disabled):', {
    to: options.to,
    subject: options.subject,
    template: options.template,
  })
  return { success: true }
}

// Convenience functions - all return success without sending
export async function sendFF3SubmittedEmail(to: string, data: {
  ff3_number: string
  purpose: string
  amount: number
  department?: string
  submittedBy?: string
  actionUrl: string
}) {
  console.log('📧 FF3 Submitted email (disabled):', { to, ff3_number: data.ff3_number })
  return { success: true }
}

export async function sendFF3ApprovedEmail(to: string, data: {
  ff3_number: string
  amount: number
  commitmentNumber?: string
  approvedBy?: string
}) {
  console.log('📧 FF3 Approved email (disabled):', { to, ff3_number: data.ff3_number })
  return { success: true }
}

export async function sendFF3RejectedEmail(to: string, data: {
  ff3_number: string
  amount: number
  reason: string
}) {
  console.log('📧 FF3 Rejected email (disabled):', { to, ff3_number: data.ff3_number })
  return { success: true }
}

export async function sendFF4PaidEmail(to: string, data: {
  ff4_number: string
  payee: string
  amount: number
  reference: string
  paymentDate: string
}) {
  console.log('📧 FF4 Paid email (disabled):', { to, ff4_number: data.ff4_number })
  return { success: true }
}

export async function sendBudgetLowEmail(to: string | string[], data: {
  percentage: number
  availableBalance: number
  totalReleased: number
  financialYear?: number
}) {
  console.log('📧 Budget Low email (disabled):', { to, percentage: data.percentage })
  return { success: true }
}

export async function sendBudgetExceededEmail(to: string | string[], data: {
  requestedAmount: number
  availableBalance: number
  ff3Number?: string
  requestedBy?: string
  purpose?: string
}) {
  console.log('📧 Budget Exceeded email (disabled):', { to, requestedAmount: data.requestedAmount })
  return { success: true }
}

export async function sendCommitmentExpiringEmail(to: string, data: {
  commitmentNumber: string
  ff3Number?: string
  committedAmount: number
  paidAmount?: number
  daysRemaining: number
  expiryDate: string
  actionUrl: string
}) {
  console.log('📧 Commitment Expiring email (disabled):', { to, commitmentNumber: data.commitmentNumber })
  return { success: true }
}

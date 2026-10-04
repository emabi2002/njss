import { redirect } from 'next/navigation'

export default function RetiredBudgetPage() {
  redirect('/dashboard/budget/adjustments')
}

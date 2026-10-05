import Link from 'next/link'

export default function ReportsPage() {
  return <div className="space-y-6">
    <h1 className="text-2xl font-bold text-slate-900">Head Office Reports</h1>
    <p className="text-slate-600">Report the active annual budget by Division, Section and Ledger. Preparation budgets are reviewed in the annual budget workspace.</p>
    <Link href="/dashboard/reports/management" className="block rounded-lg border border-slate-200 bg-white p-6 hover:border-png-red">
      <h2 className="text-lg font-semibold">Annual Budget Position & Transaction Trace</h2>
      <p className="mt-2 text-sm text-slate-600">Original budget, supplementary adjustments, reallocations, current approved budget, commitments, expenditure and available budget. Drill down to linked FF3 and FF4 records and export authorised results.</p>
    </Link>
  </div>
}

import Link from "next/link"
import { ArrowLeft, Bot, ShieldCheck } from "lucide-react"
import { AiReportPanel } from "@/components/reports/AiReportPanel"

export default function AiReportingPage() {
  return (
    <main className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/dashboard/reports"
            className="mb-3 inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Management Reports
          </Link>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#132A44] text-white shadow-sm">
              <Bot className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">AI Report Assistant</h1>
              <p className="mt-1 text-sm text-slate-500">Natural-language reporting for NJSS budget, funding, FF3, FF4, suppliers and audit data.</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
          <ShieldCheck className="h-4 w-4" />
          User permissions and RLS remain authoritative
        </div>
      </div>

      <AiReportPanel />
    </main>
  )
}

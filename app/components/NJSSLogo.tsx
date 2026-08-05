export function NJSSLogo({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    <div
      className={`relative flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/png-emblem.png"
        alt="Papua New Guinea National Emblem"
        width={size}
        height={size}
        className="object-contain"
        style={{ width: size, height: size }}
      />
    </div>
  )
}

export function NJSSLogoFull({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <NJSSLogo size={48} />
      <div>
        <h1 className="text-lg font-bold text-slate-900 leading-tight">NJSS</h1>
        <p className="text-xs text-slate-600 leading-tight">National Judiciary Staff Services</p>
        <p className="text-[10px] text-slate-500">Papua New Guinea</p>
      </div>
    </div>
  )
}

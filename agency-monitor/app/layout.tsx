import type { Metadata } from 'next'
import './styles.css'
export const metadata: Metadata = {
  title: 'Agency Internal Expenditure Monitor',
  description: 'Independent requisition, purchase history, and repeat-purchase review for government agencies',
}
export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) {
  return <html lang="en"><body>{children}</body></html>
}

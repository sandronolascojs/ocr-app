import { ThemeProvider } from "@/components/theme-provider"
import { TRPCProvider } from "@/trpc/client"
import "@/app/globals.css"
import { Inter } from "next/font/google"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { APP } from "@/constants/app.constants"

const inter = Inter({ subsets: ["latin"] })

export const metadata = {
  title: APP.name,
  description: APP.description,
}

interface RootLayoutProps {
  children: ReactNode
}

const RootLayout = ({ children }: RootLayoutProps) => (
  <html lang="en" suppressHydrationWarning>
    <head />
    <body
      className={cn(
        inter.className,
        "bg-background font-sans antialiased text-foreground"
      )}
    >
      <TRPCProvider>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <div className="flex min-h-screen w-full justify-center bg-background">
            <main className="flex w-full max-w-6xl flex-1 flex-col px-4 py-10 sm:px-8 lg:px-12">
              {children}
            </main>
          </div>
        </ThemeProvider>
      </TRPCProvider>
    </body>
  </html>
)

export default RootLayout
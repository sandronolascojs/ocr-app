import { ThemeProvider } from "@/components/theme-provider"
import { TRPCProvider } from "@/trpc/client"
import { NuqsAdapter } from "nuqs/adapters/next/app"
import "@/app/globals.css"
import { Inter, JetBrains_Mono } from "next/font/google"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { APP } from "@/constants/app.constants"

const inter = Inter({ subsets: ["latin"] })
const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

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
        jetBrainsMono.variable,
        "bg-background font-sans antialiased text-foreground"
      )}
    >
        <TRPCProvider>
          <NuqsAdapter>
            <ThemeProvider
              attribute="class"
              defaultTheme="system"
              enableSystem
              disableTransitionOnChange
            >
              {children}
            </ThemeProvider>
          </NuqsAdapter>
        </TRPCProvider>
    </body>
  </html>
)

export default RootLayout
import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/ui/toast";

export const metadata: Metadata = {
  title: "LEADHUNTER AI",
  description: "Поиск клиентов, управление лидами и AI-поддержка продаж",
};

export const viewport: Viewport = { themeColor: "#0c0e16", width: "device-width", initialScale: 1 };

const themeScript = `try{var t=localStorage.getItem("lh-theme");if(t)document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}

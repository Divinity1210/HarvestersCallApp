import "./globals.css";
import { AuthProvider } from "@/hooks/useAuth";

export const metadata = {
  title: "Harvesters Call App — AI-Powered QA Call Center",
  description: "Harvesters International Christian Centre — AI-powered follow-up call system for conferences and church events.",
  keywords: ["Harvesters", "NLP", "Call Center", "QA", "AI"],
  icons: {
    icon: "/harvesters-icon.png",
    apple: "/harvesters-icon.png",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}

import "../styles/globals.css";
import { ReactNode } from "react";

export const metadata = {
  title: "Rainmaker",
  description: "A beautiful multichain multisender dApp",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

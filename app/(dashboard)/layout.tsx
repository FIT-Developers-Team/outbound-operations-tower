import { AppShell } from "@/components/layout/app-shell";
import { OutboundProvider } from "@/components/outbound/outbound-provider";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <OutboundProvider>
      <AppShell>{children}</AppShell>
    </OutboundProvider>
  );
}

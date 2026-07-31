import type { Metadata } from "next";
import { AdminSignIn } from "@/components/auth/admin-signin";

export const metadata: Metadata = {
  title: "Masuk admin",
  robots: { index: false, follow: false },
};

export default function MasukPage() {
  return <AdminSignIn />;
}

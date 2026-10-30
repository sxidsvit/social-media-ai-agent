import { redirect } from "next/navigation";

// Integrations is the only settings section so far
export default function SettingsPage() {
  redirect("/dashboard/settings/integrations");
}

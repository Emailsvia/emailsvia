import AppShell from "@/components/AppShell";
import CampaignForm from "@/components/CampaignForm";
import { getUser } from "@/lib/auth-server";
import { loadUserSettings } from "@/lib/user-settings";

export const dynamic = "force-dynamic";

export default async function NewCampaignPage() {
  const u = await getUser();
  const settings = u ? await loadUserSettings(u.id) : null;
  return (
    <AppShell>
      <CampaignForm mode="new" trackingDefault={settings?.tracking_enabled_default ?? false} />
    </AppShell>
  );
}

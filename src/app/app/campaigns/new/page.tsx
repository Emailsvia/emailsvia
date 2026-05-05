import AppShell from "@/components/AppShell";
import CampaignForm from "@/components/CampaignForm";

export default function NewCampaignPage() {
  return (
    <AppShell>
      <CampaignForm mode="new" />
    </AppShell>
  );
}

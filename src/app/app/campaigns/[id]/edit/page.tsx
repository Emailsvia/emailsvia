"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import CampaignForm, { type CampaignInitial } from "@/components/CampaignForm";
import AppShell from "@/components/AppShell";

type FollowUpStep = { step_number: number; delay_days: number; subject: string | null; template: string };

export default function EditCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [initial, setInitial] = useState<CampaignInitial | null>(null);
  const [steps, setSteps] = useState<FollowUpStep[]>([]);

  useEffect(() => {
    let cancel = false;
    Promise.all([
      fetch(`/api/campaigns/${id}`, { cache: "no-store" }).then((r) => r.json()),
      fetch(`/api/campaigns/${id}/follow-ups`, { cache: "no-store" }).then((r) => r.json()),
    ]).then(([c, fu]) => {
      if (cancel) return;
      if (!c.campaign) { router.push("/app"); return; }
      const camp = c.campaign;
      setInitial({
        id: camp.id,
        name: camp.name,
        subject: camp.subject,
        template: camp.template,
        sender_id: camp.sender_id,
        schedule: camp.schedule,
        daily_cap: camp.daily_cap,
        gap_seconds: camp.gap_seconds,
        follow_ups_enabled: camp.follow_ups_enabled ?? false,
        retry_enabled: camp.retry_enabled ?? false,
        max_retries: camp.max_retries ?? 2,
        tracking_enabled: camp.tracking_enabled ?? false,
        unsubscribe_enabled: camp.unsubscribe_enabled ?? true,
        attachment_path: camp.attachment_path ?? null,
        attachment_filename: camp.attachment_filename ?? null,
        attachment_paths: camp.attachment_paths ?? [],
        attachment_filenames: camp.attachment_filenames ?? [],
        known_vars: camp.known_vars ?? [],
        start_at: camp.start_at ?? null,
      });
      setSteps(fu.steps ?? []);
    });
    return () => { cancel = true; };
  }, [id, router]);

  if (!initial) {
    return (
      <AppShell>
        <div className="page space-y-4">
          <div className="h-7 w-32 rounded bg-ink-100 animate-pulse" />
          <div className="h-10 w-2/3 rounded bg-ink-100 animate-pulse" />
          <div className="h-4 w-1/3 rounded bg-ink-100 animate-pulse" />
          <div className="grid grid-cols-1 lg:grid-cols-[1fr,320px] gap-8 mt-6">
            <div className="space-y-3">
              <div className="h-72 rounded-xl bg-ink-100 animate-pulse" />
              <div className="h-40 rounded-xl bg-ink-100 animate-pulse" />
            </div>
            <div className="space-y-3">
              <div className="h-32 rounded-xl bg-ink-100 animate-pulse" />
              <div className="h-32 rounded-xl bg-ink-100 animate-pulse" />
            </div>
          </div>
        </div>
      </AppShell>
    );
  }
  return <AppShell><CampaignForm mode="edit" initial={initial} initialSteps={steps} /></AppShell>;
}

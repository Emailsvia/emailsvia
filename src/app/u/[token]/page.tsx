import { supabaseAdmin } from "@/lib/supabase";
import { verifyToken } from "@/lib/tokens";
import UnsubscribeClient from "./UnsubscribeClient";
import Logo from "@/components/Logo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const id = verifyToken("u", token);

  if (!id) {
    return (
      <Shell>
        <h1 className="text-[20px] font-semibold mb-2">Invalid link</h1>
        <p className="text-[14px] text-ink-600">
          This link isn't valid or has expired. If you'd like to stop receiving emails, reply to the sender directly.
        </p>
      </Shell>
    );
  }

  const db = supabaseAdmin();
  const { data: recipient } = await db
    .from("recipients")
    .select("email, campaign_id, status")
    .eq("id", id)
    .maybeSingle();

  if (!recipient) {
    return (
      <Shell>
        <h1 className="text-[20px] font-semibold mb-2">Not found</h1>
        <p className="text-[14px] text-ink-600">We couldn't find your subscription.</p>
      </Shell>
    );
  }

  const already = recipient.status === "unsubscribed";

  return (
    <Shell>
      {already ? (
        <>
          <h1 className="text-[20px] font-semibold mb-2">You're unsubscribed</h1>
          <p className="text-[14px] text-ink-600">
            No more messages will reach <b className="text-ink">{recipient.email}</b>.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-[20px] font-semibold mb-2">Unsubscribe?</h1>
          <p className="text-[14px] text-ink-600 mb-6">
            We'll stop emailing <b className="text-ink">{recipient.email}</b> from this sender, including any scheduled follow-ups.
          </p>
          <UnsubscribeClient token={token} email={recipient.email} />
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-paper flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 mb-8 text-ink">
          <Logo size={24} />
          <span className="font-semibold text-[15px] tracking-tight">EmailsVia</span>
        </div>
        {children}
      </div>
    </div>
  );
}

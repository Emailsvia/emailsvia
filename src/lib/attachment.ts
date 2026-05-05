import type { SupabaseClient } from "@supabase/supabase-js";

export async function downloadAttachment(
  db: SupabaseClient,
  path: string,
  filename: string
): Promise<{ filename: string; content: Buffer } | null> {
  const { data, error } = await db.storage.from("attachments").download(path);
  if (error || !data) return null;
  const ab = await data.arrayBuffer();
  return { filename, content: Buffer.from(ab) };
}

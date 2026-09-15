import { z } from "zod";

// Optional Gmail "Send mail as" alias on a sender. Blank → null (= send as
// the mailbox itself). Shared by senders POST and PATCH — lives here because
// Next.js route files may only export route handlers/config.
export const SendAsEmail = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z.string().trim().toLowerCase().email("Send-as alias must be an email address").nullable().optional()
);

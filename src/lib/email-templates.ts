import { z } from "zod";
import { isAvailableSituation } from "./situations";

// Validation for the user's template library (/api/templates).
export const TemplateSchema = z.object({
  name: z.string().trim().min(1, "Give the template a name.").max(120),
  subject: z.string().max(500).nullable().optional(),
  body: z.string().trim().min(1, "The template needs a body.").max(100_000),
  situations: z.array(z.string()).max(20).optional().refine((xs) => !xs || xs.every(isAvailableSituation), {
    message: "Unknown situation.",
  }),
  source: z.enum(["written", "uploaded"]).optional(),
  original_filename: z.string().max(255).nullable().optional(),
});

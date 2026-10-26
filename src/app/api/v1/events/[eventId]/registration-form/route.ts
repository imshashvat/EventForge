/**
 * GET  /api/v1/events/[eventId]/registration-form  — get current form definition
 * PUT  /api/v1/events/[eventId]/registration-form  — upsert form field definitions
 *
 * Auth: event:manage
 *
 * Field types: text | email | phone | select | checkbox | url
 * Fields are stored as JSONB on registration_forms.fields for the current form version.
 * On PUT: if no form exists yet, creates one (version=1, isCurrent=true).
 *         if one exists, updates the fields in-place (same version — only new events
 *         with zero participants can change form structure; once participants exist,
 *         edits create a new version).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser, buildActor, resolveAppUser } from "@/core/auth";
import { authorize } from "@/core/authz";
import { toHttpError } from "@/core/errors";
import { db, withTx } from "@/core/db";
import { registrationForms, participants } from "@/core/db/schema";
import { eq, and, count } from "drizzle-orm";

interface Params { params: Promise<{ eventId: string }> }

// ── Validation ────────────────────────────────────────────────────────────────

const fieldDefSchema = z.object({
  key: z.string().min(1).max(60).regex(/^[a-z_][a-z0-9_]*$/, "key must be snake_case"),
  label: z.string().min(1).max(120),
  fieldType: z.enum(["text", "email", "phone", "select", "checkbox", "url"]),
  required: z.boolean().default(false),
  placeholder: z.string().max(200).optional(),
  // For select fields only
  options: z.array(z.string().min(1).max(200)).max(50).optional(),
});

const putSchema = z.object({
  fields: z.array(fieldDefSchema).max(30),
});

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { eventId } = await params;

  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const appUser = await resolveAppUser(session);
    const actor = await buildActor(appUser.id);
    authorize(actor, "event:update", { type: "event", eventId });

    const [form] = await db
      .select()
      .from(registrationForms)
      .where(and(eq(registrationForms.eventId, eventId), eq(registrationForms.isCurrent, true)))
      .limit(1);

    if (!form) {
      return NextResponse.json({ form: null, fields: [] });
    }

    return NextResponse.json({
      form: { id: form.id, version: form.version, createdAt: form.createdAt },
      fields: form.fields,
    });
  } catch (err) {
    const http = toHttpError(err, "");
    return NextResponse.json({ error: http.message }, { status: http.statusCode });
  }
}

// ── PUT ───────────────────────────────────────────────────────────────────────

export async function PUT(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const { eventId } = await params;

  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = putSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 422 });
  }

  // Validate: select fields must have options
  const selectWithoutOptions = parsed.data.fields.filter(
    (f) => f.fieldType === "select" && (!f.options || f.options.length === 0),
  );
  if (selectWithoutOptions.length > 0) {
    return NextResponse.json(
      { error: `Select fields must have options: ${selectWithoutOptions.map((f) => f.key).join(", ")}` },
      { status: 422 },
    );
  }

  // Validate unique keys
  const keys = parsed.data.fields.map((f) => f.key);
  if (new Set(keys).size !== keys.length) {
    return NextResponse.json({ error: "Field keys must be unique" }, { status: 422 });
  }

  try {
    const appUser = await resolveAppUser(session);
    const actor = await buildActor(appUser.id);
    authorize(actor, "event:update", { type: "event", eventId });

    const { fields } = parsed.data;

    const result = await withTx(async (tx) => {
      const [existing] = await tx
        .select({ id: registrationForms.id, version: registrationForms.version })
        .from(registrationForms)
        .where(and(eq(registrationForms.eventId, eventId), eq(registrationForms.isCurrent, true)))
        .limit(1);

      if (!existing) {
        // First time — create version 1
        const [form] = await tx
          .insert(registrationForms)
          .values({ eventId, version: 1, isCurrent: true, fields })
          .returning();
        return form;
      }

      // Check if any participants already registered using this form
      const [countRow] = await tx
        .select({ total: count() })
        .from(participants)
        .where(eq(participants.eventId, eventId));
      const total = countRow?.total ?? 0;

      if (total > 0) {
        // Participants exist — create a new version, mark old as not current
        await tx
          .update(registrationForms)
          .set({ isCurrent: false })
          .where(eq(registrationForms.id, existing.id));

        const [form] = await tx
          .insert(registrationForms)
          .values({ eventId, version: existing.version + 1, isCurrent: true, fields })
          .returning();
        return form;
      }

      // No participants yet — update fields in-place
      const [form] = await tx
        .update(registrationForms)
        .set({ fields })
        .where(eq(registrationForms.id, existing.id))
        .returning();
      return form;
    });

    return NextResponse.json(
      { form: { id: result!.id, version: result!.version }, fields },
      { status: 200, headers: { "X-Request-Id": requestId } },
    );
  } catch (err) {
    const http = toHttpError(err, requestId);
    return NextResponse.json({ error: http.message }, { status: http.statusCode });
  }
}

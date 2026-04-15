import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase-server";
import { Resend } from "resend";
import type { CorrectionSubmission, IssueType } from "@/lib/types";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const ISSUE_LABELS: Record<string, string> = {
  wrong_info: "Wrong information",
  outdated: "Outdated information",
  missing: "Missing information",
  other: "Other",
};

const VALID_ISSUE_TYPES: IssueType[] = [
  "wrong_info",
  "outdated",
  "missing",
  "other",
];

const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_URL_LENGTH = 500;

function isValidEmail(email: string): boolean {
  // RFC-ish: has exactly one @, has at least one dot after the @
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;

  // ── Validate required fields ──────────────────────────────────────────────

  const page_url = raw.page_url;
  if (typeof page_url !== "string" || page_url.trim().length === 0) {
    return NextResponse.json(
      { error: "page_url is required." },
      { status: 400 }
    );
  }
  if (page_url.length > MAX_URL_LENGTH) {
    return NextResponse.json(
      { error: `page_url must be under ${MAX_URL_LENGTH} characters.` },
      { status: 400 }
    );
  }
  // Only allow relative paths or marylandiq.org URLs to prevent abuse
  const isRelativePath = page_url.startsWith("/");
  const isOwnDomain =
    page_url.startsWith("https://marylandiq.org") ||
    page_url.startsWith("https://www.marylandiq.org");
  if (!isRelativePath && !isOwnDomain) {
    return NextResponse.json(
      { error: "page_url must be a relative path or a marylandiq.org URL." },
      { status: 400 }
    );
  }

  const issue_type = raw.issue_type;
  if (
    typeof issue_type !== "string" ||
    !VALID_ISSUE_TYPES.includes(issue_type as IssueType)
  ) {
    return NextResponse.json(
      {
        error: `issue_type must be one of: ${VALID_ISSUE_TYPES.join(", ")}.`,
      },
      { status: 400 }
    );
  }

  const description = raw.description;
  if (typeof description !== "string" || description.trim().length === 0) {
    return NextResponse.json(
      { error: "description is required." },
      { status: 400 }
    );
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return NextResponse.json(
      {
        error: `description must be under ${MAX_DESCRIPTION_LENGTH} characters.`,
      },
      { status: 400 }
    );
  }

  // ── Validate optional email ───────────────────────────────────────────────

  let reporter_email: string | null = null;
  if (raw.reporter_email !== undefined && raw.reporter_email !== null) {
    if (typeof raw.reporter_email !== "string") {
      return NextResponse.json(
        { error: "reporter_email must be a string." },
        { status: 400 }
      );
    }
    const trimmed = raw.reporter_email.trim();
    if (trimmed.length > 0) {
      if (!isValidEmail(trimmed)) {
        return NextResponse.json(
          { error: "reporter_email does not appear to be a valid email address." },
          { status: 400 }
        );
      }
      reporter_email = trimmed;
    }
  }

  // ── Insert into corrections table ─────────────────────────────────────────

  const submission: CorrectionSubmission = {
    page_url: page_url.trim(),
    issue_type: issue_type as IssueType,
    description: description.trim(),
    ...(reporter_email ? { reporter_email } : {}),
  };

  const supabase = createServerClient();

  const { error: insertError } = await supabase.from("corrections").insert({
    page_url: submission.page_url,
    reporter_email: submission.reporter_email ?? null,
    issue_type: submission.issue_type,
    description: submission.description,
    status: "open",
  });

  if (insertError) {
    console.error("[report] insert error:", insertError);
    return NextResponse.json(
      { error: "Failed to submit report. Please try again." },
      { status: 500 }
    );
  }

  // Send email notification
  if (resend) {
    try {
      await resend.emails.send({
        from: "MarylandIQ Reports <reports@marylandiq.org>",
        to: "support@marylandiq.org",
        subject: `[MarylandIQ] New report: ${ISSUE_LABELS[submission.issue_type] ?? submission.issue_type}`,
        text: [
          `Issue type: ${ISSUE_LABELS[submission.issue_type] ?? submission.issue_type}`,
          `Page: ${submission.page_url}`,
          ``,
          `Description:`,
          submission.description,
          ``,
          submission.reporter_email
            ? `Reporter: ${submission.reporter_email}`
            : `Reporter: anonymous`,
        ].join("\n"),
      });
    } catch (emailErr) {
      // Don't fail the request if email fails — report is already saved
      console.error("[report] email notification failed:", emailErr);
    }
  }

  return NextResponse.json(
    { success: true, message: "Report received. Thank you." },
    { status: 201 }
  );
}

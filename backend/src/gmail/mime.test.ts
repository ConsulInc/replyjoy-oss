import { describe, expect, it } from "vitest";

import { buildReplyRaw } from "./mime.js";

describe("buildReplyRaw", () => {
  it("creates a threaded reply email with reply headers", () => {
    const raw = buildReplyRaw({
      to: "jordan@example.com",
      subject: "Checking in",
      messageId: "<msg-123@example.com>",
      references: "<prior@example.com>",
      body: "Hey Jordan,\n\nAll set.\n",
    });

    const decoded = Buffer.from(raw, "base64url").toString("utf8");

    expect(decoded).toContain("To: jordan@example.com");
    expect(decoded).toContain("Subject: Re: Checking in");
    expect(decoded).toContain("In-Reply-To: <msg-123@example.com>");
    expect(decoded).toContain("References: <prior@example.com> <msg-123@example.com>");
    expect(decoded).toContain("Hey Jordan,\n\nAll set.\n");
  });

  it("does not double-prefix the reply subject", () => {
    const raw = buildReplyRaw({
      to: "jordan@example.com",
      subject: "Re: Already prefixed",
      messageId: null,
      references: null,
      body: "Reply body",
    });

    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    expect(decoded).toContain("Subject: Re: Already prefixed");
  });

  it("creates a multipart reply when attachments are included", () => {
    const raw = buildReplyRaw({
      to: "jordan@example.com",
      subject: "Resume",
      messageId: "<msg-123@example.com>",
      references: "<prior@example.com>",
      body: "Attaching the file here.",
      attachments: [
        {
          filename: "resume.pdf",
          mimeType: "application/pdf",
          data: Buffer.from("pdf-bytes").toString("base64url"),
        },
      ],
    });

    const decoded = Buffer.from(raw, "base64url").toString("utf8");

    expect(decoded).toContain('Content-Type: multipart/mixed; boundary=');
    expect(decoded).toContain('Content-Disposition: attachment; filename="resume.pdf"');
    expect(decoded).toContain("Attaching the file here.");
    expect(decoded).toContain("cGRmLWJ5dGVz");
  });
});

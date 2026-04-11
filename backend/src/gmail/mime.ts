function decodeBody(data?: string | null) {
  if (!data) return "";
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function toBase64(data: string) {
  return data.replace(/-/g, "+").replace(/_/g, "/");
}

function wrapBase64(data: string, width = 76) {
  return data.match(new RegExp(`.{1,${width}}`, "g"))?.join("\r\n") ?? data;
}

function collectParts(payload: any): any[] {
  if (!payload) return [];
  if (!payload.parts?.length) return [payload];
  return payload.parts.flatMap((part: any) => collectParts(part));
}

export function getHeader(headers: Array<{ name?: string | null; value?: string | null }> | undefined, key: string) {
  return headers?.find((header) => header.name?.toLowerCase() === key.toLowerCase())?.value ?? null;
}

export function extractThreadText(payload: any) {
  const parts = collectParts(payload);
  const textPart = parts.find((part) => part.mimeType === "text/plain");
  if (textPart?.body?.data) {
    return decodeBody(textPart.body.data);
  }

  const htmlPart = parts.find((part) => part.mimeType === "text/html");
  if (htmlPart?.body?.data) {
    return decodeBody(htmlPart.body.data).replace(/<[^>]+>/g, " ");
  }

  return decodeBody(payload?.body?.data);
}

export function buildReplyRaw({
  to,
  subject,
  messageId,
  references,
  body,
  attachments = [],
}: {
  to: string;
  subject: string;
  messageId: string | null;
  references: string | null;
  body: string;
  attachments?: Array<{
    filename: string;
    mimeType: string;
    data: string;
  }>;
}) {
  const replySubject = subject?.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`;
  const boundary = `mix-${Math.random().toString(36).slice(2, 14)}`;
  const hasAttachments = attachments.length > 0;
  const headers = [`To: ${to}`, `Subject: ${replySubject}`, "MIME-Version: 1.0"];

  if (messageId) {
    headers.push(`In-Reply-To: ${messageId}`);
    headers.push(`References: ${[references, messageId].filter(Boolean).join(" ")}`);
  }

  if (!hasAttachments) {
    headers.push("Content-Type: text/plain; charset=UTF-8");
    const email = `${headers.join("\r\n")}\r\n\r\n${body}`;
    return Buffer.from(email).toString("base64url");
  }

  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);

  const textPart = [
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
  ].join("\r\n");

  const attachmentParts = attachments.map((attachment) =>
    [
      `--${boundary}`,
      `Content-Type: ${attachment.mimeType || "application/octet-stream"}; name="${attachment.filename}"`,
      `Content-Disposition: attachment; filename="${attachment.filename}"`,
      "Content-Transfer-Encoding: base64",
      "",
      wrapBase64(toBase64(attachment.data)),
    ].join("\r\n"),
  );

  const email = `${headers.join("\r\n")}\r\n\r\n${[textPart, ...attachmentParts, `--${boundary}--`, ""].join("\r\n")}`;
  return Buffer.from(email).toString("base64url");
}

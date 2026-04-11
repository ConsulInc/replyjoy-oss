import { type FormEvent, useState } from "react";
import { useUser } from "@clerk/clerk-react";
import { LoaderCircle, MessageCircle, Send, X } from "lucide-react";

import { submitSupportRequest } from "../lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";

export function SupportWidget() {
  const { user } = useUser();
  const signedInEmail =
    user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses?.[0]?.emailAddress ?? "";

  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSent, setIsSent] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();
    const resolvedEmail = signedInEmail || email.trim();

    if (!trimmedTitle || !trimmedBody) {
      setError("Please add both a title and a message.");
      return;
    }

    if (!resolvedEmail) {
      setError("Please include your email so I can reply.");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      await submitSupportRequest({
        title: trimmedTitle,
        body: trimmedBody,
        email: resolvedEmail,
      });
      setIsSent(true);
      setTitle("");
      setBody("");
      setEmail("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to send your message right now.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function resetForm() {
    setIsSent(false);
    setError(null);
    setTitle("");
    setBody("");
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 flex max-w-[calc(100vw-1rem)] flex-col items-end gap-3 sm:bottom-6 sm:right-6">
      {isOpen ? (
        <section className="w-[min(380px,calc(100vw-1rem))] overflow-hidden rounded-[28px] border border-border bg-white shadow-[0_24px_80px_rgba(15,23,42,0.16)]">
          <div className="flex items-start justify-between gap-4 bg-[linear-gradient(135deg,#1d4ed8_0%,#3b82f6_100%)] px-5 py-4 text-white">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-white/70">Feedback</p>
              <h2 className="text-xl font-semibold tracking-[-0.02em]">Send a note</h2>
              <p className="text-sm leading-6 text-white/85">Report a bug or tell me what to improve.</p>
            </div>
            <button
              aria-label="Close feedback widget"
              className="rounded-full bg-white/16 p-2 text-white transition hover:bg-white/24"
              onClick={() => setIsOpen(false)}
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {isSent ? (
            <div className="space-y-4 px-5 py-5">
              <div className="rounded-[22px] bg-slate-50 px-4 py-4">
                <p className="text-sm font-semibold text-foreground">Thanks. Your feedback was sent.</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {signedInEmail
                    ? `I’ll reply to ${signedInEmail} if needed.`
                    : "I’ll reply to the email you provided if needed."}
                </p>
              </div>
              <div className="flex justify-end">
                <Button onClick={resetForm} type="button" variant="secondary">
                  Send another
                </Button>
              </div>
            </div>
          ) : (
            <form className="space-y-4 px-5 py-5" onSubmit={handleSubmit}>
              {signedInEmail ? (
                <div className="rounded-[20px] bg-slate-50 px-4 py-3 text-sm text-foreground">
                  Reply address: <strong>{signedInEmail}</strong>
                </div>
              ) : (
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-foreground">Your email</span>
                  <Input
                    autoComplete="email"
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    type="email"
                    value={email}
                  />
                </label>
              )}

              <label className="block space-y-2">
                <span className="text-sm font-medium text-foreground">Title</span>
                <Input
                  maxLength={160}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="What should I look at?"
                  value={title}
                />
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-medium text-foreground">Message</span>
                <Textarea
                  className="min-h-[132px]"
                  maxLength={5000}
                  onChange={(event) => setBody(event.target.value)}
                  placeholder="What happened, what you expected, and any useful context."
                  value={body}
                />
              </label>

              {error ? <p className="text-sm text-destructive">{error}</p> : null}

              <div className="flex items-center justify-between gap-3">
                <p className="text-xs leading-5 text-muted-foreground">This sends an email directly to support.</p>
                <Button disabled={isSubmitting} type="submit">
                  {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Send
                </Button>
              </div>
            </form>
          )}
        </section>
      ) : null}

      <Button
        className="h-14 rounded-full px-5 shadow-[0_16px_42px_rgba(59,130,246,0.28)]"
        onClick={() => setIsOpen((current) => !current)}
        size="lg"
        type="button"
      >
        <MessageCircle className="h-5 w-5" />
        Feedback
      </Button>
    </div>
  );
}

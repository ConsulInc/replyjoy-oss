import { Link } from "react-router-dom";

export function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f9fbff_0%,#f7f8ff_42%,#f6f7ff_100%)] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl rounded-[32px] border border-white/80 bg-white/85 p-6 shadow-panel backdrop-blur sm:p-10">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">
              ReplyJoy
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-foreground sm:text-4xl">
              Privacy Policy
            </h1>
          </div>
          <Link
            to="/"
            className="rounded-full border border-blue-200/80 bg-blue-50 px-4 py-2 text-sm font-medium text-primary transition hover:bg-blue-100"
          >
            Back Home
          </Link>
        </div>

        <div className="mt-8 space-y-8 text-sm leading-7 text-muted-foreground sm:text-base">
          <section>
            <p>
              Effective date: April 11, 2026. ReplyJoy helps users connect Gmail, review inbox
              activity, and generate draft replies using AI assistance.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">Information we collect</h2>
            <p className="mt-3">
              We collect account information needed to operate ReplyJoy, including your email
              address, profile information from authentication providers, Gmail account metadata,
              and the Gmail content required to identify messages and prepare draft responses.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">How Gmail data is used</h2>
            <p className="mt-3">
              Gmail access is used only to read mailbox content needed to detect relevant threads,
              generate suggested replies, and create Gmail drafts on your behalf. ReplyJoy does not
              send email without your action in Gmail.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">How we store and protect data</h2>
            <p className="mt-3">
              OAuth tokens and related account data are stored securely and are used only to provide
              ReplyJoy features. We use encryption, access controls, and service-level security
              measures to protect customer data.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">How we share information</h2>
            <p className="mt-3">
              We do not sell personal information. We may use service providers that support
              hosting, authentication, payment processing, analytics, email delivery, and AI model
              operations strictly to run ReplyJoy.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">Your choices</h2>
            <p className="mt-3">
              You can disconnect Gmail access, stop using the service, or contact us to request
              deletion of your account data, subject to legal or operational retention requirements.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">Contact</h2>
            <p className="mt-3">
              For privacy questions, contact{" "}
              <a className="text-primary underline underline-offset-4" href="mailto:derek@consulinc.us">
                derek@consulinc.us
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}

import { Link } from "react-router-dom";

export function TermsOfServicePage() {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f9fbff_0%,#f7f8ff_42%,#f6f7ff_100%)] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl rounded-[32px] border border-white/80 bg-white/85 p-6 shadow-panel backdrop-blur sm:p-10">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">
              ReplyJoy
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-foreground sm:text-4xl">
              Terms of Service
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
              Effective date: April 11, 2026. These Terms of Service govern your use of ReplyJoy,
              including access to connected Gmail workflows, generated drafts, and paid or access-code
              based features.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">Service overview</h2>
            <p className="mt-3">
              ReplyJoy helps users connect Gmail, review inbox activity, and generate draft replies.
              ReplyJoy creates drafts for user review and does not send email automatically on your
              behalf.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">Accounts and access</h2>
            <p className="mt-3">
              You are responsible for maintaining the security of your account and for activity under
              your account. You agree to provide accurate registration, authentication, and billing
              information.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">Acceptable use</h2>
            <p className="mt-3">
              You may not use ReplyJoy to violate law, abuse third-party services, interfere with the
              service, or create fraudulent, harmful, or unauthorized communications.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">Third-party services</h2>
            <p className="mt-3">
              ReplyJoy relies on third-party providers, including Google, payment processors, hosting
              providers, and other infrastructure services. Your use of those integrations may also be
              subject to their separate terms and policies.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">Billing and subscriptions</h2>
            <p className="mt-3">
              Paid subscriptions, renewals, cancellations, and promotional or access-code entitlements
              are governed by the pricing and billing terms presented at purchase or redemption. Unless
              required by law, fees are non-refundable.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">Suspension and termination</h2>
            <p className="mt-3">
              We may suspend or terminate access if you violate these terms, misuse the service, or if
              continued operation would create legal, security, or operational risk.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">Disclaimers</h2>
            <p className="mt-3">
              ReplyJoy is provided on an as-is and as-available basis. We do not guarantee uninterrupted
              availability, complete accuracy, or suitability for any specific purpose.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">Limitation of liability</h2>
            <p className="mt-3">
              To the maximum extent permitted by law, ReplyJoy and its operators will not be liable for
              indirect, incidental, special, consequential, punitive, or lost-profit damages arising
              from your use of the service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">Changes to these terms</h2>
            <p className="mt-3">
              We may update these terms from time to time. Continued use of ReplyJoy after changes take
              effect means you accept the revised terms.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">Contact</h2>
            <p className="mt-3">
              For questions about these terms, contact{" "}
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

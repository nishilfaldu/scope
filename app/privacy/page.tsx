export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold">Privacy Policy</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated September 19, 2026</p>
      <div className="mt-8 space-y-6 leading-7">
        <p>Scope lets you connect third-party accounts and approve limited access for agents. We collect the account details needed to provide the service, including your email address, connected account identifiers, authorization grants, and activity needed for security and auditing.</p>
        <p>OAuth access and refresh tokens are encrypted at rest. We use connected-account data only to provide the access you request, maintain security, and operate Scope. We do not sell personal information.</p>
        <p>You can disconnect an account or revoke agent access in Scope. Provider-native tokens already issued to an agent remain subject to that provider's expiration and revocation rules.</p>
        <p>We may use service providers for hosting, authentication, email delivery, and connected-provider APIs. They process data only as needed to provide those services.</p>
        <p>For privacy questions or deletion requests, email <a className="underline" href="mailto:nishilfaldu@gmail.com">nishilfaldu@gmail.com</a>.</p>
      </div>
    </main>
  );
}

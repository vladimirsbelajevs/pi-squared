# Secure Electron LAN/VPN Access

## Summary

Add opt-in HTTPS access to the Electron-hosted app for phones on the home LAN or through a router VPN. Keep the application server private and authenticated on loopback, place a paired-device HTTPS gateway in front of it, bind only explicitly selected LAN addresses, and generate certificates inside Electron.

Use three review milestones, but ship only after all security phases are complete.

## Security boundaries

### Explicit listener selection

- Never bind to `0.0.0.0`, `::`, or an implicit all-interface mode.
- Inventory concrete addresses grouped by interface and preselect one likely private home-LAN IPv4 address when possible; require confirmation before enabling.
- Permit multiple explicitly selected addresses, with one listener per address on the common fixed port.
- Label virtual/container/VPN/link-local/temporary IPv6 addresses. Never silently select newly appearing addresses.
- Persist selected `(interface name, address, family)` bindings. If one disappears, stop/report only that listener; never broaden the bind.
- Only selected addresses enter SANs, accepted hosts, URLs, and mDNS advertisements. Unrelated interface churn must not renew certificates.

### Authenticated private server

Use two separate random per-run secrets:

1. **Electron renderer:** provision a session-only, `HttpOnly`, `SameSite=Strict` cookie through Electron’s session API before loading the private URL.
2. **Gateway:** send a separate secret in `X-Pi-Squared-Internal-Auth` only after validating and authenticating the external request.

The loopback server accepts either credential using constant-time comparison. Require authentication for application/API routes, health/shutdown operations, SSE, and upgrades. Never place secrets in URLs, renderer-readable storage, or IPC responses.

The gateway always strips client-provided internal-auth headers and gateway/local-session cookies before forwarding, while preserving unrelated application cookies. It sets its internal header only after authorization and never exposes either secret in responses.

Add equivalent opt-in protection to Vite under `electron:dev`; ordinary `npm run dev` remains unchanged. Unauthenticated local processes receive `401`.

## Gateway request policy

Reserve `/__pi-squared/pair/*` exclusively for gateway-owned pairing UI/API. Never proxy this namespace to SvelteKit; unknown reserved routes return local `404` responses.

### Pairing routes and method invariants

Implement this explicit surface:

- `GET /__pi-squared/pair/`
  - Render the pairing page only.
  - Perform no state change, create no pending request, issue no credential, and set no pairing nonce.
- `POST /__pi-squared/pair/request`
  - Validate input/rate limits and create a pending desktop-approval request.
  - Return its opaque polling nonce.
- `GET /__pi-squared/pair/request/<nonce>`
  - Return read-only pending/approved/rejected/expired status.
  - Do not consume approval, create credentials, refresh expiry, or set cookies.
- `POST /__pi-squared/pair/complete`
  - Consume an approved pending grant, create the trusted-device credential, and set its cookie.
- `POST /__pi-squared/pair/code`
  - Redeem a valid one-time code, create the trusted-device credential, and set its cookie.

All pairing state changes use POST. Electron approval/rejection occurs through trusted IPC, not public HTTP. A cross-site GET/navigation can render or poll known state but cannot create nuisance approvals or pair a device.

For pairing routes:

1. Determine TLS authority without trusting forwarding headers.
2. Require an allowed host/port.
3. Require exact external `Origin` for every POST.
4. Validate content type, body size, nonce, and rate limits.
5. Serve locally with purpose-built headers: restrictive CSP, `X-Content-Type-Options: nosniff`, frame denial, strict referrer policy, and `Cache-Control: no-store`.

Do not use a generic “maximum security headers” middleware. In particular, do not emit HSTS for local/IP pairing or application endpoints; HSTS is host-wide across ports and is not required by this threat model.

### Proxied routes

For every non-pairing request:

1. Determine original TLS authority/origin without trusting forwarding headers.
2. Require a selected IP, `pi-squared.local`, or configured DNS host on the active port.
3. Reject any present unexpected `Origin`; unsafe methods require exact allowed external `Origin`.
4. Authenticate the paired-device cookie.
5. Strip `Forwarded`, `X-Forwarded-*`, internal-auth, and gateway-owned cookie values.
6. Translate to loopback and set the gateway internal-auth header.

Never use a rewritten internal origin as proof of external trust. Rewrite redirects only when they exactly target the private upstream.

### WebSockets

- Every upgrade requires an `Origin` exactly matching an allowed external HTTPS origin.
- Reject missing, malformed, HTTP, or unexpected origins before authorization/proxying.
- Authorize the device during handshake and track the socket for immediate revocation.

## Managed X.509 certificates

Use `@peculiar/x509`, Node WebCrypto, RSA-3072, SHA-256, and random positive nonzero serials. OpenSSL is not required.

### Root CA

- Identification CN: `Pi Squared Local CA`.
- Critical `Basic Constraints: CA=true, pathLen=0`.
- Critical `Key Usage: keyCertSign, cRLSign`.
- Subject Key Identifier.
- Ten-year validity with small clock-skew backdate.

### Server certificate

- Critical `Basic Constraints: CA=false`.
- Critical `Key Usage: digitalSignature, keyEncipherment`.
- `Extended Key Usage: serverAuth`.
- Subject and Authority Key Identifiers.
- SANs limited to `pi-squared.local`, validated configured DNS names, and selected listener IPs.
- 397-day validity with small clock-skew backdate.
- SAN is authoritative; do not rely on CN hostname matching.

Renew/reload the leaf near expiry or when selected bindings/DNS names change; retain the CA. Never install the CA automatically.

Export only the public CA as `pi-squared-ca.crt` and display its SHA-256 fingerprint. Treat corrupt/expired CA state as an error. A confirmed reset regenerates TLS and clears pairings.

### Private-key storage

Implement versioned envelopes for both CA and leaf PKCS#8 keys in Phase 1:

- Encrypt both with Electron `safeStorage` when genuinely OS-backed.
- On Linux, do not call `basic_text` or unavailable secret storage secure.
- Fall back to restrictive per-user files with a visible reduced-protection warning.
- Keep the CA key decrypted only during issuance/renewal; the active leaf key remains available while HTTPS listeners run.
- Support later fallback-to-secure migration without replacing certificates/CA.

## Pairing credentials

- Desktop approval is primary; eight-digit one-use code is fallback and expires after five minutes.
- Pending requests expire after ten minutes and are deduplicated/capped. Rate-limit creation and bad codes without assuming VPN clients have unique IPs.
- Issue a 256-bit credential in `__Host-pi-squared-device` with `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, and no `Domain`.
- Use 180-day rolling expiry refreshed at most daily. Persist only SHA-256 hash plus host/device/created/last-seen/expiry metadata.
- Cookies are host-scoped, not port-scoped: same hostname across LAN/VPN or port changes retains pairing; hostname/IP changes pair separately.
- Prefer dedicated DNS names because an IP-host cookie can be sent to other HTTPS services on that IP regardless of port.
- Revocation deletes the credential and closes tracked SSE, WebSocket, and keep-alive connections immediately.

## LAN and router-VPN behavior

- Fixed configurable port, default `3049`.
- Router-VPN clients reach selected LAN addresses through normal routing; Pi Squared does not configure VPN infrastructure.
- Recommend DHCP reservation.
- Support validated names such as `pi-squared.home.arpa`; they become SANs/accepted hosts, but Pi Squared does not create DNS records.
- Use `@homebridge/ciao` to advertise **Pi Squared** only on selected interfaces. mDNS failure is nonfatal and mDNS is not assumed across VPNs.
- Display preferred mDNS/configured DNS URLs first and selected-IP fallbacks second.
- Never modify firewall, DNS, VPN, or hosts configuration; advise against public port forwarding.

## Reconfiguration

- **Certificate/SAN only:** validate and use `server.setSecureContext(...)`.
- **Added address:** start before persisting/advertising.
- **Removed address:** retire after all additions/reconfiguration succeed.
- **Port change:** bind all selected addresses on the new port before retiring old listeners.
- **Same address/port restart:** validate first, perform controlled restart, and restore prior state on failure where possible.
- Preserve the last working configuration whenever possible; never imply zero-downtime where socket ownership prevents it.

## Settings and interfaces

Add `LanSharingSettings.svelte`, visible only through trusted Electron preload, with:

- enable/disable, port, and bind status;
- explicit address selection and risk labels;
- additional DNS names;
- per-listener state and preferred/fallback URLs;
- CA fingerprint/export/reset and key-protection warning;
- pairing code and pending approval controls;
- trusted-device host, last-seen, expiry, and revoke controls.

Disabling stops HTTPS/mDNS but retains CA/devices. Add typed preload IPC and status subscriptions guarded by existing trusted-frame checks. Private keys/raw credentials never cross IPC.

Phones receive normal app functionality but cannot administer Electron networking/certificates/devices/updates. Mobile clients backed by Electron report updates as desktop-managed.

## Milestones

### Phase 1 — Core secure IP access

- Versioned configuration/key envelopes and secure-storage fallback.
- Explicit listener selection/fixed port.
- Internal X.509 generation and CA export.
- Separate renderer-cookie/gateway-header loopback authentication.
- Gateway pairing namespace with method invariants.
- Strict IP-host HTTP/SSE/WebSocket proxying.
- Approval/code pairing, 180-day credentials, revocation.
- Initial Settings UI and phone IP access.

### Phase 2 — Discovery and VPN naming

- Selected-interface mDNS.
- Custom DNS names, SAN reconciliation, preferred URLs.
- Category-aware TLS/listener reconfiguration.

### Phase 3 — Hardening and release readiness

- Complete key migration/recovery, CA reset, degraded listeners, and device-expiry UX.
- Harden lifecycle/network recovery.
- Complete documentation, security/integration coverage, and cross-platform packaging checks.

Phases are review milestones, not independently released subsets.

## Tests and verification

- Test interface selection, wildcard prohibition, defaults, and unrelated-interface isolation.
- Test exact X.509 profiles, serials, SAN restrictions, expiry, export, encrypted/fallback envelopes, migration, and corruption handling.
- Test loopback rejection, both internal auth mechanisms, constant-time checks, spoof stripping, and Electron-dev protection.
- Test that pairing-page GET is side-effect free; only POST creates/consumes state; polling GET is read-only; exact POST Origin, nonce, body, rate-limit, CSP/no-store headers, and absence of HSTS.
- Test reserved pairing paths never proxy.
- Test proxy validation before rewriting, cookie/header sanitization, unrelated-cookie preservation, redirect handling, HTTP/POST/SSE/keep-alive behavior, and upstream recovery.
- Test WebSockets reject missing/wrong Origin and unauthorized devices.
- Test pairing lifecycle, exact `__Host-` attributes, host-versus-port semantics, rolling expiry, hash-only storage, and active revocation.
- Test custom DNS, selected-only SAN renewal, `setSecureContext`, listener/port handover, rollback, and mocked selected-interface mDNS.
- Add browser tests for settings, certificate actions, pairing, and devices.
- Manually verify selected-address isolation, phone CA installation/pairing, LAN mDNS, router-VPN DNS/IP access, streaming, revocation, restart persistence, and unrelated-interface stability.
- Per phase run Svelte autofixer, `npm run lint`, `npm run check`, focused tests, and relevant builds/smokes. At completion run full Vitest, Playwright, `npm run build:app`, and Electron smoke suites; report unavailable platform/network checks.

## Defaults and assumptions

- Opt-in, disabled by default, port `3049`, resumes after enablement.
- Only explicitly selected addresses receive listeners.
- Router VPN, DHCP reservations, DNS, and firewall remain external responsibilities.
- Certificates are generated internally; CA trust is never installed automatically.
- Both private keys use versioned safe-storage envelopes when secure storage exists.
- Electron and gateway use separate per-run loopback credentials.
- Pairing GETs are side-effect free; all pairing state changes use POST or trusted Electron IPC.
- Pairing paths are gateway-local exceptions; all proxied routes require a trusted-device credential.
- Trusted-device cookies are host-only `__Host-` cookies with 180-day rolling expiry and immediate revocation.
- HSTS is intentionally not emitted for local/IP endpoints.

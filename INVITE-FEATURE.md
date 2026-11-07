# Invite Feature (planned)

Status: **specified, not implemented.** Build after the creator-form, performance
and touch work is finished and tested.

## Decisions

- **One invite creates exactly one museum.**
- **No time limit.** An invite stays valid until it is used. (An optional
  "generated at" date is still recorded.)
- **One invite per museum.** A successfully published museum consumes the invite
  permanently.
- **Failed creation does not consume the invite.** The invite remains usable
  until a museum is successfully published. Abandoned drafts are removed by the
  existing hourly cleanup.
- **The invite link is the link to send.** The sender generates it and forwards
  it to the recipient. The recipient opens it, builds the museum, and receives a
  normal view-only `/m/<id>` link.
- **Share links do not grant creation access.** The shared-museum pages must not
  offer "Create your own museum"; the creator is reached only through an invite.
- **Admin generation:** the easiest supported path (CLI/script or protected
  endpoint), no admin secret in the browser bundle.

## Core flow

1. Owner generates an invite link, e.g. `https://site/create/<token>`.
2. Recipient opens it. The client validates the token against the API.
3. Invalid/used tokens show a closed invitation page and no creator form.
4. The valid token is carried through draft creation, upload and finalize.
5. On successful finalization, the invite is consumed atomically:
   `UPDATE ... WHERE used_at IS NULL` (single winner under concurrency).
6. The invite cannot be used again. The resulting museum is a normal
   view-only `/m/<id>` link.

## Data model (draft)

`public.creation_invites`:

| Column | Notes |
| --- | --- |
| `id` | uuid primary key |
| `token_hash` | SHA-256 of the raw token, unique |
| `created_at` | generation time |
| `used_at` | null until a museum is published |
| `museum_id` | set together with `used_at` |
| `note` | optional owner memo |

`public.museums` gets `invite_id` (nullable) so finalization consumes the exact
invite that created the draft.

## Security notes

- Store only the token hash, never the raw token.
- Tokens carry at least 128 bits of randomness.
- Consume atomically at finalize; do not trust a client boolean.
- Keep the bucket and database closed to public writes.
- A forwarded, unused invite still works for the first person who publishes.
  Preventing that requires identity (email magic link or accounts), which is
  explicitly out of scope for this MVP.

## Acceptance tests

- Valid invite opens the creator.
- Used invite is rejected.
- Invalid token is rejected.
- Two simultaneous finalizations with one invite yield one museum.
- A failed upload/finalize leaves the invite usable.
- A successful publish consumes the invite.
- Shared museum pages have no creation entry point.
- No admin secret appears in the browser bundle.

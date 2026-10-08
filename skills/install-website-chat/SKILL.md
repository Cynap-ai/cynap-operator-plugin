---
name: install-website-chat
description: Put a customer's website chat widget live — author the webchat bot, its page-origin binding file and a guest-safe flow, activate them, then hand the customer the one-line install snippet (direct paste or a tag manager).
---

# install-website-chat — Website chat, from config to a pasted snippet

Use this when a customer wants the chat widget on their own website. The widget is configuration: three files
you commit, one Owner approval, and one line the customer pastes into their site. There is no form to fill in
and no SQL to run.

## 1. Author three files

1. **The bot**, in `communication/bots.json`: `channel: "webchat"`, `conversation_mode: "native"`,
   `audience: "external"`, a `conversation_config_generation`, and an `entry_flow_id`.
2. **The flow**, `communication/flows/<flow-id>/flow.json`. A public visitor is an anonymous guest, so a flow
   bound to a webchat bot may declare only `events_emit` and `conversation_request_handoff` as `tools`. Anything
   else is refused when you push. Keep the flow inert and tool-light until the customer has seen it work.
3. **The binding file**, `communication/webchat/<bot-slug>.json` (the file name is the bot slug):

```json
{
  "v": 1,
  "bot_slug": "site-chat",
  "approved_origins": ["https://www.example.com"],
  "presentation": {}
}
```

The Solution that owns the bot must list the bot's slug under `bots` in `solutions.json`. Without that the
installation is created but stays off and the activation says why.

## 2. Approved origins — exact page origins

- An origin is `https://` + host + optional port. No path, no trailing slash, no wildcard, lowercase only.
- `https://www.example.com` and `https://example.com` are **two origins**. List both if the site serves both,
  or redirect one to the other and list only the canonical one.
- A staging or preview host is its own origin. Add it only for a controlled test, then remove it.
- `http://` and hosts without a dot are refused.
- Changing the list is a new commit to the binding file plus an Owner activation. Visitors who already had the
  chat open are asked to reconnect.
- If an approved page is itself shown inside another site's frame (a site-builder editor preview), the chat does
  not render there. That is expected.

## 3. Push and activate

Push the three files in one commit, then run `/cynap-activate <sha>`. The Owner's step-up approval for that
commit is the only consent needed. A commit may change one `communication/webchat/*.json` file at a time.

The activation result lists `webchat_installations`. When `route_state` is `active` it carries the `snippet`.
When it is `pending`, `receipt_reason` names what is missing (for example `solution_not_wired`); fix that in a new
commit. Deleting the binding file and activating turns the chat off. The installation id is never reused.

## 4. Hand the customer the snippet

```html
<script async src="https://<widget-host>/v1/loader.js" data-widget-id="wcw_<id>"></script>
```

The id is public; it is not a secret. Give the customer the exact snippet from the activation result.

**Direct paste (default).** Paste the line before `</body>` on every page that should show the chat. A site
builder's "custom code, footer" or "before body end" field is the same thing. Placing it in `<head>` also works.

**Google Tag Manager.** Tags, New, **Custom HTML**. Paste the same one line. Trigger **All Pages**, firing
**Once per page**, leave "Support document.write" unchecked, publish the container. Do not use the Custom
Template gallery. After the customer publishes, open the live page and confirm the chat button appears; if the
button does not appear, the tag manager dropped the `data-widget-id` attribute, so use direct paste.

## 5. If the customer's site sends a Content-Security-Policy

Allow the widget host in two directives: `script-src https://<widget-host>` and `frame-src https://<widget-host>`.
No other directive needs to change. A page with no policy needs nothing.

## 6. Check it before you call it done

Open the customer's page on an approved origin, open the chat and send one message. A page on an origin that is
not approved, or the `www` form when only the apex is approved, must not show the chat. Never test a live
customer's conversation by asking the customer to type into it.

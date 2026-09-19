# C09 Credit Adapter Source Notes

- `D:\AI\SSH\sub2api\backend\internal\veyra\routes.go`: retain the `data` envelope; account/debit paths; request and response field names; and `402`/`409` semantics.
- `D:\AI\SSH\sub2api\backend\internal\veyra\billing.go`: retain only idempotency fingerprint intent and atomic-debit authority at the remote service.
- `D:\AI\Alchemy Media Agent System\custom_media_agent_2_0\app\services\veyra_auth.py`: retain account/debit mapper responsibilities and post-artifact receipt ordering.
- `https://github.com/meta-xucong/sub2api-adapted` (`custom/main`, `37480b1fb`): retain the Veyra ticket, `video` intent, account/debit envelope and video billing-family semantics. The local `VideoVeyraBridgeAdapter` is a composition facade only; it does not copy the upstream ledger, portal session, or user tables.

No upstream source was copied. This package has no fetch implementation, environment access, URL configuration, Token loading, persistence import, Worker import, Control API import, Studio import, Provider import, or runtime registration. The adapter requires an injected transport and injected internal-token value; test doubles use synthetic values only.

# C09 Credit Adapter Source Notes

- `D:\AI\SSH\sub2api\backend\internal\veyra\routes.go`: retain the `data` envelope; account/debit paths; request and response field names; and `402`/`409` semantics.
- `D:\AI\SSH\sub2api\backend\internal\veyra\billing.go`: retain only idempotency fingerprint intent and atomic-debit authority at the remote service.
- `D:\AI\Alchemy Media Agent System\custom_media_agent_2_0\app\services\veyra_auth.py`: retain account/debit mapper responsibilities and post-artifact receipt ordering.

No upstream source was copied. This package has no fetch implementation, environment access, URL configuration, Token loading, persistence import, Worker import, Control API import, Studio import, Provider import, or runtime registration. The adapter requires an injected transport and injected internal-token value; test doubles use synthetic values only.

# Configuration & Limits

## AI Concurrency
| Provider | Default Limit |
|----------|---------------|
| `openai`   | 5 |
| `mistral`  | 10 |
| `google`   | 10 |
| `anthropic`| 5 |
| `ollama`   | 2 |

## Transfer / Upload (Tus.io)
| Property | Default Limit | Minimum |
|----------|---------------|---------|
| `partSize` (S3) | 8 MB (`8 * 1024 * 1024`) | 5 MB |
| `maxSize`  | Unlimited | N/A |

## MFA Token Verification
| Setting | Default Value | Description |
|---------|---------------|-------------|
| `window` | 1 | Acceptable time window (+/- 30 seconds) |

## Storage (Minio/S3)
| Setting | Default Value |
|---------|---------------|
| `region` | `us-east-1` |
| `expiry` (Presigned URL) | 24 hours (`24 * 60 * 60` seconds) |

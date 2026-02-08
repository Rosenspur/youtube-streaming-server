# YouTube Alexa Bridge Server
Servidor proxy para reproducir audio de YouTube en Alexa.

## Requisitos en Railway:
1. **Node.js**: Versión 20 (Configurada en `package.json` y `nixpacks.toml`).
2. **Variable `YOUTUBE_COOKIES`**: Cookies de sesión de YouTube para evadir el bot-detection.
3. **Variable `PORT`**: 8080.

## Endpoints:
- `POST /`: Endpoint principal para la Alexa Skill.
- `GET /stream/:videoId`: Túnel de audio que procesa el flujo de YouTube.